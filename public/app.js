/* Venue Checklist — single-page app
 *
 * Two people can work the same checklist at once. Opening a checklist joins the
 * one live run for that list; checking a box shows up on the other phone within
 * a couple of seconds. There is no login — identity is just the first name you
 * type once, kept on the phone.
 */

const ISSUE_TYPES = ['Cleaning', 'Damage', 'Supplies', 'Equipment', 'Bathroom', 'HVAC', 'Safety', 'Other'];
const URGENCIES = ['Low', 'Medium', 'High'];

const LIST_CACHE_KEY = 'venue-checklists-v2';
const NAME_KEY = 'venue-worker-name';
const PIN_KEY = 'venue-admin-pin';
const POLL_MS = 2500;

const app = document.getElementById('app');
const pageTitle = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');
const reviewBtn = document.getElementById('review-btn');
const topProgress = document.getElementById('topbar-progress');

let CHECKLISTS = {};   // key -> { key, title, icon, purpose, items }
let LIST_ORDER = [];   // keys, in display order

let selectedFiles = [];   // photos staged for the current form
let sigDrawn = false;
let readyHook = null;     // called when name/photo/signature change, so the submit hint stays live
let run = null;           // the checklist currently being worked
let pollTimer = null;

backBtn.addEventListener('click', () => showHome());
reviewBtn.addEventListener('click', () => showReview());

/* ---------------- Utilities ---------------- */

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// esc() leaves quotes alone, which breaks when the text lands inside an attribute.
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function buzz(pattern) {
  if (!navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* some browsers refuse; not important */ }
}

let toastTimer = null;
function toast(msg, tone) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (tone ? ' ' + tone : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function confetti() {
  if (reducedMotion) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const w = canvas.width = window.innerWidth;
  const h = canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const colors = ['#2563eb', '#16a34a', '#d97706', '#ffffff', '#1c1c1e'];
  const bits = Array.from({ length: 90 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.5,
    y: h * 0.32 + (Math.random() - 0.5) * 60,
    vx: (Math.random() - 0.5) * 9,
    vy: Math.random() * -11 - 3,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.32;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.globalAlpha = Math.max(0, 1 - t / 2200);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
      ctx.restore();
    }
    if (t < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}

function setChrome(title, showBack) {
  pageTitle.textContent = title;
  backBtn.classList.toggle('hidden', !showBack);
  window.scrollTo(0, 0);
}

// Every screen change tears down the previous screen's live run.
function leaveScreen() {
  stopPolling();
  run = null;
  readyHook = null;
  selectedFiles = [];
  sigDrawn = false;
  setTopProgress(null);
}

function setTopProgress(fraction) {
  if (fraction == null) {
    topProgress.classList.remove('on');
    topProgress.firstElementChild.style.width = '0%';
    return;
  }
  topProgress.classList.add('on');
  topProgress.classList.toggle('full', fraction >= 1);
  topProgress.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
}

/* ---------------- Who's working (no login, just a name) ---------------- */

function myName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function setMyName(n) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ }
}

function askName(onDone) {
  app.innerHTML = `
    <div class="card name-gate">
      <h2>Who's working this list?</h2>
      <p>First name is enough. It shows next to the boxes you check so whoever else is helping can see what's already done.</p>
      <input type="text" id="gate-name" placeholder="Your first name" autocomplete="given-name" value="${escAttr(myName())}">
      <button class="submit-btn" id="gate-go">Start</button>
      <div class="error-msg" id="gate-err"></div>
    </div>`;
  const input = document.getElementById('gate-name');
  const go = () => {
    const v = input.value.trim();
    if (!v) { document.getElementById('gate-err').textContent = 'Enter your name to start.'; return; }
    setMyName(v);
    onDone(v);
  };
  document.getElementById('gate-go').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  input.focus();
}

/* ---------------- Loading the checklists ---------------- */

function readCache() {
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applyLists(rows) {
  CHECKLISTS = {};
  LIST_ORDER = [];
  for (const r of rows) {
    CHECKLISTS[r.key] = r;
    LIST_ORDER.push(r.key);
  }
}

async function loadChecklists() {
  const cached = readCache();
  if (cached) applyLists(cached);
  try {
    const res = await fetch('/api/checklists');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    applyLists(rows);
    try { localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(rows)); } catch { /* full or private */ }
    return true;
  } catch {
    return !!cached; // fall back to what this phone already had
  }
}

function kindLabel(kind) {
  if (kind === 'issue') return 'Issue Report';
  return (CHECKLISTS[kind] && CHECKLISTS[kind].title) || kind;
}

/* ---------------- Home ---------------- */

function showHome() {
  leaveScreen();
  setChrome('Venue Checklist', false);
  const name = myName();
  app.innerHTML = `
    ${name ? `<p class="hello">Hey ${esc(name)} — what are you doing today?<button class="link-btn" id="change-name">not you?</button></p>` : ''}
    <div class="home-grid">
      ${LIST_ORDER.map((key) => {
        const c = CHECKLISTS[key];
        return `
        <button class="home-btn" data-checklist="${escAttr(key)}">
          <span class="icon">${esc(c.icon)}</span>
          <span>${esc(c.title)}<span class="sub">${esc(c.purpose)}</span></span>
        </button>`;
      }).join('')}
      <button class="home-btn issue" data-issue="1">
        <span class="icon">⚠️</span>
        <span>Report Issue / Low Supplies<span class="sub">Cleaning, damage, supplies, equipment &amp; more</span></span>
      </button>
    </div>
    <button class="edit-lists-btn" id="edit-lists">Edit the checklists</button>`;

  app.querySelectorAll('[data-checklist]').forEach((b) =>
    b.addEventListener('click', () => showChecklist(b.dataset.checklist)));
  app.querySelector('[data-issue]').addEventListener('click', showIssueForm);
  app.querySelector('#edit-lists').addEventListener('click', showEditorGate);
  const cn = document.getElementById('change-name');
  if (cn) cn.addEventListener('click', () => askName(() => showHome()));
}

/* ---------------- Photo picker (shared) ---------------- */

function photoSectionHTML(required, shared) {
  return `
    <label class="field-label">Photos${required ? ' (required)' : ''}${shared ? ' <span class="shared-tag">shared</span>' : ''}</label>
    <input type="file" id="photo-input" accept="image/*" multiple hidden>
    <button type="button" class="photo-btn" id="photo-btn">\u{1F4F7} Add Photos</button>
    <div class="photo-previews" id="photo-previews"></div>`;
}

function wirePhotoSection() {
  const input = document.getElementById('photo-input');
  const btn = document.getElementById('photo-btn');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    for (const f of input.files) {
      if (selectedFiles.length >= 8) break;
      selectedFiles.push(f);
    }
    input.value = '';
    renderPreviews();
    uploadPendingPhotos();
  });
}

