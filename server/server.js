'use strict';
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const PORT       = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'securecoin-dev-secret-change-in-prod';
const DB_FILE    = path.join(__dirname, 'data', 'db.json');

/* ─────────────────────────────────────
   FIX 1 — CORS
   Allow every origin, including GitHub Pages.
   Allow ngrok-skip-browser-warning header so
   the ngrok interstitial page is bypassed.
───────────────────────────────────────*/
const CORS_OPT = {
  origin: (_origin, cb) => cb(null, true),          // allow all origins
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',                    // bypass ngrok interstitial
    'ngrok-tunnel-auth-token',
  ],
  credentials: false,
};
app.use(cors(CORS_OPT));
app.options('*', cors(CORS_OPT));                    // handle ALL preflight requests

/* ─────────────────────────────────────
   FIX 2 — Socket.io CORS
───────────────────────────────────────*/
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET','POST'],
    allowedHeaders: ['Authorization','ngrok-skip-browser-warning'],
    credentials: false,
  },
  transports: ['polling','websocket'],
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

/* ══════════════════ DATABASE ═══════════════════ */
const DB_DEFAULT = { users:[], blocks:[], mempool:[], stats:{ totalTx:0 } };

function dbRead() {
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { return JSON.parse(JSON.stringify(DB_DEFAULT)); }
}
function dbWrite(data) {
  fs.mkdirSync(path.dirname(DB_FILE),{ recursive:true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data,null,2));
}
const dbGet = k => dbRead()[k];

/* ══════════════════ BLOCKCHAIN ══════════════════ */
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function getDifficulty() {
  const n = (dbGet('blocks')||[]).length;
  return Math.min(2 + Math.floor(n / 5), 5);
}

async function minePoW(blockData, difficulty, onProgress) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  const start = Date.now();
  let lastReport = 0;
  while (true) {
    for (let i = 0; i < 200; i++) {
      const hash = sha256(blockData + '|' + nonce);
      if (hash.startsWith(target)) return { hash, nonce, elapsed: Date.now()-start };
      nonce++;
    }
    const now = Date.now();
    if (now - lastReport > 100) {
      const rate = Math.floor(nonce / Math.max(1,(now-start)/1000));
      await onProgress({ nonce, hash: sha256(blockData+'|'+nonce), rate, difficulty });
      lastReport = now;
    }
    await new Promise(r => setImmediate(r));
  }
}

/* ══════════════════ AUTH HELPERS ════════════════ */
const genAddr   = seed => '0x' + sha256(seed + Math.random()).slice(0,40);
const signToken = p    => jwt.sign(p, JWT_SECRET, { expiresIn:'7d' });
const verifyTok = t    => { try { return jwt.verify(t, JWT_SECRET); } catch { return null; } };
const safeUser  = u    => { const { passwordHash:_, ...s } = u; return s; };

function authMw(req, res, next) {
  const decoded = verifyTok((req.headers.authorization||'').replace('Bearer ',''));
  if (!decoded) return res.status(401).json({ error:'Unauthorized' });
  req.user = decoded; next();
}

/* ══════════════════ AUTH ROUTES ═════════════════ */
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)     return res.status(400).json({ error:'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error:'Username must be 3–20 chars' });
  if (password.length < 6)        return res.status(400).json({ error:'Password must be ≥6 chars' });

  const db = dbRead();
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error:'Username already taken' });

  const user = {
    id: uuidv4(), username,
    passwordHash: await bcrypt.hash(password, 12),
    addr: genAddr(username + Date.now()),
    balance: 500, totalMined: 0, totalSent: 0, createdAt: Date.now(),
  };
  db.users.push(user); dbWrite(db);
  io.emit('user_joined', { username });
  console.log(`✓ Signup: ${username}`);
  res.json({ token: signToken({ id:user.id, username:user.username, addr:user.addr }), user: safeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const db   = dbRead();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error:'Invalid username or password' });
  console.log(`✓ Login: ${username}`);
  res.json({ token: signToken({ id:user.id, username:user.username, addr:user.addr }), user: safeUser(user) });
});

app.get('/api/auth/me', authMw, (req, res) => {
  const user = dbRead().users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error:'Not found' });
  res.json({ user: safeUser(user) });
});

