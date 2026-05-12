# ◈ SecureCoin (SRC) — v2.0

A real Proof-of-Work blockchain simulation with user accounts, live WebSocket updates, and real SHA-256 mining.

---

## Features

- **Real Proof-of-Work** — SHA-256 mining with adjustable difficulty (leading zeros). Difficulty increases every 5 blocks.
- **JWT Authentication** — Sign up / log in. New accounts receive **500 SRC**.
- **Live real-time** — Every transaction, new block, and mining update is broadcast to all connected users via WebSocket.
- **Transaction visualizer** — Animated canvas showing signing → broadcast → propagation → confirmed.
- **Block explorer** — Full chain with expandable blocks showing nonce, hash, miner, elapsed time.
- **Leaderboard** — Live richest wallets.
- **Mining reward** — 12.5 SRC coinbase reward per block mined.
- **Network fee** — 0.1% on every transaction.

---

## Quick Start (local)

### 1. Start the server

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:3001`.

### 2. Open the frontend

Open `index.html` in your browser, **or** run a local dev server:

```bash
# From the project root:
npx serve .
# Then visit http://localhost:3000
```

### 3. Create an account

- Open `index.html`
- Click **Create account**
- You receive **500 SRC** automatically
- Open multiple browser tabs/windows to simulate multiple users transacting and mining in real time

---

## GitHub Pages + Local Server

To host the frontend on GitHub Pages while the server runs locally:

### Option A — ngrok (recommended)

1. Install ngrok: https://ngrok.com
2. Start your server: `npm start` in `server/`
3. In a new terminal: `ngrok http 3001`
4. Copy the HTTPS URL (e.g. `https://abcd1234.ngrok-free.app`)
5. Edit `js/config.js`:

```js
const Config = {
  API_URL: 'https://abcd1234.ngrok-free.app',
  // ...
};
```

6. Push to GitHub — frontend on Pages, server via ngrok tunnel.

### Option B — local network

Replace `API_URL` in `js/config.js` with your machine's local IP:

```js
API_URL: 'http://192.168.1.x:3001'
```

---

## How Mining Works

1. Pending transactions accumulate in the **mempool**.
2. Click **Mine block** to start Proof-of-Work.
3. The server iterates nonces, hashing `height|prevHash|txSigs|miner|timestamp|nonce` with SHA-256.
4. It searches for a hash starting with N zeros (the **difficulty target**).
5. Progress (nonce, hash, hash rate) is streamed to all clients via WebSocket every ~100ms.
6. When found, all connected clients see the new block instantly.
7. The miner receives **12.5 SRC** coinbase reward.

**Difficulty schedule:**
| Blocks | Leading zeros | Expected nonces | ~Time |
|--------|--------------|-----------------|-------|
| 1–4    | 2            | 256             | <0.1s |
| 5–9    | 3            | 4,096           | ~0.3s |
| 10–14  | 4            | 65,536          | ~2s   |
| 15–19  | 5            | 1,048,576       | ~30s  |

---

## Project Structure

```
securecoin-v2/
├── index.html          ← Login / signup page
├── dashboard.html      ← Main app
├── css/
│   └── main.css        ← All styles (glassmorphism, animations)
├── js/
│   ├── config.js       ← API URL configuration
│   ├── auth.js         ← Login/signup page logic
│   ├── visualizer.js   ← Canvas transaction animation
│   └── app.js          ← Dashboard controller + WebSocket
└── server/
    ├── package.json
    ├── server.js        ← Express + Socket.io + PoW + JWT
    └── data/
        └── db.json      ← Auto-created JSON database
```

---

## Environment Variables (server)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | `securecoin-dev-secret-change-in-prod` | **Change this in production!** |

```bash
JWT_SECRET=my-super-secret PORT=3001 npm start
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS, Canvas API, Socket.io client |
| Backend | Node.js, Express, Socket.io |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Crypto | Node.js `crypto` (SHA-256) |
| Storage | JSON file (no database required) |
| Fonts | Sora + JetBrains Mono (Google Fonts) |