// On a checklist, photos go straight onto the shared run so the partner's
// pictures reach the report no matter who submits. If that upload fails the
// file simply stays staged here and rides along with the submission instead —
// this can only ever add photos, never lose them.
async function uploadPendingPhotos() {
  if (!run || !run.sessionId || !selectedFiles.length || run.photoUploading) return;
  run.photoUploading = true;
  const batch = selectedFiles.slice(0, 8);
  try {
    const fd = new FormData();
    batch.forEach((f) => fd.append('photos', f));
    fd.append('by', run.me);
    const res = await fetch(`/api/sessions/${run.sessionId}/photos`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { photos } = await res.json();
    selectedFiles = selectedFiles.filter((f) => !batch.includes(f));
    run.photos = photos;
    renderPreviews();
    setOffline(false);
  } catch {
    setOffline(true);
  } finally {
    run.photoUploading = false;
  }
}

function renderPreviews() {
  const wrap = document.getElementById('photo-previews');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Photos already on the shared run — everyone's, tagged with who took them.
  if (run && run.photos) {
    for (const p of run.photos) {
      const div = document.createElement('div');
      div.className = 'thumb';
      const img = document.createElement('img');
      img.src = p.url;
      div.appendChild(img);
      if (p.by && p.by !== run.me) {
        const tag = document.createElement('span');
        tag.className = 'thumb-by';
        tag.textContent = p.by;
        div.appendChild(tag);
      } else {
        const rm = document.createElement('button');
        rm.className = 'remove';
        rm.textContent = '×';
        rm.addEventListener('click', () => removeSharedPhoto(p.url));
        div.appendChild(rm);
      }
      wrap.appendChild(div);
    }
  }

  // Anything still waiting to go up (or the issue form, which never shares).
  selectedFiles.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'thumb' + (run ? ' pending' : '');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => { selectedFiles.splice(i, 1); renderPreviews(); });
    div.append(img, rm);
    wrap.appendChild(div);
  });

  if (readyHook) readyHook();
}