/* ══════════════════ CHAIN ROUTES ════════════════ */
app.get('/api/chain', (_req, res) => {
  const db = dbRead();
  res.json({ blocks: db.blocks||[], mempool: db.mempool||[], stats: db.stats||{}, difficulty: getDifficulty() });
});

app.get('/api/leaderboard', (_req, res) => {
  const board = (dbRead().users||[])
    .map(({ username, addr, balance, totalMined }) => ({ username, addr, balance, totalMined }))
    .sort((a,b) => b.balance - a.balance).slice(0,10);
  res.json(board);
});

/* ─────────────────────────────────────────────────
   FIX 3 — Transaction: return senderBalance in
   response so frontend syncs immediately without
   an extra round-trip.
   Also emit balance_update over socket to all
   sessions of the same user (multiple tabs).
───────────────────────────────────────────────── */
app.post('/api/transaction', authMw, async (req, res) => {
  const { to, amount, memo } = req.body;
  const db        = dbRead();
  const sender    = db.users.find(u => u.id === req.user.id);
  const recipient = db.users.find(u => u.addr === to);

  if (!sender)               return res.status(400).json({ error:'Sender not found' });
  if (!to)                   return res.status(400).json({ error:'Recipient address required' });
  if (sender.addr === to)    return res.status(400).json({ error:'Cannot send to yourself' });
  if (!amount || amount <= 0)return res.status(400).json({ error:'Invalid amount' });
  if (amount > sender.balance)
    return res.status(400).json({ error:`Insufficient balance (${sender.balance.toFixed(4)} SRC)` });
  if (!recipient)            return res.status(404).json({ error:'Recipient address not found' });

  const fee = parseFloat((amount * 0.001).toFixed(6));
  const sig = sha256(sender.addr + to + amount + (memo||'') + Date.now() + Math.random());

  const tx = {
    id: sig.slice(0,16), from: sender.addr, fromName: sender.username,
    to, toName: recipient.username,
    amount: parseFloat(amount), fee, memo: memo||'',
    sig, ts: Date.now(), status: 'pending',
  };

  sender.balance   = parseFloat((sender.balance - amount - fee).toFixed(6));
  sender.totalSent = (sender.totalSent||0) + amount;

  db.mempool.push(tx);
  db.users = db.users.map(u => u.id === sender.id ? sender : u);
  dbWrite(db);

  // Broadcast to all clients
  io.emit('new_tx', tx);
  // Targeted balance updates (both sender and when mined, recipient)
  io.emit('balance_update', { addr: sender.addr, balance: sender.balance });

  console.log(`→ TX ${sender.username}→${recipient.username} ${amount} SRC`);
  // Return senderBalance so frontend doesn't need a second fetch
  res.json({ tx, senderBalance: sender.balance });
});

/* ══════════════════ MINING ══════════════════════ */
let miningActive = false;

