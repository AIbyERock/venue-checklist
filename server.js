const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_CHECKLISTS } = require('./checklists.default');

const PORT = process.env.PORT || 3000;
// On Render, DATA_DIR points at the persistent disk so the DB and photos survive deploys
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Email notifications (Resend). Without RESEND_API_KEY, submissions still save — emails are skipped.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'wulff.a.eric@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Venue Checklist <onboarding@resend.dev>';
// RENDER_EXTERNAL_URL is set automatically by Render; used for photo links in emails
const APP_URL = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// PIN for editing the master checklists. Set ADMIN_PIN=off to remove the gate entirely.
// Nothing else in the app is gated — working a checklist never asks for anything.
const ADMIN_PIN = process.env.ADMIN_PIN || '324324';
const PIN_DISABLED = ADMIN_PIN.toLowerCase() === 'off';

// A shared session stays joinable for this long since its last activity.
const SESSION_HOURS = 12;
// Someone is shown as "here now" if they polled within this many seconds.
const PRESENCE_SECONDS = 60;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'data.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    photos TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checklists (
    key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    participants TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    notes_by TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS sessions_kind_open ON sessions (kind, closed, updated_at);
`);

// Adds a column to an existing table without disturbing the data already in it.
// CREATE TABLE IF NOT EXISTS is a no-op once the table exists, so new columns
// have to come through here.
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('sessions', 'closed_by', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sessions', 'photos', "TEXT NOT NULL DEFAULT '[]'");

// Seed the default checklists once. After this the DB is the source of truth and
// the defaults are only used by "Reset to original" in the editor.
{
  const seed = db.prepare(
    'INSERT OR IGNORE INTO checklists (key, title, icon, purpose, items, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  DEFAULT_CHECKLISTS.forEach((c, i) => {
    seed.run(c.key, c.title, c.icon, c.purpose, JSON.stringify(c.items), i);
  });
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- Helpers ----

const KIND_LABELS = {
  'event-setup': 'Event Setup',
  'venue-turnover': 'Venue Turnover',
  'training-setup': 'Training Club Setup',
  issue: 'Issue Report',
};

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function labelForKind(kind) {
  if (kind === 'issue') return 'Issue Report';
  const row = db.prepare('SELECT title FROM checklists WHERE key = ?').get(kind);
  return (row && row.title) || KIND_LABELS[kind] || kind;
}

// ---- Checklists (content the venue can edit from the app) ----

function readChecklists() {
  return db
    .prepare('SELECT * FROM checklists ORDER BY sort_order ASC, title ASC')
    .all()
    .map((r) => ({
      key: r.key,
      title: r.title,
      icon: r.icon,
      purpose: r.purpose,
      items: JSON.parse(r.items),
      updated_at: r.updated_at,
    }));
}

app.get('/api/checklists', (req, res) => res.json(readChecklists()));

// Simple throttle so the editor PIN can't be brute-forced from the open internet.
const pinFails = new Map(); // ip -> { count, until }
function pinBlocked(ip) {
  const rec = pinFails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) { pinFails.delete(ip); return false; }
  return rec.count >= 10;
}
function notePinFail(ip) {
  const rec = pinFails.get(ip) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
  rec.count += 1;
  pinFails.set(ip, rec);
}

function requireAdmin(req, res, next) {
  if (PIN_DISABLED) return next();
  const ip = req.ip || 'unknown';
  if (pinBlocked(ip)) {
    return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  }
  if ((req.get('x-admin-pin') || '') !== ADMIN_PIN) {
    notePinFail(ip);
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  pinFails.delete(ip);
  next();
}

// Tells the app whether to show a PIN screen before the editor at all.
app.get('/api/admin/status', (req, res) => res.json({ pinRequired: !PIN_DISABLED }));
app.post('/api/admin/verify', requireAdmin, (req, res) => res.json({ ok: true }));

function cleanItems(raw) {
  if (!Array.isArray(raw)) throw new Error('Items must be a list');
  const items = raw
    .map((it) => ({
      type: it && it.type === 'section' ? 'section' : 'task',
      text: String((it && it.text) || '').trim().slice(0, 300),
    }))
    .filter((it) => it.text);
  if (items.length > 200) throw new Error('That is more than 200 lines');
  if (!items.some((it) => it.type === 'task')) throw new Error('A checklist needs at least one task');
  return items;
}

app.put('/api/checklists/:key', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT key FROM checklists WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'No such checklist' });

  const title = String(req.body?.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'Give the checklist a name' });

  let items;
  try {
    items = cleanItems(req.body?.items);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  db.prepare(
    `UPDATE checklists SET title = ?, icon = ?, purpose = ?, items = ?, updated_at = datetime('now') WHERE key = ?`
  ).run(
    title,
    String(req.body?.icon || '').slice(0, 8),
    String(req.body?.purpose || '').trim().slice(0, 200),
    JSON.stringify(items),
    req.params.key
  );
  res.json({ ok: true });
});

app.post('/api/checklists/:key/reset', requireAdmin, (req, res) => {
  const def = DEFAULT_CHECKLISTS.find((c) => c.key === req.params.key);
  if (!def) return res.status(404).json({ error: 'No original on file for this checklist' });
  db.prepare(
    `UPDATE checklists SET title = ?, icon = ?, purpose = ?, items = ?, updated_at = datetime('now') WHERE key = ?`
  ).run(def.title, def.icon, def.purpose, JSON.stringify(def.items), def.key);
  res.json({ ok: true });
});

// ---- Shared live sessions (two phones, one checklist, no login) ----
//
// Anyone who opens a checklist joins the one live session for that checklist.
// Identity is just the first name they typed on their phone. Checking a box
// writes to the session; every phone polls and sees it within a couple seconds.

function publicSession(row) {
  const cutoff = Date.now() - PRESENCE_SECONDS * 1000;
  const participants = JSON.parse(row.participants).map((p) => ({
    name: p.name,
    here: Date.parse(p.lastSeen) >= cutoff,
  }));
  return {
    id: row.id,
    kind: row.kind,
    date: row.date,
    state: JSON.parse(row.state),
    participants,
    notes: row.notes,
    notesBy: row.notes_by,
    photos: JSON.parse(row.photos || '[]'),
    version: row.version,
    closed: !!row.closed,
    closedBy: row.closed_by || '',
    startedAt: row.created_at,
  };
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function activeSession(kind) {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE kind = ? AND closed = 0 AND updated_at > datetime('now', '-${SESSION_HOURS} hours')
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(kind);
}

// Records presence. Only bumps version when somebody NEW joins, so a quiet poll
// doesn't look like a change to the other phone.
function touchParticipant(row, name) {
  if (!name) return row;
  const list = JSON.parse(row.participants);
  const existing = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const isNew = !existing;
  if (existing) existing.lastSeen = new Date().toISOString();
  else list.push({ name, lastSeen: new Date().toISOString() });

  db.prepare(
    `UPDATE sessions SET participants = ?, version = version + ? WHERE id = ?`
  ).run(JSON.stringify(list), isNew ? 1 : 0, row.id);
  return getSession(row.id);
}

app.post('/api/sessions/:kind/join', (req, res) => {
  const kind = String(req.params.kind);
  if (!db.prepare('SELECT key FROM checklists WHERE key = ?').get(kind)) {
    return res.status(404).json({ error: 'No such checklist' });
  }
  const name = String(req.body?.name || '').trim().slice(0, 40);

  if (req.body?.fresh) {
    db.prepare('UPDATE sessions SET closed = 1 WHERE kind = ? AND closed = 0').run(kind);
  }

  let row = req.body?.fresh ? null : activeSession(kind);
  if (!row) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO sessions (id, kind, date) VALUES (?, ?, ?)').run(id, kind, todayISO());
    row = getSession(id);
  }
  row = touchParticipant(row, name);
  res.json(publicSession(row));
});

// Poll. Doubles as the presence ping, so the other phone knows you're still here.
app.get('/api/sessions/:id', (req, res) => {
  let row = getSession(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  const name = String(req.query.name || '').trim().slice(0, 40);
  if (name && !row.closed) row = touchParticipant(row, name);
  res.json(publicSession(row));
});

app.post('/api/sessions/:id/toggle', (req, res) => {
  const row = getSession(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  if (row.closed) return res.status(409).json({ error: 'This run was already submitted' });

  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0 || index > 500) {
    return res.status(400).json({ error: 'Bad task index' });
  }
  const state = JSON.parse(row.state);
  if (req.body?.done) {
    state[String(index)] = {
      label: String(req.body?.label || '').slice(0, 300),
      by: String(req.body?.by || '').trim().slice(0, 40),
      at: new Date().toISOString(),
    };
  } else {
    delete state[String(index)];
  }
  db.prepare(
    `UPDATE sessions SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(state), row.id);
  res.json({ ok: true, version: row.version + 1 });
});

