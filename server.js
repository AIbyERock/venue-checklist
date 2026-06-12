const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

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
  )
`);

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
app.use(express.json());

app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- Email report (sent to NOTIFY_EMAIL on every submission) ----

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

function buildEmail(sub) {
  const label = KIND_LABELS[sub.kind] || sub.kind;
  const helperLine = sub.data.hadHelper
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
    body = `
      <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Status</td><td><b>${status}</b></td></tr>
      </table>
      <h3 style="margin:18px 0 6px">Tasks</h3>
      ${tasks.map((t) => t.done
        ? `<div style="padding:2px 0;color:#16a34a">&#10003; <span style="color:#1c1c1e">${escHtml(t.label)}</span></div>`
        : `<div style="padding:2px 0;color:#dc2626;font-weight:bold">&#10007; ${escHtml(t.label)} — MISSED</div>`
      ).join('')}
      ${sub.data.notes ? `<h3 style="margin:18px 0 6px">Notes</h3><p style="white-space:pre-wrap;margin:0">${escHtml(sub.data.notes)}</p>` : ''}`;
  }

  const photoHtml = sub.photos.length
    ? `<h3 style="margin:18px 0 6px">Photos (${sub.photos.length})</h3>` +
      sub.photos.map((p, i) => `<a href="${APP_URL}${p}">Photo ${i + 1}</a>`).join(' &middot; ')
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
        <tr><td style="padding:4px 12px 4px 0;color:#6e6e73">Helper</td><td>${helperLine}</td></tr>
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

// Create a submission (checklist or issue report)
const submissionUpload = upload.fields([
  { name: 'photos', maxCount: 8 },
  { name: 'signature', maxCount: 1 },
]);

app.post('/api/submissions', submissionUpload, (req, res) => {
  const { kind, name, date, data } = req.body;
  if (!kind || !name || !date || !data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return res.status(400).json({ error: 'Invalid data payload' });
  }
  const photos = (req.files?.photos || []).map((f) => `/uploads/${f.filename}`);
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
  res.json({ ok: true, id });
  sendNotification({ kind, name: name.trim(), date, data: parsed, photos }).catch((e) =>
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
  });
}

module.exports = { app, buildEmail };