app.post('/api/mine', authMw, async (req, res) => {
  if (miningActive) return res.status(409).json({ error:'Mining already in progress' });

  const db     = dbRead();
  const miner  = db.users.find(u => u.id === req.user.id);
  if (!miner)  return res.status(400).json({ error:'Miner not found' });

  const mempool = db.mempool||[];
  if (!mempool.length) return res.status(400).json({ error:'No pending transactions to mine' });

  miningActive = true;
  res.json({ message:'Mining started', txCount: mempool.length });

  const difficulty = getDifficulty();
  const blocks     = db.blocks||[];
  const prevBlock  = blocks[blocks.length - 1];
  const txsToMine  = [...mempool];
  const REWARD     = 12.5;

  const coinbaseTx = {
    id:'coinbase-'+(blocks.length+1), from:'COINBASE', fromName:'Coinbase',
    to: miner.addr, toName: miner.username, amount: REWARD, fee:0,
    memo:'Block reward', sig: sha256('coinbase'+miner.addr+Date.now()),
    ts: Date.now(), status:'confirmed',
  };

  const allTxs = [...txsToMine, coinbaseTx];
  const blockBase = `${blocks.length+1}|${prevBlock.hash}|${allTxs.map(t=>t.sig).join(',')}|${miner.addr}|${Date.now()}`;
  console.log(`⛏  Mining block #${blocks.length+1} diff=${difficulty}...`);

  try {
    const { hash, nonce, elapsed } = await minePoW(blockBase, difficulty, async p => {
      io.emit('mining_progress', { ...p, miner: miner.username });
    });

    const block = {
      height: blocks.length+1, prevHash: prevBlock.hash, txs: allTxs,
      miner: miner.addr, minerName: miner.username,
      nonce, difficulty, reward: REWARD, ts: Date.now(), hash, elapsed,
    };

    const freshDb = dbRead();

    // Credit each recipient
    for (const tx of txsToMine) {
      tx.status = 'confirmed';
      tx.blockHeight = block.height;
      const r = freshDb.users.find(u => u.addr === tx.to);
      if (r) {
        r.balance = parseFloat((r.balance + tx.amount).toFixed(6));
        freshDb.users = freshDb.users.map(u => u.addr===r.addr ? r : u);
        io.emit('balance_update', { addr: r.addr, balance: r.balance });
      }
    }

    // Credit miner
    const fm = freshDb.users.find(u => u.id === miner.id);
    if (fm) {
      fm.balance    = parseFloat((fm.balance + REWARD).toFixed(6));
      fm.totalMined = (fm.totalMined||0) + REWARD;
      freshDb.users = freshDb.users.map(u => u.id===fm.id ? fm : u);
      io.emit('balance_update', { addr: fm.addr, balance: fm.balance });
    }

    freshDb.blocks  = [...(freshDb.blocks||[]), block];
    freshDb.mempool = [];
    freshDb.stats   = freshDb.stats||{};
    freshDb.stats.totalTx = (freshDb.stats.totalTx||0) + txsToMine.length;
    dbWrite(freshDb);

    io.emit('block_found', block);
    console.log(`✓ Block #${block.height} nonce=${nonce} ${elapsed}ms`);
  } catch(err) {
    console.error('Mining error:', err);
    io.emit('mining_error', { error: err.message });
  } finally {
    miningActive = false;
  }
});

/* ══════════════════ SOCKET.IO ═══════════════════ */
const onlineUsers = new Map();
const getOnlineUsers = () => [...new Set(onlineUsers.values())];

io.use((socket, next) => {
  const decoded = verifyTok(socket.handshake.auth?.token);
  if (!decoded) return next(new Error('Unauthorized'));
  socket.user = decoded; next();
});

io.on('connection', socket => {
  onlineUsers.set(socket.id, socket.user.username);
  console.log(`⚡ ${socket.user.username} connected`);

  const db = dbRead();
  // Send full chain state
  socket.emit('chain_state', { blocks: db.blocks, mempool: db.mempool, stats: db.stats, difficulty: getDifficulty() });
  // Send fresh balance immediately on connect / reconnect
  const freshUser = db.users.find(u => u.id === socket.user.id);
  if (freshUser) socket.emit('balance_update', { addr: freshUser.addr, balance: freshUser.balance });

  io.emit('online_users', getOnlineUsers());

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    console.log(`✕ ${socket.user.username} disconnected`);
    io.emit('online_users', getOnlineUsers());
  });
});

/* ══════════════════ START ═══════════════════════ */
async function initGenesis() {
  const db = dbRead();
  if (db.blocks?.length) return;
  db.blocks = [{
    height:1, prevHash:'0'.repeat(64), txs:[], miner:'GENESIS',
    nonce:0, ts:Date.now(), difficulty:0, reward:0,
    hash: sha256('SecureCoin Genesis ' + Date.now()),
  }];
  dbWrite(db);
  console.log('✓ Genesis block created');
}

initGenesis().then(() => {
  server.listen(PORT, () => {
    console.log(`\n╔═══════════════════════════════════╗`);
    console.log(`║  SecureCoin Server v2.1 — FIXED   ║`);
    console.log(`║  http://localhost:${PORT}            ║`);
    console.log(`╚═══════════════════════════════════╝\n`);
    console.log('✓ CORS: all origins allowed');
    console.log('✓ ngrok-skip-browser-warning: supported');
    console.log('✓ balance_update events: enabled\n');
  });
});
