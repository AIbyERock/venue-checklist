/* Venue Checklist — single-page app */

const CHECKLISTS = {
  'event-setup': {
    title: 'Event Setup',
    icon: '\u{1F389}',
    purpose: 'Prepare the venue before guests arrive.',
    tasks: [
      'Main room is clean',
      'Tables are set up correctly',
      'Chairs are set up correctly',
      'Extra tables and chairs are stored neatly',
      'Floors are clean',
      'Bathrooms are clean and stocked',
      'Kitchen is clean and ready',
      'Trash cans have liners',
      'Entryway is clean',
      'Parking/entry area checked',
      'Temperature is comfortable',
      'Lights are set correctly',
      'Any special setup instructions are completed',
      'Final photo uploaded',
      'Venue is ready for guests',
    ],
  },
  'venue-turnover': {
    title: 'Venue Turnover',
    icon: '\u{1F9F9}',
    purpose: 'Clean and reset the venue after an event.',
    tasks: [
      'All trash picked up',
      'Trash cans emptied',
      'New liners installed',
      'Tables wiped clean',
      'Chairs wiped clean if needed',
      'Floors swept',
      'Floors mopped where needed',
      'Kitchen cleaned',
      'Refrigerator checked for leftover items',
      'Bathrooms cleaned',
      'Toilet paper restocked',
      'Paper towels restocked',
      'Soap checked',
      'Decorations/tape/balloons/signage removed',
      'Entryway cleaned',
      'Exterior trash checked',
      'Damage checked and documented',
      'Supplies checked',
      'Final photo uploaded',
      'Venue is clean and ready for next use',
    ],
  },
  'training-setup': {
    title: 'Training Club Setup',
    icon: '\u{1F3CB}️',
    purpose: 'Prepare the venue for SoulRnR / Training Club.',
    tasks: [
      'Training area cleared',
      'Tables/chairs moved or stored safely',
      'Equipment set out for workout',
      'Kettlebells organized',
      'Dumbbells organized',
      'Sandbags organized',
      'Wall balls organized',
      'Machines positioned if needed',
      'Workout flow is clear',
      'Walkways are clear',
      'Floor is dry and safe',
      'Timer/music ready',
      'Bathrooms checked',
      'Entry area checked',
      'Unused equipment stored neatly',
      'Final photo uploaded',
      'Space is ready for athletes',
    ],
  },
};

const ISSUE_TYPES = ['Cleaning', 'Damage', 'Supplies', 'Equipment', 'Bathroom', 'HVAC', 'Safety', 'Other'];
const URGENCIES = ['Low', 'Medium', 'High'];

const app = document.getElementById('app');
const pageTitle = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');
const reviewBtn = document.getElementById('review-btn');

let selectedFiles = []; // photos staged for the current form

backBtn.addEventListener('click', () => showHome());
reviewBtn.addEventListener('click', () => showReview());

function setChrome(title, showBack) {
  pageTitle.textContent = title;
  backBtn.classList.toggle('hidden', !showBack);
  window.scrollTo(0, 0);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

/* ---------------- Home ---------------- */

function showHome() {
  setChrome('Venue Checklist', false);
  selectedFiles = [];
  app.innerHTML = `
    <div class="home-grid">
      ${Object.entries(CHECKLISTS).map(([key, c]) => `
        <button class="home-btn" data-checklist="${key}">
          <span class="icon">${c.icon}</span>
          <span>${esc(c.title)}<span class="sub">${esc(c.purpose)}</span></span>
        </button>`).join('')}
      <button class="home-btn issue" data-issue="1">
        <span class="icon">⚠️</span>
        <span>Report Issue / Low Supplies<span class="sub">Cleaning, damage, supplies, equipment &amp; more</span></span>
      </button>
    </div>`;
  app.querySelectorAll('[data-checklist]').forEach((b) =>
    b.addEventListener('click', () => showChecklist(b.dataset.checklist)));
  app.querySelector('[data-issue]').addEventListener('click', showIssueForm);
}

/* ---------------- Photo picker (shared) ---------------- */

function photoSectionHTML() {
  return `
    <label class="field-label">Photos</label>
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
  });
}

function renderPreviews() {
  const wrap = document.getElementById('photo-previews');
  wrap.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
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
}

/* ---------------- Checklist form ---------------- */

function showChecklist(key) {
  const c = CHECKLISTS[key];
  setChrome(c.title, true);
  selectedFiles = [];

  app.innerHTML = `
    <p class="purpose">${esc(c.purpose)}</p>
    <div class="card">
      <label class="field-label" for="f-name">Your Name</label>
      <input type="text" id="f-name" placeholder="Enter your name" autocomplete="name">
      <label class="field-label" for="f-date">Date</label>
      <input type="date" id="f-date" value="${todayISO()}">
    </div>
    <div class="card">
      <div class="progress" id="progress"></div>
      ${c.tasks.map((t, i) => `
        <label class="task">
          <input type="checkbox" data-task="${i}">
          <span>${esc(t)}</span>
        </label>`).join('')}
    </div>
    <div class="card">
      <label class="field-label" for="f-notes">Notes</label>
      <textarea id="f-notes" placeholder="Anything to flag? Damage, leftovers, supplies running low..."></textarea>
      ${photoSectionHTML()}
    </div>
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
    <div class="error-msg" id="error-msg"></div>`;

  wirePhotoSection();

  const boxes = [...app.querySelectorAll('[data-task]')];
  const progress = document.getElementById('progress');
  const updateProgress = () => {
    const done = boxes.filter((b) => b.checked).length;
    progress.innerHTML = `<span class="${done === boxes.length ? 'done' : ''}">${done} / ${boxes.length} tasks done</span>`;
  };
  boxes.forEach((b) => b.addEventListener('change', updateProgress));
  updateProgress();

  document.getElementById('submit-btn').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    const date = document.getElementById('f-date').value;
    const err = document.getElementById('error-msg');
    err.textContent = '';
    if (!name) { err.textContent = 'Please enter your name.'; return; }
    if (!date) { err.textContent = 'Please select the date.'; return; }

    const tasks = c.tasks.map((label, i) => ({ label, done: boxes[i].checked }));
    const payload = {
      tasks,
      notes: document.getElementById('f-notes').value.trim(),
      complete: document.getElementById('f-complete').checked,
    };
    await submitForm(key, name, date, payload, c.title);
  });
}

/* ---------------- Issue form ---------------- */

function showIssueForm() {
  setChrome('Report Issue', true);
  selectedFiles = [];
  let urgency = 'Medium';

  app.innerHTML = `
    <p class="purpose">Report a problem or low supplies so it gets handled.</p>
    <div class="card">
      <label class="field-label" for="f-name">Your Name</label>
      <input type="text" id="f-name" placeholder="Enter your name" autocomplete="name">
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
    await submitForm('issue', name, date, payload, 'Issue Report');
  });
}