// Photos belong to the RUN, not to one phone, so both workers' pictures end up
// on the report no matter which of them presses submit.
const MAX_SESSION_PHOTOS = 16;

app.post('/api/sessions/:id/photos', upload.array('photos', 8), (req, res) => {
  const row = getSession(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  if (row.closed) return res.status(409).json({ error: 'This run was already submitted' });

  const by = String(req.body?.by || '').trim().slice(0, 40);
  const photos = JSON.parse(row.photos || '[]');
  for (const f of req.files || []) {
    if (photos.length >= MAX_SESSION_PHOTOS) break;
    photos.push({ url: `/uploads/${f.filename}`, by, at: new Date().toISOString() });
  }
  db.prepare(
    `UPDATE sessions SET photos = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(photos), row.id);
  res.json({ ok: true, photos });
});

app.post('/api/sessions/:id/photos/remove', (req, res) => {
  const row = getSession(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  if (row.closed) return res.status(409).json({ error: 'This run was already submitted' });

  const url = String(req.body?.url || '');
  const by = String(req.body?.by || '').trim();
  const photos = JSON.parse(row.photos || '[]');
  const target = photos.find((p) => p.url === url);
  if (!target) return res.status(404).json({ error: 'No such photo' });
  // Only the person who took it can pull it, so nobody wipes the other's evidence.
  if ((target.by || '') !== by) return res.status(403).json({ error: `That photo is ${target.by || 'someone else'}'s` });

  db.prepare(
    `UPDATE sessions SET photos = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(photos.filter((p) => p.url !== url)), row.id);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/notes', (req, res) => {
  const row = getSession(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  if (row.closed) return res.status(409).json({ error: 'This run was already submitted' });
  db.prepare(
    `UPDATE sessions SET notes = ?, notes_by = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(
    String(req.body?.notes || '').slice(0, 4000),
    String(req.body?.by || '').trim().slice(0, 40),
    row.id
  );
  res.json({ ok: true, version: row.version + 1 });
});

// ---- Email report (sent to NOTIFY_EMAIL on every submission) ----

function groupTasks(tasks) {
  const groups = [];
  for (const t of tasks) {
    const name = t.section || '';
    let g = groups[groups.length - 1];
    if (!g || g.name !== name) {
      g = { name, tasks: [] };
      groups.push(g);
    }
    g.tasks.push(t);
  }
  return groups;
}

function buildEmail(sub) {
  const label = sub.label || KIND_LABELS[sub.kind] || sub.kind;
  const workers = Array.isArray(sub.data.workers) ? sub.data.workers.filter(Boolean) : [];
  const helperLine = workers.length > 1
    ? escHtml(workers.join(' + ')) + ' <span style="color:#6e6e73">(worked the list together)</span>'
    : sub.data.hadHelper
      ? `Yes${sub.data.helperName ? ' — ' + escHtml(sub.data.helperName) : ''}`
      : 'No';

  let subject, body;
  if (sub.kind === 'issue') {
    subject = `⚠️ ${sub.data.urgency.toUpperCase()} issue: ${sub.data.issueType} — reported by ${sub.name}`;
    body = `
      <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Issue type</td><td><b>${escHtml(sub.data.issueType)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Urgency</td><td><b>${escHtml(sub.data.urgency)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Resolved</td><td>${sub.data.resolved ? 'Yes' : 'No'}</td></tr>
      </table>
      <h3 style="margin:18px 0 6px">Description</h3>
      <p style="white-space:pre-wrap;margin:0">${escHtml(sub.data.description)}</p>`;
  } else {
    const tasks = sub.data.tasks || [];
    const missed = tasks.filter((t) => !t.done);
    const status = sub.data.complete
      ? missed.length ? `Complete — ${missed.length} task(s) missed` : 'Complete — all tasks done'
      : 'NOT marked complete';
    subject = `${missed.length === 0 && sub.data.complete ? '✅' : '🟡'} ${label} — ${sub.name} (${tasks.length - missed.length}/${tasks.length} tasks)`;

    const showWho = workers.length > 1;
    const taskHtml = groupTasks(tasks).map((g) => {
      const head = g.name
        ? `<div style="margin:14px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6e6e73">${escHtml(g.name)}</div>`
        : '';
      const lines = g.tasks.map((t) => {
        const who = showWho && t.done && t.by ? ` <span style="color:#6e6e73">— ${escHtml(t.by)}</span>` : '';
        return t.done
          ? `<div style="padding:2px 0;color:#16a34a">&#10003; <span style="color:#1c1c1e">${escHtml(t.label)}</span>${who}</div>`
          : `<div style="padding:2px 0;color:#dc2626;font-weight:bold">&#10007; ${escHtml(t.label)} — MISSED</div>`;
      }).join('');
      return head + lines;
    }).join('');

    body = `
      <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Status</td><td><b>${status}</b></td></tr>
      </table>
      <h3 style="margin:18px 0 6px">Tasks</h3>
      ${taskHtml}
      ${sub.data.notes ? `<h3 style="margin:18px 0 6px">Notes</h3><p style="white-space:pre-wrap;margin:0">${escHtml(sub.data.notes)}</p>` : ''}`;
  }

  const credits = sub.data.photoCredits || {};
  const photoHtml = sub.photos.length
    ? `<h3 style="margin:18px 0 6px">Photos (${sub.photos.length})</h3>` +
      sub.photos.map((p, i) => {
        const by = credits[p] ? ` <span style="color:#6e6e73">(${escHtml(credits[p])})</span>` : '';
        return `<a href="${APP_URL}${p}">Photo ${i + 1}</a>${by}`;
      }).join(' &middot; ')
    : '';

  const sigHtml = sub.data.signature
    ? `<h3 style="margin:18px 0 6px">Signature</h3>
       <img src="${APP_URL}${sub.data.signature}" alt="Signature" style="max-width:280px;background:#fff;border:1px solid #e3e3e8;border-radius:8px">`
    : '';

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#1c1c1e">
      <h2 style="margin:0 0 4px">${escHtml(label)}</h2>
      <table style="font-size:14px;border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Submitted by</td><td><b>${escHtml(sub.name)}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">${workers.length > 1 ? 'Worked by' : 'Helper'}</td><td>${helperLine}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Date</td><td>${escHtml(sub.date)}</td></tr>
      ${body}
      ${photoHtml}
      ${sigHtml}
      <p style="margin-top:24px"><a href="${APP_URL}" style="color:#2563eb">Open Venue Checklist</a></p>
    </div>`;

  return { subject, html };
}

async function sendNotification(sub) {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — skipped notification for ${sub.kind} by ${sub.name}`);
    return;
  }
  const { subject, html } = buildEmail(sub);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [NOTIFY_EMAIL], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  console.log(`[email] sent "${subject}" to ${NOTIFY_EMAIL}`);
}

// ---- Submissions ----

const submissionUpload = upload.fields([
  { name: 'photos', maxCount: 8 },
  { name: 'signature', maxCount: 1 },
]);

app.post('/api/submissions', submissionUpload, (req, res) => {
  const { kind, name, date, data, sessionId } = req.body;
  if (!kind || !name || !date || !data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return res.status(400).json({ error: 'Invalid data payload' });
  }
  // Anything already on the shared run counts too — the partner's photos must
  // reach the report even though they are on the other phone.
  let photos = (req.files?.photos || []).map((f) => `/uploads/${f.filename}`);
  let photoCredits = {};
  if (sessionId) {
    const s = getSession(String(sessionId));
    if (s) {
      const shared = JSON.parse(s.photos || '[]');
      photos = [...new Set([...shared.map((p) => p.url), ...photos])];
      photoCredits = Object.fromEntries(shared.filter((p) => p.by).map((p) => [p.url, p.by]));
    }
  }
  if (Object.keys(photoCredits).length) parsed.photoCredits = photoCredits;

  const sigFile = req.files?.signature?.[0];
  if (kind !== 'issue') {
    if (photos.length === 0) return res.status(400).json({ error: 'At least one photo is required' });
    if (!sigFile) return res.status(400).json({ error: 'Signature is required' });
  }
  if (sigFile) parsed.signature = `/uploads/${sigFile.filename}`;
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO submissions (id, kind, name, date, data, photos) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, kind, name.trim(), date, JSON.stringify(parsed), JSON.stringify(photos));

  // Close the shared run so the next person starts a clean list. Recording who
  // did it lets the other phone say whose submit cleared their screen.
  if (sessionId) {
    db.prepare('UPDATE sessions SET closed = 1, closed_by = ? WHERE id = ?')
      .run(name.trim(), String(sessionId));
  }

  res.json({ ok: true, id });
  sendNotification({ kind, label: labelForKind(kind), name: name.trim(), date, data: parsed, photos }).catch((e) =>
    console.error('[email] failed:', e.message)
  );
});

// List submissions, newest first
app.get('/api/submissions', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 200')
    .all();
  res.json(
    rows.map((r) => ({
      ...r,
      data: JSON.parse(r.data),
      photos: JSON.parse(r.photos),
    }))
  );
});

// Toggle resolved on an issue report
app.patch('/api/submissions/:id/resolve', (req, res) => {
  const row = db.prepare('SELECT data FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = JSON.parse(row.data);
  data.resolved = !data.resolved;
  db.prepare('UPDATE submissions SET data = ? WHERE id = ?').run(
    JSON.stringify(data),
    req.params.id
  );
  res.json({ ok: true, resolved: data.resolved });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Venue Checklist running at http://localhost:${PORT}`);
    console.log(`Editor PIN: ${PIN_DISABLED ? 'disabled (ADMIN_PIN=off)' : 'set via ADMIN_PIN'}`);
  });
}

module.exports = { app, buildEmail };
