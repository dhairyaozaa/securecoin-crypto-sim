/* ─────────────────────────────────────────────
   SecureCoin · config.js
   Change API_URL to your server address.
   For GitHub Pages + ngrok: set to your ngrok HTTPS URL.
   For local development: keep as localhost.
───────────────────────────────────────────── */

const Config = {
  API_URL:    'https://quench-preteen-catalyze.ngrok-free.dev',
  COIN_NAME:  'SecureCoin',
  TICKER:     'SRC',
  BLOCK_REWARD: 12.5,
  INITIAL_BALANCE: 500,
  VERSION:    '2.0.0',
};

// Detect if running from file:// or GitHub Pages (HTTPS)
// and auto-switch to ngrok if needed — edit NGROK_URL below.
// const NGROK_URL = 'https://xxxx.ngrok.io';
// if (location.protocol === 'https:') Config.API_URL = NGROK_URL;
