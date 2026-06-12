# Venue Checklist

Mobile-friendly checklist app for managing a multipurpose venue: Event Setup, Venue Turnover cleaning, Training Club (SoulRnR) setup, plus an Issue / Low Supplies reporter.

## Run

```
npm install
npm start
```

Open http://localhost:3000 on a phone or desktop. To use it from a phone on the same Wi-Fi, browse to `http://<this-computer's-LAN-IP>:3000`.

## How it works

- **Home** — four big buttons: the three checklists and the issue reporter.
- **Checklists** — name, date, "had a helper?" toggle (with helper's name, for compensation records), tap-to-check tasks with a progress counter, notes, photo upload (camera or gallery, up to 8), a "mark complete" toggle, and submit.
- **Issue reports** — name, date, issue type, description, urgency (Low/Medium/High), photos, resolved toggle.
- **Submissions** (clipboard icon, top right) — every submission, newest first, filterable by type. Tap a card to see who submitted it, every missed task highlighted in red, notes, and photos. Open issues can be marked resolved from here.

## Email notifications

Every submission emails a full report (who, helper, status, every missed task in red, notes, photo links) via [Resend](https://resend.com). Configure with env vars:

- `RESEND_API_KEY` — required for emails; without it, submissions still save and emails are skipped.
- `NOTIFY_EMAIL` — where reports go (default `wulff.a.eric@gmail.com`).
- `EMAIL_FROM` — default `Venue Checklist <onboarding@resend.dev>` (works on a free Resend account sending to the account owner; use a verified domain to send anywhere).

## Stack

- Node.js + Express, no framework on the frontend (vanilla HTML/CSS/JS single-page app in `public/`).
- SQLite via Node's built-in `node:sqlite` module (requires Node 22.5+; prints a harmless "experimental" warning on some versions). Data lives in `data.db`.
- Photos stored on disk in `uploads/`, served at `/uploads/...`.

## Deploying

Works anywhere Node runs with a persistent disk (e.g. Render with a disk attached — `data.db` and `uploads/` must persist between deploys). Not suitable for Vercel serverless as-is because of the local SQLite file and disk uploads.
