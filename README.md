# Wedding RSVP & Notification System

Full-stack monorepo:
- `frontend`: React + Vite + Tailwind CSS
- `backend`: Node.js + Express + TypeScript
- `shared`: shared TypeScript types

## Deployment model in this project

- **Local Admin App** (your computer):
  - local backend + local dashboard UI
  - manage guests/groups
  - send WhatsApp messages with `whatsapp-web.js`
- **Public RSVP App** (Vercel):
  - invitation links for guests
  - direct RSVP updates to Firestore through Vercel API routes
  - works even when your local admin app is closed

## Local setup

Install dependencies:
```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

Create env files:
- `backend/.env` from `backend/.env.example`
- `frontend/.env` from `frontend/.env.example`

Start local admin stack:
```bash
npm run dev
```

Local URLs:
- Frontend dashboard: `http://localhost:5173`
- Backend API: `http://localhost:3001/api`

## Firebase Setup (Required)

Never commit Firebase secrets to git. Use environment variables only.

Backend credentials (one of these):
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string)
- OR `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` (`\n` escaped)

Frontend web config:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## WhatsApp behavior

- Scan QR in dashboard before sending.
- New endpoint supports account switching:
  - `POST /api/notifications/whatsapp/disconnect`
- Scheduled sending was removed.
- Sending now uses a randomized delay between recipients:
  - `WA_DELAY_MIN_MS`
  - `WA_DELAY_MAX_MS`
- Durable batch jobs are available:
  - `POST /api/notifications/whatsapp/jobs` (create/start)
  - `GET /api/notifications/whatsapp/jobs/{jobId}` (status)
  - `POST /api/notifications/whatsapp/jobs/{jobId}/pause`
  - `POST /api/notifications/whatsapp/jobs/{jobId}/resume`

## Reliability test checklist (200/300 sends)

1. Prepare 200-300 guests in dashboard (or import from Excel).
2. Start a WhatsApp job from dashboard.
3. During sending, force a transient issue (disconnect internet for ~20-40 seconds).
4. Verify job enters paused/retry behavior and does not lose progress.
5. Resume job and verify only remaining recipients are processed.
6. Confirm final counters in UI/API:
   - `processedCount = sentCount + failedCount`
   - no duplicate sends for already `sent` recipients.

Run retry policy unit tests:
```bash
npm run test --prefix backend
```

## Public RSVP behavior (Vercel)

- Personal links format:
  - `/rsvp/{weddingId}/{guestId}?token={rsvpToken}`
- Guest identification is by immutable `guestId + rsvpToken`.
- RSVP updates are written to Firestore from Vercel API routes under:
  - `frontend/api/public/rsvp/[weddingId]/[guestId].ts`

## Build
```bash
npm run build
```