/* ---------------- Submit ---------------- */

async function submitForm(kind, name, date, data, title) {
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
    selectedFiles.forEach((f) => fd.append('photos', f));
    const res = await fetch('/api/submissions', { method: 'POST', body: fd });
    if (res.status === 401) { window.location.reload(); return; }
    if (!res.ok) throw new Error('Server error');
    showSuccess(title);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Submit';
    err.textContent = 'Submission failed. Check your connection and try again.';
  }
}

function showSuccess(title) {
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

const KIND_LABELS = {
  'event-setup': 'Event Setup',
  'venue-turnover': 'Venue Turnover',
  'training-setup': 'Training Club Setup',
  issue: 'Issue Report',
};

let reviewFilter = 'all';

async function showReview() {
  setChrome('Submissions', true);
  app.innerHTML = '<div class="empty">Loading...</div>';
  let subs;
  try {
    const res = await fetch('/api/submissions');
    if (res.status === 401) { window.location.reload(); return; }
    subs = await res.json();
  } catch {
    app.innerHTML = '<div class="empty">Could not load submissions.</div>';
    return;
  }
  renderReview(subs);
}

function renderReview(subs) {
  const filters = [
    ['all', 'All'],
    ['event-setup', 'Event'],
    ['venue-turnover', 'Turnover'],
    ['training-setup', 'Training'],
    ['issue', 'Issues'],
  ];
  const shown = reviewFilter === 'all' ? subs : subs.filter((s) => s.kind === reviewFilter);

  app.innerHTML = `
    <div class="filter-row">
      ${filters.map(([k, l]) => `<button class="pill ${reviewFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
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
    badge = `<span class="badge urgency-${esc(s.data.urgency)}">${esc(s.data.urgency)}</span>
             <span class="badge ${s.data.resolved ? 'resolved' : 'open'}">${s.data.resolved ? 'Resolved' : 'Open'}</span>`;
    detail = `
      <h4>${esc(s.data.issueType)} issue</h4>
      <p class="notes-text">${esc(s.data.description)}</p>
      ${photosHTML(s.photos)}
      <button class="resolve-btn" data-id="${s.id}">${s.data.resolved ? 'Reopen Issue' : 'Mark Resolved'}</button>`;
  } else {
    const tasks = s.data.tasks || [];
    const done = tasks.filter((t) => t.done).length;
    const missed = tasks.filter((t) => !t.done);
    badge = `<span class="badge ${s.data.complete && missed.length === 0 ? 'complete' : 'incomplete'}">
               ${s.data.complete ? (missed.length ? `Complete · ${missed.length} missed` : 'Complete') : 'Incomplete'}
             </span>`;
    detail = `
      <h4>Tasks (${done}/${tasks.length})</h4>
      ${tasks.map((t) => `
        <div class="detail-task ${t.done ? 'done' : 'missed'}">
          <span class="mark">${t.done ? '✓' : '✗'}</span><span>${esc(t.label)}</span>
        </div>`).join('')}
      ${s.data.notes ? `<h4>Notes</h4><p class="notes-text">${esc(s.data.notes)}</p>` : ''}
      ${photosHTML(s.photos)}`;
  }

  return `
    <div class="sub-card">
      <div class="row1">
        <span class="kind">${esc(KIND_LABELS[s.kind] || s.kind)}</span>
        <span>${badge}</span>
      </div>
      <div class="meta">${esc(s.name)} · ${esc(s.date)} · submitted ${esc(submitted)}</div>
      <div class="sub-detail" style="display:none">${detail}</div>
    </div>`;
}

function photosHTML(photos) {
  if (!photos || !photos.length) return '';
  return `<h4>Photos</h4>
    <div class="detail-photos">
      ${photos.map((p) => `<a href="${esc(p)}" target="_blank"><img src="${esc(p)}" loading="lazy"></a>`).join('')}
    </div>`;
}

/* ---------------- Init ---------------- */
showHome();
