# Deployment Guide

This project is configured for a **hybrid flow**:
- local admin runtime (backend + dashboard) on your machine
- public RSVP site on Vercel

## 1) Local Admin Runtime (your computer)

1. Create `backend/.env` from `backend/.env.example`.
2. Create `frontend/.env` from `frontend/.env.example`.
3. Install dependencies:
   ```bash
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```
4. Start local app:
   ```bash
   npm run dev
   ```
5. Open dashboard at `http://localhost:5173`.
6. In WhatsApp section:
   - scan QR to connect account
   - use "disconnect account" when you want to switch WhatsApp numbers

## 2) Public RSVP App on Vercel

Deploy **frontend only** as a separate Vercel project:
- Project root: `frontend`
- Build command: `npm run build`
- Output: `dist`

Required Vercel env for RSVP API routes:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (recommended)
  - or split vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

Optional Vercel env for frontend:
- `VITE_PUBLIC_RSVP_API_URL=/api/public`

`frontend/vercel.json` already includes SPA rewrites and preserves `/api/*` routes.

## 3) Link Generation for Guests

In your local dashboard, set RSVP base link to your Vercel RSVP domain:
- Example: `https://your-rsvp.vercel.app`

Each sent guest gets:
- `/rsvp/{weddingId}/{guestId}?token={rsvpToken}`

## 4) Operational Flow

1. Run local admin app.
2. Send invitations via WhatsApp from local dashboard.
3. You can close local app after sending.
4. Guests still open RSVP links on Vercel and update attendance.
5. Later, reopen local app and load latest status from Firestore.

## 5) Reliability notes

- Scheduled messages were removed.
- WhatsApp sending has randomized delay between recipients (`WA_DELAY_MIN_MS` / `WA_DELAY_MAX_MS`).
- To reduce local downtime, run backend with a process manager (PM2/NSSM/Docker restart policy) when needed.