async function removeSharedPhoto(url) {
  try {
    const res = await fetch(`/api/sessions/${run.sessionId}/photos/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, by: run.me }),
    });
    if (!res.ok) { toast((await res.json()).error || 'Could not remove that photo'); return; }
    run.photos = run.photos.filter((p) => p.url !== url);
    renderPreviews();
  } catch {
    toast('Could not remove that photo — no signal');
  }
}

/* ---------------- Signature pad (shared) ---------------- */

function signatureSectionHTML() {
  return `
    <label class="field-label">Signature (required)</label>
    <canvas class="sig-canvas" id="sig-canvas"></canvas>
    <button type="button" class="sig-clear" id="sig-clear">Clear signature</button>`;
}

function wireSignature() {
  const canvas = document.getElementById('sig-canvas');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const blank = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    sigDrawn = false;
    if (readyHook) readyHook();
  };
  blank();
  ctx.strokeStyle = '#1c1c1e';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drawing = true;
    sigDrawn = true;
    if (readyHook) readyHook();
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });
  document.getElementById('sig-clear').addEventListener('click', blank);
}

function signatureBlob() {
  if (!sigDrawn) return Promise.resolve(null);
  const canvas = document.getElementById('sig-canvas');
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/* ---------------- Checklist screen ---------------- */

// Splits a list's items into checkable tasks and the section each one sits under.
function buildRun(key) {
  const list = CHECKLISTS[key];
  const tasks = [];
  const groups = [];
  let current = null;
  for (const item of list.items) {
    if (item.type === 'section') {
      current = { name: item.text, first: tasks.length, count: 0 };
      groups.push(current);
    } else {
      if (!current) {
        current = { name: '', first: tasks.length, count: 0 };
        groups.push(current);
      }
      tasks.push({ label: item.text, section: current.name });
      current.count += 1;
    }
  }
  return { key, list, tasks, groups: groups.filter((g) => g.count > 0) };
}

function showChecklist(key) {
  leaveScreen();
  if (!myName()) {
    setChrome(CHECKLISTS[key].title, true);
    askName(() => showChecklist(key));
    return;
  }
  const base = buildRun(key);
  run = {
    ...base,
    me: myName(),
    sessionId: null,
    version: -1,
    state: {},            // taskIndex -> { label, by, at }
    pending: new Map(),    // taskIndex -> desired done, not yet confirmed by the server
    photos: [],            // { url, by, at } shared across both phones
    photoUploading: false,
    participants: [],
    celebrated: false,
    doneSections: new Set(),
    offline: false,
    notesDirtyUntil: 0,
  };
  setChrome(base.list.title, true);
  renderChecklist();
  joinSession();
}

function renderChecklist() {
  const c = run.list;
  const total = run.tasks.length;

  let taskHTML = '';
  let taskIndex = 0;
  for (const item of c.items) {
    if (item.type === 'section') {
      const g = run.groups.find((x) => x.name === item.text && x.first === taskIndex);
      if (!g) continue;
      taskHTML += `
        <div class="section-head" data-sec="${escAttr(item.text)}">
          <div class="sec-top">
            <span class="sec-title">${esc(item.text)}</span>
            <span class="sec-count" data-sec-count="${escAttr(item.text)}">0/${g.count}</span>
          </div>
          <div class="sec-bar"><i data-sec-bar="${escAttr(item.text)}"></i></div>
        </div>`;
    } else {
      taskHTML += `
        <label class="task" data-row="${taskIndex}">
          <input type="checkbox" data-task="${taskIndex}">
          <span class="task-text">${esc(item.text)}</span>
          <span class="by" data-by="${taskIndex}"></span>
        </label>`;
      taskIndex += 1;
    }
  }

  app.innerHTML = `
    <p class="purpose">${esc(c.purpose)}</p>

    <div class="card presence-card">
      <div class="presence" id="presence">Joining the list…</div>
      <button class="link-btn" id="fresh-run">Start a fresh run</button>
    </div>

    <div class="card progress-card">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 80 80" aria-hidden="true">
          <circle class="ring-bg" cx="40" cy="40" r="34"></circle>
          <circle class="ring-fg" id="ring-fg" cx="40" cy="40" r="34"
                  stroke-dasharray="213.6" stroke-dashoffset="213.6"></circle>
        </svg>
        <span class="ring-pct" id="ring-pct">0%</span>
      </div>
      <div class="ring-copy">
        <strong id="p-count">0 of ${total} done</strong>
        <span id="p-left">${total} to go</span>
      </div>
    </div>

    <div class="card task-card">${taskHTML}</div>

    <div class="card">
      <label class="field-label" for="f-notes">Notes <span class="shared-tag">shared</span></label>
      <textarea id="f-notes" placeholder="Anything to flag? Damage, leftovers, supplies running low..."></textarea>
      ${photoSectionHTML(true, true)}
    </div>

    <div class="card">
      <label class="field-label" for="f-name">Submitting as</label>
      <input type="text" id="f-name" placeholder="Enter your name" autocomplete="name" value="${escAttr(run.me)}">
      <label class="field-label" for="f-date">Date</label>
      <input type="date" id="f-date" value="${todayISO()}">
      <div class="complete-row" style="padding:4px 0 10px">
        <span>Had a helper?</span>
        <label class="switch">
          <input type="checkbox" id="f-had-helper">
          <span class="slider"></span>
        </label>
      </div>
      <div id="helper-wrap" style="display:none">
        <label class="field-label" for="f-helper-name">Helper's Name</label>
        <input type="text" id="f-helper-name" placeholder="Who helped you?">
      </div>
    </div>

    <div class="card">${signatureSectionHTML()}</div>

    <div class="card">
      <div class="complete-row">
        <span>Mark checklist complete</span>
        <label class="switch">
          <input type="checkbox" id="f-complete">
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <button class="submit-btn" id="submit-btn">Submit ${esc(c.title)}</button>
    <div class="ready-line" id="ready-line"></div>
    <div class="error-msg" id="error-msg"></div>`;

  wirePhotoSection();
  wireSignature();

  document.getElementById('f-had-helper').addEventListener('change', (e) => {
    document.getElementById('helper-wrap').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('f-name').addEventListener('input', updateReady);

  // The complete toggle flips itself on at 100%, unless the person touched it.
  const completeToggle = document.getElementById('f-complete');
  completeToggle.addEventListener('change', () => { run.completeTouched = true; });

  app.querySelectorAll('[data-task]').forEach((box) => {
    box.addEventListener('change', () => toggleTask(Number(box.dataset.task), box.checked));
  });

  document.getElementById('fresh-run').addEventListener('click', async () => {
    if (!confirm('Start over with an empty list? This ends the run in progress for everyone on it.')) return;
    await joinSession({ fresh: true });
    toast('Fresh run started');
  });

  wireNotesSync();

  readyHook = updateReady;
  applyProgress({ silent: true });
  updateReady();

  document.getElementById('submit-btn').addEventListener('click', submitChecklist);
}

/* ---------------- Live shared run ---------------- */

async function joinSession(opts = {}) {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(run.key)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: run.me, fresh: !!opts.fresh }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const session = await res.json();
    run.sessionId = session.id;
    run.pending.clear();
    absorb(session, { silent: true });
    setOffline(false);
    startPolling();
  } catch {
    setOffline(true);
    document.getElementById('presence').textContent =
      'Offline — your checks are saved on this phone and will send when you reconnect.';
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(tick, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function tick() {
  if (!run || !run.sessionId || document.hidden) return;
  try {
    const res = await fetch(
      `/api/sessions/${run.sessionId}?name=${encodeURIComponent(run.me)}`
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const session = await res.json();
    setOffline(false);
    if (session.closed) {
      // Someone submitted the run out from under us — say who, then pick up a clean one.
      stopPolling();
      toast(session.closedBy
        ? `${session.closedBy} submitted this list. Starting a fresh one.`
        : 'That run was submitted. Starting a fresh list.');
      buzz([20, 60, 20]);
      await joinSession({ fresh: false });
      return;
    }
    absorb(session);
    flushPending();
  } catch {
    setOffline(true);
  }
}

// Merges the server's copy of the run into this phone, keeping any of our own
// taps that haven't been confirmed yet.
function absorb(session, opts = {}) {
  const previous = run.state;
  const incoming = {};
  for (const [k, v] of Object.entries(session.state || {})) {
    const idx = Number(k);
    // If the list was edited mid-run, drop checks that no longer line up.
    if (run.tasks[idx] && run.tasks[idx].label === v.label) incoming[idx] = v;
  }
  for (const [idx, want] of run.pending) {
    if (want) incoming[idx] = incoming[idx] || { label: run.tasks[idx].label, by: run.me, at: new Date().toISOString() };
    else delete incoming[idx];
  }

  run.state = incoming;
  run.version = session.version;
  run.participants = session.participants || [];

  // Notes are shared, but never yank the box out from under someone typing.
  const notes = document.getElementById('f-notes');
  if (notes && document.activeElement !== notes && Date.now() > run.notesDirtyUntil && notes.value !== session.notes) {
    notes.value = session.notes || '';
  }

  // Photos the partner took, appearing on this phone.
  const incomingPhotos = session.photos || [];
  const knownPhotos = new Set(run.photos.map((p) => p.url));
  const freshPhotos = incomingPhotos.filter((p) => !knownPhotos.has(p.url) && p.by && p.by !== run.me);
  if (incomingPhotos.length !== run.photos.length || freshPhotos.length) {
    run.photos = incomingPhotos;
    renderPreviews();
    if (!opts.silent && freshPhotos.length) {
      toast(`${freshPhotos[0].by} added ${freshPhotos.length} photo${freshPhotos.length === 1 ? '' : 's'}`);
    }
  }

  const newlyByOthers = [];
  if (!opts.silent) {
    for (const idx of Object.keys(incoming)) {
      if (!previous[idx] && incoming[idx].by && incoming[idx].by !== run.me) {
        newlyByOthers.push(incoming[idx]);
      }
    }
  }

  renderPresence();
  applyProgress({ silent: opts.silent, remote: newlyByOthers.map((x) => x.label) });

  if (newlyByOthers.length === 1) {
    toast(`${newlyByOthers[0].by} checked: ${newlyByOthers[0].label}`);
  } else if (newlyByOthers.length > 1) {
    toast(`${newlyByOthers[0].by} checked ${newlyByOthers.length} more`);
  }
}

function renderPresence() {
  const el = document.getElementById('presence');
  if (!el) return;
  const others = run.participants.filter((p) => p.here && p.name !== run.me).map((p) => p.name);
  if (run.offline) {
    el.innerHTML = `<span class="dot off"></span>Offline — saved on this phone`;
  } else if (others.length === 0) {
    el.innerHTML = `<span class="dot"></span>Just you on this list`;
  } else {
    el.innerHTML = `<span class="dot"></span>You + ${esc(others.join(' + '))} — working this together`;
  }
}

function setOffline(v) {
  if (!run || run.offline === v) return;
  run.offline = v;
  renderPresence();
}

function toggleTask(index, done) {
  if (!run) return;
  run.pending.set(index, done);
  if (done) {
    run.state[index] = { label: run.tasks[index].label, by: run.me, at: new Date().toISOString() };
    buzz(12);
    const row = app.querySelector(`[data-row="${index}"]`);
    if (row && !reducedMotion) {
      row.classList.remove('just-checked');
      void row.offsetWidth;
      row.classList.add('just-checked');
    }
  } else {
    delete run.state[index];
  }
  applyProgress();
  pushToggle(index, done);
}

async function pushToggle(index, done) {
  if (!run.sessionId) { setOffline(true); return; }
  try {
    const res = await fetch(`/api/sessions/${run.sessionId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, done, label: run.tasks[index].label, by: run.me }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (run.pending.get(index) === done) run.pending.delete(index);
    setOffline(false);
  } catch {
    setOffline(true); // stays in pending; the next tick resends it
  }
}

// Resend anything the server never acknowledged (dead spot in the building).
function flushPending() {
  if (run.offline) return;
  for (const [index, done] of [...run.pending]) pushToggle(index, done);
  uploadPendingPhotos();
}

function wireNotesSync() {
  const notes = document.getElementById('f-notes');
  let timer = null;
  notes.addEventListener('input', () => {
    run.notesDirtyUntil = Date.now() + 3000;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!run || !run.sessionId) return;
      try {
        await fetch(`/api/sessions/${run.sessionId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: notes.value, by: run.me }),
        });
      } catch { /* the next attempt will carry it */ }
    }, 800);
  });
}

/* ---------------- Progress, sections, celebration ---------------- */

const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

function applyProgress(opts = {}) {
  const total = run.tasks.length;
  const doneIdx = new Set(Object.keys(run.state).map(Number));
  const done = doneIdx.size;
  const fraction = total ? done / total : 0;

  // Checkboxes + who checked them
  const showWho = run.participants.filter((p) => p.name !== run.me).length > 0;
  run.tasks.forEach((t, i) => {
    const box = app.querySelector(`[data-task="${i}"]`);
    if (!box) return;
    const isDone = doneIdx.has(i);
    if (box.checked !== isDone) {
      box.checked = isDone;
      if (isDone && opts.remote && opts.remote.includes(t.label) && !reducedMotion) {
        const row = app.querySelector(`[data-row="${i}"]`);
        if (row) {
          row.classList.remove('remote-checked');
          void row.offsetWidth;
          row.classList.add('remote-checked');
        }
      }
    }
    const by = app.querySelector(`[data-by="${i}"]`);
    if (by) {
      const entry = run.state[i];
      by.textContent = isDone && showWho && entry && entry.by ? entry.by : '';
    }
  });

  // Ring
  const ring = document.getElementById('ring-fg');
  if (ring) {
    ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
    ring.classList.toggle('full', done === total && total > 0);
  }
  const pct = document.getElementById('ring-pct');
  if (pct) pct.textContent = `${Math.round(fraction * 100)}%`;
  const count = document.getElementById('p-count');
  if (count) count.textContent = `${done} of ${total} done`;
  const left = document.getElementById('p-left');
  if (left) {
    left.textContent = done === total && total > 0
      ? 'Every task checked'
      : `${total - done} to go`;
    left.classList.toggle('all-done', done === total && total > 0);
  }
  setTopProgress(fraction);

  // Sections
  for (const g of run.groups) {
    if (!g.name) continue;
    let gDone = 0;
    for (let i = g.first; i < g.first + g.count; i++) if (doneIdx.has(i)) gDone += 1;
    const cEl = app.querySelector(`[data-sec-count="${cssEscape(g.name)}"]`);
    const bEl = app.querySelector(`[data-sec-bar="${cssEscape(g.name)}"]`);
    const hEl = app.querySelector(`[data-sec="${cssEscape(g.name)}"]`);
    if (cEl) cEl.textContent = gDone === g.count ? 'Done' : `${gDone}/${g.count}`;
    if (bEl) bEl.style.width = `${(gDone / g.count) * 100}%`;
    const complete = gDone === g.count;
    if (hEl) {
      hEl.classList.toggle('complete', complete);
      if (complete && !run.doneSections.has(g.name)) {
        run.doneSections.add(g.name);
        if (!opts.silent) {
          buzz([10, 45, 18]);
          if (!reducedMotion) {
            hEl.classList.remove('flash');
            void hEl.offsetWidth;
            hEl.classList.add('flash');
          }
        }
      } else if (!complete) {
        run.doneSections.delete(g.name);
      }
    }
  }

  // The finish line
  if (total > 0 && done === total) {
    if (!run.celebrated && !opts.silent) {
      run.celebrated = true;
      confetti();
      buzz([18, 55, 18, 55, 40]);
      toast('All tasks checked — nice work.', 'good');
    }
    const ct = document.getElementById('f-complete');
    if (ct && !run.completeTouched && !ct.checked) ct.checked = true;
  } else {
    run.celebrated = false;
    const ct = document.getElementById('f-complete');
    if (ct && !run.completeTouched && ct.checked) ct.checked = false;
  }

  updateReady();
}

// Section names go into attribute selectors, so quotes have to be neutralised.
function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

/* ---------------- Submit readiness ---------------- */

function updateReady() {
  const line = document.getElementById('ready-line');
  const btn = document.getElementById('submit-btn');
  if (!line || !btn) return;

  const nameEl = document.getElementById('f-name');
  const sharedPhotos = run && run.photos ? run.photos.length : 0;
  const missing = [];
  if (!nameEl || !nameEl.value.trim()) missing.push('your name');
  if (selectedFiles.length + sharedPhotos === 0) missing.push('a photo');
  if (!sigDrawn) missing.push('your signature');

  if (missing.length) {
    line.className = 'ready-line need';
    line.textContent = `Still needed: ${missing.join(', ')}`;
    btn.classList.add('not-ready');
    return;
  }

  btn.classList.remove('not-ready');
  if (run && run.tasks.length) {
    const undone = run.tasks.length - Object.keys(run.state).length;
    if (undone > 0) {
      line.className = 'ready-line warn';
      line.textContent = `Ready to submit — ${undone} task${undone === 1 ? '' : 's'} still unchecked`;
      return;
    }
  }
  line.className = 'ready-line good';
  line.textContent = 'Ready to submit';
}

async function submitChecklist() {
  const name = document.getElementById('f-name').value.trim();
  const date = document.getElementById('f-date').value;
  const err = document.getElementById('error-msg');
  err.textContent = '';
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (!date) { err.textContent = 'Please select the date.'; return; }
  if (selectedFiles.length + run.photos.length === 0) { err.textContent = 'Please add at least one photo before submitting.'; return; }
  if (!sigDrawn) { err.textContent = 'Please sign before submitting.'; return; }

  // Submitting ends the run for everyone, so don't let one person wipe the
  // other's screen without knowing it.
  const stillHere = run.participants.filter((p) => p.here && p.name !== run.me).map((p) => p.name);
  if (stillHere.length) {
    const who = stillHere.join(' and ');
    const verb = stillHere.length === 1 ? 'is' : 'are';
    if (!confirm(`${who} ${verb} still on this list. Submitting finishes it for both of you and clears their screen. Submit anyway?`)) return;
  }

  const doneIdx = new Set(Object.keys(run.state).map(Number));
  const tasks = run.tasks.map((t, i) => ({
    label: t.label,
    section: t.section,
    done: doneIdx.has(i),
    by: doneIdx.has(i) ? (run.state[i].by || '') : '',
  }));

  const workers = [...new Set(run.participants.map((p) => p.name).concat(name))].filter(Boolean);
  const hadHelper = document.getElementById('f-had-helper').checked || workers.length > 1;
  const helperName = document.getElementById('f-helper-name').value.trim()
    || workers.filter((w) => w !== name).join(', ');

  const payload = {
    tasks,
    notes: document.getElementById('f-notes').value.trim(),
    complete: document.getElementById('f-complete').checked,
    hadHelper,
    helperName: hadHelper ? helperName : '',
    workers,
  };
  await submitForm(run.key, name, date, payload, run.list.title, run.sessionId);
}

/* ---------------- Issue form ---------------- */

function showIssueForm() {
  leaveScreen();
  setChrome('Report Issue', true);
  let urgency = 'Medium';

  app.innerHTML = `
    <p class="purpose">Report a problem or low supplies so it gets handled.</p>
    <div class="card">
      <label class="field-label" for="f-name">Your Name</label>
      <input type="text" id="f-name" placeholder="Enter your name" autocomplete="name" value="${escAttr(myName())}">
      <label class="field-label" for="f-date">Date</label>
      <input type="date" id="f-date" value="${todayISO()}">
      <label class="field-label" for="f-type">Issue Type</label>
      <select id="f-type">
        ${ISSUE_TYPES.map((t) => `<option>${t}</option>`).join('')}
      </select>
      <label class="field-label" for="f-desc">Description of Issue</label>
      <textarea id="f-desc" placeholder="Describe what's wrong or what's running low..."></textarea>
      <label class="field-label">Urgency</label>
      <div class="pill-row" id="urgency-row">
        ${URGENCIES.map((u) => `<button type="button" class="pill ${u === urgency ? 'active-' + u : ''}" data-u="${u}">${u}</button>`).join('')}
      </div>
      ${photoSectionHTML()}
    </div>
    <div class="card">
      <div class="complete-row">
        <span>Is this resolved?</span>
        <label class="switch">
          <input type="checkbox" id="f-resolved">
          <span class="slider"></span>
        </label>
      </div>
    </div>
    <button class="submit-btn" id="submit-btn">Submit Report</button>
    <div class="error-msg" id="error-msg"></div>`;

  wirePhotoSection();

  document.getElementById('urgency-row').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-u]');
    if (!btn) return;
    urgency = btn.dataset.u;
    document.querySelectorAll('#urgency-row .pill').forEach((p) => {
      p.className = 'pill' + (p.dataset.u === urgency ? ' active-' + urgency : '');
    });
  });

  document.getElementById('submit-btn').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    const date = document.getElementById('f-date').value;
    const desc = document.getElementById('f-desc').value.trim();
    const err = document.getElementById('error-msg');
    err.textContent = '';
    if (!name) { err.textContent = 'Please enter your name.'; return; }
    if (!date) { err.textContent = 'Please select the date.'; return; }
    if (!desc) { err.textContent = 'Please describe the issue.'; return; }

    const payload = {
      issueType: document.getElementById('f-type').value,
      description: desc,
      urgency,
      resolved: document.getElementById('f-resolved').checked,
    };
    await submitForm('issue', name, date, payload, 'Issue Report', null);
  });
}

/* ---------------- Submit ---------------- */

async function submitForm(kind, name, date, data, title, sessionId) {
  const btn = document.getElementById('submit-btn');
  const err = document.getElementById('error-msg');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('name', name);
    fd.append('date', date);
    fd.append('data', JSON.stringify(data));
    if (sessionId) fd.append('sessionId', sessionId);
    selectedFiles.forEach((f) => fd.append('photos', f));
    if (document.getElementById('sig-canvas')) {
      const sig = await signatureBlob();
      if (sig) fd.append('signature', sig, 'signature.png');
    }
    const res = await fetch('/api/submissions', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Server error');
    showSuccess(title);
  } catch {
    btn.disabled = false;
    btn.textContent = 'Submit';
    err.textContent = 'Submission failed. Check your connection and try again.';
  }
}

function showSuccess(title) {
  leaveScreen();
  setChrome('Submitted', false);
  app.innerHTML = `
    <div class="success-screen">
      <div class="big">✅</div>
      <h2>${esc(title)} submitted</h2>
      <p>Thanks! Your checklist has been saved.</p>
      <button class="submit-btn" id="home-btn">Back to Home</button>
    </div>`;
  document.getElementById('home-btn').addEventListener('click', showHome);
}

/* ---------------- Review submissions ---------------- */

let reviewFilter = 'all';

async function showReview() {
  leaveScreen();
  setChrome('Submissions', true);
  app.innerHTML = '<div class="empty">Loading...</div>';
  let subs;
  try {
    const res = await fetch('/api/submissions');
    subs = await res.json();
  } catch {
    app.innerHTML = '<div class="empty">Could not load submissions.</div>';
    return;
  }
  renderReview(subs);
}

function renderReview(subs) {
  const filters = [['all', 'All']]
    .concat(LIST_ORDER.map((k) => [k, CHECKLISTS[k].title]))
    .concat([['issue', 'Issues']]);
  const shown = reviewFilter === 'all' ? subs : subs.filter((s) => s.kind === reviewFilter);

  app.innerHTML = `
    <div class="filter-row">
      ${filters.map(([k, l]) => `<button class="pill ${reviewFilter === k ? 'on' : ''}" data-f="${escAttr(k)}">${esc(l)}</button>`).join('')}
    </div>
    <div id="sub-list">
      ${shown.length ? shown.map(subCardHTML).join('') : '<div class="empty">No submissions yet.</div>'}
    </div>`;

  app.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => { reviewFilter = b.dataset.f; renderReview(subs); }));

  app.querySelectorAll('.sub-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a, .resolve-btn')) return;
      const detail = card.querySelector('.sub-detail');
      detail.style.display = detail.style.display === 'block' ? 'none' : 'block';
    });
  });

  app.querySelectorAll('.resolve-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch(`/api/submissions/${btn.dataset.id}/resolve`, { method: 'PATCH' });
      showReview();
    });
  });
}

function subCardHTML(s) {
  const when = new Date(s.created_at.replace(' ', 'T') + 'Z');
  const submitted = when.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  let badge, detail;
  if (s.kind === 'issue') {
    badge = `<span class="badge urgency-${escAttr(s.data.urgency)}">${esc(s.data.urgency)}</span>
             <span class="badge ${s.data.resolved ? 'resolved' : 'open'}">${s.data.resolved ? 'Resolved' : 'Open'}</span>`;
    detail = `
      <h4>${esc(s.data.issueType)} issue</h4>
      <p class="notes-text">${esc(s.data.description)}</p>
      ${photosHTML(s.photos)}
      <button class="resolve-btn" data-id="${escAttr(s.id)}">${s.data.resolved ? 'Reopen Issue' : 'Mark Resolved'}</button>`;
  } else {
    const tasks = s.data.tasks || [];
    const done = tasks.filter((t) => t.done).length;
    const missed = tasks.filter((t) => !t.done);
    const multi = Array.isArray(s.data.workers) && s.data.workers.length > 1;
    badge = `<span class="badge ${s.data.complete && missed.length === 0 ? 'complete' : 'incomplete'}">
               ${s.data.complete ? (missed.length ? `Complete · ${missed.length} missed` : 'Complete') : 'Incomplete'}
             </span>`;

    let lastSection = null;
    const taskRows = tasks.map((t) => {
      let head = '';
      if (t.section && t.section !== lastSection) {
        lastSection = t.section;
        head = `<div class="detail-section">${esc(t.section)}</div>`;
      }
      const who = multi && t.done && t.by ? `<span class="detail-by">${esc(t.by)}</span>` : '';
      return `${head}
        <div class="detail-task ${t.done ? 'done' : 'missed'}">
          <span class="mark">${t.done ? '✓' : '✗'}</span><span>${esc(t.label)}</span>${who}
        </div>`;
    }).join('');

    detail = `
      <h4>Tasks (${done}/${tasks.length})</h4>
      ${taskRows}
      ${s.data.notes ? `<h4>Notes</h4><p class="notes-text">${esc(s.data.notes)}</p>` : ''}
      ${photosHTML(s.photos)}
      ${s.data.signature ? `<h4>Signature</h4><img class="sig-img" src="${escAttr(s.data.signature)}" alt="Signature">` : ''}`;
  }

  const who = Array.isArray(s.data.workers) && s.data.workers.length > 1
    ? s.data.workers.join(' + ')
    : s.name + (s.data.hadHelper ? ` + helper${s.data.helperName ? ': ' + s.data.helperName : ''}` : '');

  return `
    <div class="sub-card">
      <div class="row1">
        <span class="kind">${esc(kindLabel(s.kind))}</span>
        <span>${badge}</span>
      </div>
      <div class="meta">${esc(who)} · ${esc(s.date)} · submitted ${esc(submitted)}</div>
      <div class="sub-detail" style="display:none">${detail}</div>
    </div>`;
}

function photosHTML(photos) {
  if (!photos || !photos.length) return '';
  return `<h4>Photos</h4>
    <div class="detail-photos">
      ${photos.map((p) => `<a href="${escAttr(p)}" target="_blank"><img src="${escAttr(p)}" loading="lazy"></a>`).join('')}
    </div>`;
}

/* ---------------- Editing the checklists ---------------- */

function savedPin() {
  try { return sessionStorage.getItem(PIN_KEY) || ''; } catch { return ''; }
}

async function showEditorGate() {
  leaveScreen();
  setChrome('Edit Checklists', true);

  let pinRequired = true;
  try {
    const res = await fetch('/api/admin/status');
    pinRequired = (await res.json()).pinRequired;
  } catch { /* assume it is */ }

  if (!pinRequired || savedPin()) return showEditorHome();

  app.innerHTML = `
    <div class="card name-gate">
      <h2>Editor PIN</h2>
      <p>This only guards changing the master checklists. Working a list never asks for anything.</p>
      <input type="tel" id="pin" inputmode="numeric" placeholder="PIN" autocomplete="off">
      <button class="submit-btn" id="pin-go">Unlock</button>
      <div class="error-msg" id="pin-err"></div>
    </div>`;
  const input = document.getElementById('pin');
  const go = async () => {
    const err = document.getElementById('pin-err');
    err.textContent = '';
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'x-admin-pin': input.value.trim() },
      });
      if (!res.ok) { err.textContent = (await res.json()).error || 'Wrong PIN'; return; }
      try { sessionStorage.setItem(PIN_KEY, input.value.trim()); } catch { /* private mode */ }
      showEditorHome();
    } catch {
      err.textContent = 'Could not reach the server.';
    }
  };
  document.getElementById('pin-go').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  input.focus();
}

function showEditorHome() {
  setChrome('Edit Checklists', true);
  app.innerHTML = `
    <p class="purpose">Pick a checklist to change its tasks. Edits show up on everyone's phone the next time they open it.</p>
    <div class="home-grid">
      ${LIST_ORDER.map((key) => {
        const c = CHECKLISTS[key];
        const taskCount = c.items.filter((i) => i.type === 'task').length;
        return `
        <button class="home-btn" data-edit="${escAttr(key)}">
          <span class="icon">${esc(c.icon)}</span>
          <span>${esc(c.title)}<span class="sub">${taskCount} tasks</span></span>
        </button>`;
      }).join('')}
    </div>`;
  app.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => showEditList(b.dataset.edit)));
}

function showEditList(key) {
  const source = CHECKLISTS[key];
  setChrome('Edit: ' + source.title, true);

  const draft = {
    title: source.title,
    icon: source.icon,
    purpose: source.purpose,
    items: source.items.map((i) => ({ ...i })),
  };

  const render = () => {
    app.innerHTML = `
      <div class="card">
        <label class="field-label" for="e-title">Checklist name</label>
        <input type="text" id="e-title">
        <label class="field-label" for="e-icon">Icon</label>
        <input type="text" id="e-icon" maxlength="4" class="icon-input">
        <label class="field-label" for="e-purpose">One-line description</label>
        <input type="text" id="e-purpose">
      </div>

      <div class="card">
        <label class="field-label">Tasks and sections</label>
        <div id="edit-rows">
          ${draft.items.map((it, i) => `
            <div class="edit-row ${it.type}" data-i="${i}">
              <div class="edit-move">
                <button type="button" data-up="${i}" aria-label="Move up">↑</button>
                <button type="button" data-down="${i}" aria-label="Move down">↓</button>
              </div>
              <input class="edit-text" data-t="${i}" placeholder="${it.type === 'section' ? 'Section name' : 'Task'}">
              <button type="button" class="edit-del" data-del="${i}" aria-label="Delete">×</button>
            </div>`).join('')}
        </div>
        <div class="edit-add">
          <button type="button" id="add-task">+ Add task</button>
          <button type="button" id="add-section">+ Add section</button>
        </div>
      </div>

      <button class="submit-btn" id="save-list">Save changes</button>
      <button class="reset-btn" id="reset-list">Reset to the original list</button>
      <div class="error-msg" id="edit-err"></div>`;

    // Values are assigned rather than interpolated, so apostrophes survive.
    document.getElementById('e-title').value = draft.title;
    document.getElementById('e-icon').value = draft.icon;
    document.getElementById('e-purpose').value = draft.purpose;
    app.querySelectorAll('.edit-text').forEach((inp) => {
      inp.value = draft.items[Number(inp.dataset.t)].text;
      inp.addEventListener('input', () => { draft.items[Number(inp.dataset.t)].text = inp.value; });
    });

    document.getElementById('e-title').addEventListener('input', (e) => { draft.title = e.target.value; });
    document.getElementById('e-icon').addEventListener('input', (e) => { draft.icon = e.target.value; });
    document.getElementById('e-purpose').addEventListener('input', (e) => { draft.purpose = e.target.value; });

    app.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.up);
      if (i === 0) return;
      [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]];
      render();
    }));
    app.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.down);
      if (i >= draft.items.length - 1) return;
      [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]];
      render();
    }));
    app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      draft.items.splice(Number(b.dataset.del), 1);
      render();
    }));

    document.getElementById('add-task').addEventListener('click', () => {
      draft.items.push({ type: 'task', text: '' });
      render();
      const rows = app.querySelectorAll('.edit-text');
      rows[rows.length - 1].focus();
    });
    document.getElementById('add-section').addEventListener('click', () => {
      draft.items.push({ type: 'section', text: '' });
      render();
      const rows = app.querySelectorAll('.edit-text');
      rows[rows.length - 1].focus();
    });

    document.getElementById('save-list').addEventListener('click', () => saveList(key, draft));
    document.getElementById('reset-list').addEventListener('click', () => resetList(key));
  };

  render();
}

async function saveList(key, draft) {
  const err = document.getElementById('edit-err');
  const btn = document.getElementById('save-list');
  err.textContent = '';
  const items = draft.items.filter((i) => i.text.trim());
  if (!items.some((i) => i.type === 'task')) {
    err.textContent = 'A checklist needs at least one task.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/checklists/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': savedPin() },
      body: JSON.stringify({ ...draft, items }),
    });
    if (res.status === 401) {
      try { sessionStorage.removeItem(PIN_KEY); } catch { /* noop */ }
      showEditorGate();
      return;
    }
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    await loadChecklists();
    toast('Checklist saved', 'good');
    showEditorHome();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Save changes';
    err.textContent = e.message || 'Could not save. Check your connection.';
  }
}

async function resetList(key) {
  if (!confirm('Put this checklist back to the original tasks? Your edits to it will be lost.')) return;
  const err = document.getElementById('edit-err');
  try {
    const res = await fetch(`/api/checklists/${encodeURIComponent(key)}/reset`, {
      method: 'POST',
      headers: { 'x-admin-pin': savedPin() },
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Reset failed');
    await loadChecklists();
    toast('Back to the original list');
    showEditList(key);
  } catch (e) {
    err.textContent = e.message || 'Could not reset.';
  }
}

/* ---------------- Init ---------------- */

(async function init() {
  app.innerHTML = '<div class="empty">Loading…</div>';
  const ok = await loadChecklists();
  if (!ok) {
    app.innerHTML = `
      <div class="empty">
        Could not load the checklists.<br><br>
        <button class="submit-btn" id="retry">Try again</button>
      </div>`;
    document.getElementById('retry').addEventListener('click', () => location.reload());
    return;
  }
  showHome();
})();

// Coming back to the app after it slept: catch up right away instead of waiting.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && run && run.sessionId) tick();
});
