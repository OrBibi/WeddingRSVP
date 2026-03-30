# Wedding RSVP & Notification System

Full-stack monorepo:
- `frontend`: React + Vite + Tailwind CSS
- `backend`: Node.js + Express + TypeScript
- `shared`: shared TypeScript types

## Run

Install dependencies:
```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

Start frontend + backend concurrently:
```bash
npm run dev
```

URLs:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001/api`

## WhatsApp Setup

- After running `npm run dev`, check the backend terminal output.
- A WhatsApp QR code is printed in the backend terminal.
- Scan that QR code with your WhatsApp app before using WhatsApp notifications.
- If QR is not scanned, `POST /api/notifications/whatsapp` returns `503`.

## Build
```bash
npm run build
```
