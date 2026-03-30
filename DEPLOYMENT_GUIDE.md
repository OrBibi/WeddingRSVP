# Deployment Guide

## 1. GitHub Setup

1. Create a new GitHub repository.
2. Commit all project files.
3. Push your code to GitHub.

## 2. Render (Backend) Deployment

1. Go to [dashboard.render.com](https://dashboard.render.com).
2. Click **New Web Service**.
3. Connect your GitHub repository.
4. Set the **Root Directory** to `backend`.
5. Set **Build Command** to `npm install`.
6. Set **Start Command** to `npm start`.
7. Deploy the service.

## 3. Crucial Render Step

After the backend is deployed, open the Render **Logs** and scan the WhatsApp QR code flow from the backend status endpoint to connect your WhatsApp client session.

## 4. Frontend Deployment

1. In `frontend`, create a `.env` file with:

```bash
VITE_API_URL=https://<YOUR_RENDER_URL>/api
```

2. Ensure `frontend/vite.config.ts` contains `base: '/WeddingRSVP/'`.
3. Ensure `frontend/package.json` contains `homepage: 'https://OrBibi.github.io/WeddingRSVP'`.
4. Run from the `frontend` folder:

```bash
npm run deploy
```
