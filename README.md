# Venue Checklist

Mobile-friendly checklist app for managing a multipurpose venue: Event Setup, Venue Turnover cleaning, Training Club (SoulRnR) setup, plus an Issue / Low Supplies reporter.

## Run

```
npm install
npm start
```

Open http://localhost:3000 on a phone or desktop. To use it from a phone on the same Wi-Fi, browse to `http://<this-computer's-LAN-IP>:3000`.

## How it works

- **Home** - the checklists plus the issue reporter. First time on a phone it asks for a first name; that name is what shows next to the boxes that person checks. There is no account and no password.
- **Two people, one list** - opening a checklist joins the single live run for that list. Both phones see the same boxes, and a check made on one phone shows up on the other within a couple of seconds, tagged with who did it. Notes are shared the same way. "Start a fresh run" clears it and begins a new one for everybody.
- **Progress** - a ring showing the percentage, a bar per section, a thin line under the title bar that stays visible while scrolling, a buzz on each check, and confetti when the last box is ticked. "Mark checklist complete" flips itself on at 100%.
- **Offline** - checks are kept on the phone if the signal drops and are re-sent automatically once it comes back. The list itself is cached, so the app still opens in a dead spot.
- **Submitting** - photos (at least one) and a signature are still required. Submitting closes the shared run, so the next person starts clean. Both workers' names go on the report.
- **Editing the checklists** - "Edit the checklists" on the home screen. Add, reword, reorder or delete tasks and section headings, or reset a list to its original. Changes reach every phone the next time a checklist is opened - no redeploy.
- **Submissions** (clipboard icon, top right) - every submission, newest first, filterable by type. Tap a card for who submitted it, every missed task in red, who checked what, notes, and photos. Open issues can be marked resolved from here.

## Email notifications

Every submission emails a full report (who worked it, status, tasks grouped by section with every missed one in red, notes, photo links) via [Resend](https://resend.com). Configure with env vars:

- `RESEND_API_KEY` - required for emails; without it, submissions still save and emails are skipped.
- `NOTIFY_EMAIL` - where reports go (default `wulff.a.eric@gmail.com`).
- `EMAIL_FROM` - default `Venue Checklist <onboarding@resend.dev>` (works on a free Resend account sending to the account owner; use a verified domain to send anywhere).

## The editor PIN

Working a checklist never asks for anything. The only gate in the app is on the screen that edits the master checklists, so a helper cannot delete tasks they would rather not do.

- `ADMIN_PIN` - the PIN for that screen. Defaults to `324324`. Set it in the Render dashboard to change it.
- `ADMIN_PIN=off` - removes the gate entirely; anyone can edit the lists.

Ten wrong tries from one IP locks that IP out for 15 minutes.

## Stack

- Node.js + Express, no framework on the frontend (vanilla HTML/CSS/JS single-page app in `public/`).
- SQLite via Node's built-in `node:sqlite` module (requires Node 22.5+; prints a harmless "experimental" warning on some versions). Data lives in `data.db`.
- Photos stored on disk in `uploads/`, served at `/uploads/...`.
- Checklist content lives in the `checklists` table. `checklists.default.js` seeds it on first boot and backs the "reset to original" button; after that the database is the source of truth.
- Shared runs live in the `sessions` table. Phones poll every 2.5s, pausing while the app is in the background. A run stays joinable for 12 hours after its last activity.

## Deploying

Works anywhere Node runs with a persistent disk (e.g. Render with a disk attached - `data.db` and `uploads/` must persist between deploys). Not suitable for Vercel serverless as-is because of the local SQLite file and disk uploads.
