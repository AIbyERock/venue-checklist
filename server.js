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
const APP_PASSWORD = process.env.APP_PASSWORD || '';

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
app.use(express.urlencoded({ extended: false }));

// ---- Simple shared-password gate (active only when APP_PASSWORD is set) ----
const authToken = APP_PASSWORD
  ? crypto.createHash('sha256').update(`venue-checklist:${APP_PASSWORD}`).digest('hex')
  : null;

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Venue Checklist — Sign In</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f4f4f6; color: #1c1c1e; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; padding: 20px; }
  .box { background: #fff; border: 1px solid #e3e3e8; border-radius: 14px;
         padding: 28px 22px; width: 100%; max-width: 380px; text-align: center; }
  h1 { font-size: 20px; margin-bottom: 6px; }
  p { color: #6e6e73; font-size: 14px; margin-bottom: 20px; }
  input { width: 100%; font-size: 16px; padding: 13px; border: 1px solid #e3e3e8;
          border-radius: 10px; background: #f4f4f6; margin-bottom: 12px; }
  button { width: 100%; padding: 14px; font-size: 16px; font-weight: 700; color: #fff;
           background: #2563eb; border: none; border-radius: 12px; cursor: pointer; }
  .err { color: #dc2626; font-size: 14px; font-weight: 600; margin-bottom: 10px; }
</style></head><body>
<form class="box" method="POST" action="/login">
  <h1>Venue Checklist</h1>
  <p>Enter the venue password to continue.</p>
  <!--ERR-->
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Sign In</button>
</form></body></html>`;

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

app.post('/login', (req, res) => {
  if (!authToken) return res.redirect('/');
  if ((req.body.password || '') === APP_PASSWORD) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `auth=${authToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000${secure}`
    );
    return res.redirect('/');
  }
  res.status(401).send(LOGIN_PAGE.replace('<!--ERR-->', '<div class="err">Wrong password — try again.</div>'));
});

app.use((req, res, next) => {
  if (!authToken) return next();
  if (req.path === '/login' || req.path === '/healthz') return next();
  if (getCookie(req, 'auth') === authToken) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.status(401).send(LOGIN_PAGE.replace('<!--ERR-->', ''));
});

app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Create a submission (checklist or issue report)
app.post('/api/submissions', upload.array('photos', 8), (req, res) => {
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
  const photos = (req.files || []).map((f) => `/uploads/${f.filename}`);
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO submissions (id, kind, name, date, data, photos) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, kind, name.trim(), date, JSON.stringify(parsed), JSON.stringify(photos));
  res.json({ ok: true, id });
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

app.listen(PORT, () => {
  console.log(`Venue Checklist running at http://localhost:${PORT}`);
});
