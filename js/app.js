/* ─────────────────────────────────────────────
   SecureCoin · app.js  (v2.1 — CORS + balance fixes)
───────────────────────────────────────────── */
(function () {
  const token = localStorage.getItem('src_token');
  let   user  = JSON.parse(localStorage.getItem('src_user') || 'null');
  if (!token || !user) { window.location.href = 'index.html'; return; }

  const $ = id => document.getElementById(id);
  let socket, chainState = { blocks:[], mempool:[], stats:{} };
  let miningActive = false;
  let walletList   = [];

  /* ════════════════════════════════
     FIX 1 — API helper
     Add ngrok-skip-browser-warning to EVERY request.
     Without this, ngrok shows an interstitial HTML
     page instead of JSON, breaking all API calls.
  ════════════════════════════════ */
  async function api(method, path, body) {
    const res = await fetch(Config.API_URL + path, {
      method,
      headers: {
        'Content-Type':                'application/json',
        'Authorization':               'Bearer ' + token,
        'ngrok-skip-browser-warning':  'true',   // ← KEY FIX
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function logout() {
    localStorage.removeItem('src_token');
    localStorage.removeItem('src_user');
    window.location.href = 'index.html';
  }

  /* ════════ Toast ════════ */
  function toast(msg, type='info', dur=4000) {
    const icons = { success:'✓', error:'✕', info:'◈', warning:'⚠', mining:'⛏' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type]||'◈'}</span><span>${msg}</span>`;
    $('toast-container').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(()=>t.remove(),400); }, dur);
  }

  /* ════════ Ripple ════════ */
  function ripple(btn) {
    btn.addEventListener('click', e => {
      const r = btn.getBoundingClientRect();
      const sz = Math.max(r.width,r.height)*2;
      const w  = document.createElement('span');
      w.className = 'ripple-wave';
      w.style.cssText = `width:${sz}px;height:${sz}px;left:${e.clientX-r.left-sz/2}px;top:${e.clientY-r.top-sz/2}px`;
      btn.appendChild(w);
      setTimeout(()=>w.remove(),700);
    });
  }

  /* ════════ Custom dropdown ════════ */
  function buildDropdown(wrapperId, options, onSelect) {
    const wrapper = $(wrapperId);
    if (!wrapper) return null;
    wrapper.innerHTML = '';
    wrapper.classList.add('custom-select');

    const display  = document.createElement('div');
    display.className = 'cs-display';
    const dropdown = document.createElement('div');
    dropdown.className = 'cs-dropdown glass';

    let selected = options[0];
    let currentOptions = [...options];

    const renderDisplay = () => {
      if (!selected) return;
      display.innerHTML = `
        <div class="cs-avatar" style="--c:${selected.color||'#00d4ff'}">${selected.label[0]}</div>
        <div class="cs-info">
          <span class="cs-name">${selected.label}</span>
          <span class="cs-sub">${selected.sub||''}</span>
        </div>
        <svg class="cs-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
    };

    const renderOptions = () => {
      dropdown.innerHTML = currentOptions.map(opt => `
        <div class="cs-option${opt.value===selected?.value?' selected':''}" data-val="${opt.value}">
          <div class="cs-avatar sm" style="--c:${opt.color||'#00d4ff'}">${opt.label[0]}</div>
          <div class="cs-info">
            <span class="cs-name">${opt.label}</span>
            <span class="cs-sub">${opt.sub||''}</span>
          </div>
          ${opt.value===selected?.value?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 11 4 16"/></svg>':''}
        </div>`).join('');
      dropdown.querySelectorAll('.cs-option').forEach(el => {
        el.addEventListener('click', () => {
          selected = currentOptions.find(o=>o.value===el.dataset.val);
          renderDisplay(); renderOptions();
          wrapper.classList.remove('open');
          if (onSelect) onSelect(selected);
        });
      });
    };

    display.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach(el => { if(el!==wrapper) el.classList.remove('open'); });
      wrapper.classList.toggle('open');
    });
    document.addEventListener('click', () => wrapper.classList.remove('open'));

    renderDisplay(); renderOptions();
    wrapper.appendChild(display);
    wrapper.appendChild(dropdown);

    return {
      getValue: () => selected?.value,
      setValue: val => { selected = currentOptions.find(o=>o.value===val)||currentOptions[0]; renderDisplay(); renderOptions(); },
      refresh:  newOpts => {
        const prev = selected?.value;
        currentOptions = newOpts;
        selected = currentOptions.find(o=>o.value===prev) || currentOptions[0];
        renderDisplay(); renderOptions();
      },
    };
  }

  let toDropdown;

  /* ════════ Colour palette ════════ */
  const COLORS = ['#00d4ff','#a855f7','#f59e0b','#10b981','#ec4899','#f97316'];
  const walletColor = addr => {
    const idx = walletList.findIndex(w=>w.addr===addr);
    return COLORS[idx<0?0:idx%COLORS.length];
  };

  /* ════════════════════════════════
     FIX 2 — Balance update handler
     Called from socket 'balance_update' event
     AND after every successful transaction.
  ════════════════════════════════ */
  function applyBalanceUpdate(addr, balance) {
    if (addr === user.addr) {
      user.balance = balance;
      localStorage.setItem('src_user', JSON.stringify(user));
      renderWalletBar();
      refreshDropdowns();
    }
    // Also update walletList for the leaderboard/dropdowns
    const w = walletList.find(w=>w.addr===addr);
    if (w) w.balance = balance;
  }

  /* ════════ Render helpers ════════ */
  function renderWalletBar() {
    $('user-balance').textContent = (user.balance||0).toFixed(4) + ' SRC';
    $('user-addr').textContent    = user.addr ? user.addr.slice(0,10)+'…'+user.addr.slice(-6) : '';
  }

  function renderStats() {
    const blocks  = chainState.blocks||[];
    const mempool = chainState.mempool||[];
    const latest  = blocks[blocks.length-1];
    $('stat-blocks').textContent    = blocks.length;
    $('stat-pending').textContent   = mempool.length;
    $('stat-difficulty').textContent= chainState.difficulty || getDifficultyLocal(blocks.length);
    $('stat-totaltx').textContent   = (chainState.stats||{}).totalTx||0;
    if (latest) {
      $('stat-last-hash').textContent  = latest.hash.slice(0,14)+'…';
      $('stat-last-miner').textContent = latest.minerName||latest.miner.slice(0,8)+'…';
    }
    const badge = $('mempool-badge');
    if (badge) { badge.textContent = mempool.length; badge.classList.toggle('has-items', mempool.length>0); }
  }

  function getDifficultyLocal(n) { return Math.min(2+Math.floor(n/5),5); }

  function renderMempool() {
    const list = $('mempool-list');
    const txs  = chainState.mempool||[];
    list.innerHTML = txs.length
      ? txs.map(tx=>txRow(tx,'pending')).join('')
      : '<div class="empty-state"><span class="empty-icon">◎</span><span>No pending transactions</span></div>';
  }

  function renderChain() {
    const list   = $('chain-list');
    const blocks = [...(chainState.blocks||[])].reverse();
    list.innerHTML = blocks.map(b=>`
      <div class="block-card" tabindex="0" onclick="this.querySelector('.block-details').classList.toggle('open')" aria-expanded="false">
        <div class="block-header">
          <span class="block-num">#${b.height}</span>
          <span class="block-meta">${b.txs.length} tx · nonce ${(b.nonce||0).toLocaleString()} · diff ${b.difficulty||0}</span>
          <span class="block-time">${timeAgo(b.ts)}</span>
        </div>
        <div class="block-hash mono">${b.hash.slice(0,28)}…${b.hash.slice(-6)}</div>
        <div class="block-details">
          <div class="block-detail-grid">
            <div class="bd-item"><span class="bd-label">Miner</span><span class="bd-val">${b.minerName||b.miner.slice(0,12)}</span></div>
            <div class="bd-item"><span class="bd-label">Reward</span><span class="bd-val">${b.reward||0} SRC</span></div>
            <div class="bd-item"><span class="bd-label">Elapsed</span><span class="bd-val">${b.elapsed?(b.elapsed/1000).toFixed(2)+'s':'—'}</span></div>
            <div class="bd-item"><span class="bd-label">Prev hash</span><span class="bd-val mono">${b.prevHash.slice(0,16)}…</span></div>
          </div>
          ${b.txs.filter(t=>t.from!=='COINBASE').map(t=>`
            <div class="bd-tx">${t.fromName||t.from.slice(0,8)} → ${t.toName||t.to.slice(0,8)} · <b>${t.amount} SRC</b></div>`).join('')}
        </div>
      </div>`).join('');
  }

  function renderHistory() {
    const list   = $('history-list');
    const allTxs = (chainState.blocks||[]).flatMap(b=>b.txs.map(t=>({...t,blockHeight:b.height})))
      .sort((a,b)=>b.ts-a.ts).slice(0,60);
    list.innerHTML = allTxs.length
      ? allTxs.map(tx=>txRow(tx,tx.status||'confirmed')).join('')
      : '<div class="empty-state"><span class="empty-icon">◎</span><span>No confirmed transactions yet</span></div>';
  }

  function renderLeaderboard() {
    api('GET','/api/leaderboard').then(board=>{
      const list = $('leaderboard-list'); if(!list) return;
      list.innerHTML = board.map((u,i)=>`
        <div class="lb-row">
          <span class="lb-rank">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span>
          <span class="lb-name">${u.username}</span>
          <span class="lb-bal">${(u.balance||0).toFixed(2)} SRC</span>
          <span class="lb-mined">${(u.totalMined||0).toFixed(1)} mined</span>
        </div>`).join('');
    }).catch(()=>{});
  }

  function txRow(tx, status) {
    const fc = tx.from==='COINBASE' ? '#a855f7' : walletColor(tx.from);
    const tc = walletColor(tx.to);
    const isMe = tx.from===user.addr||tx.to===user.addr;
    return `
      <div class="tx-item${isMe?' tx-mine':''}">
        <div class="tx-av" style="--c:${fc}">${(tx.fromName||'?')[0]}</div>
        <svg class="tx-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        <div class="tx-av" style="--c:${tc}">${(tx.toName||'?')[0]}</div>
        <div class="tx-info">
          <div class="tx-route">${tx.fromName||tx.from.slice(0,8)} → ${tx.toName||tx.to.slice(0,8)}</div>
          ${tx.memo?`<div class="tx-memo">${tx.memo}</div>`:''}
          ${tx.blockHeight?`<div class="tx-meta">Block #${tx.blockHeight}</div>`:''}
        </div>
        <span class="tx-amt${tx.to===user.addr?' positive':''}">${tx.to===user.addr?'+':''}${tx.amount} SRC</span>
        <span class="tx-status ${status}">${status}</span>
      </div>`;
  }

  function timeAgo(ts) {
    const s=Math.floor((Date.now()-ts)/1000);
    if(s<5) return 'just now'; if(s<60) return s+'s ago'; if(s<3600) return Math.floor(s/60)+'m ago';
    return Math.floor(s/3600)+'h ago';
  }

  /* ════════════════════════════════
     SEND TRANSACTION
  ════════════════════════════════ */
  async function sendTransaction() {
    const toAddr = toDropdown?.getValue();
    const amount = parseFloat($('amount-input').value);
    const memo   = $('memo-input').value.trim();

    if (!toAddr)              return toast('Select a recipient','error');
    if (!amount || amount<=0) return toast('Enter a valid amount','error');
    if (amount > (user.balance||0)) return toast(`Insufficient balance (${(user.balance||0).toFixed(4)} SRC)`,'error');

    const sendBtn = $('send-btn');
    sendBtn.disabled = true;

    // Start visualizer animation immediately
    const toWallet = walletList.find(w=>w.addr===toAddr);
    const fromIdx  = walletList.findIndex(w=>w.addr===user.addr);
    const toIdx    = walletList.findIndex(w=>w.addr===toAddr);
    Visualizer.setContext(user.username, toWallet?.username||toAddr.slice(0,8), amount, COLORS[fromIdx%COLORS.length]||COLORS[0], COLORS[toIdx%COLORS.length]||COLORS[1]);
    Visualizer.start(Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join(''));

    try {
      /* ─── FIX: use senderBalance from server response ─── */
      const { tx, senderBalance } = await api('POST','/api/transaction',{ to:toAddr, amount, memo });

      // Sync balance from authoritative server value (not just local estimate)
      applyBalanceUpdate(user.addr, senderBalance);

      $('amount-input').value = '';
      $('memo-input').value   = '';
      toast(`Transaction broadcast! ID: ${tx.id}`,'success');
    } catch(err) {
      Visualizer.reset();
      toast(err.message,'error');
    } finally {
      sendBtn.disabled = false;
    }
  }

  /* ════════════════════════════════
     MINING
  ════════════════════════════════ */
  let miningTimer;

  function startMiningUI() {
    miningActive = true;
    $('mining-overlay').classList.add('active');
    $('mine-btn').disabled = true;
    $('mine-btn').classList.add('mining');
    let t = 0;
    miningTimer = setInterval(() => { $('mine-elapsed').textContent = (++t/5).toFixed(1)+'s'; }, 200);
  }

  function stopMiningUI(keepOpen=false) {
    miningActive = false;
    clearInterval(miningTimer);
    $('mine-btn').disabled = false;
    $('mine-btn').classList.remove('mining');
    if (!keepOpen) $('mining-overlay').classList.remove('active','found');
  }

  function updateMiningProgress({ nonce, hash, rate, difficulty }) {
    if (!miningActive) return;
    $('mine-nonce').textContent  = (nonce||0).toLocaleString();
    $('mine-rate').textContent   = (rate||0).toLocaleString()+' H/s';
    let leading=0; for(const c of hash){if(c==='0')leading++;else break;}
    $('mine-hash').innerHTML     = `<span style="color:#10b981">${hash.slice(0,leading)}</span>${hash.slice(leading)}`;
    $('mine-target').textContent = '0'.repeat(difficulty||4)+'…';
    const r=44, circ=2*Math.PI*r;
    const ring = $('mine-ring-progress');
    if(ring){ ring.style.strokeDasharray=circ; ring.style.strokeDashoffset=circ*(1-Math.min(1,leading/(difficulty||4))); }
  }

  function onBlockFound(block) {
    $('mine-found-height').textContent = '#'+block.height;
    $('mine-found-hash').textContent   = block.hash.slice(0,20)+'…';
    $('mine-found-nonce').textContent  = (block.nonce||0).toLocaleString();
    $('mine-found-time').textContent   = ((block.elapsed||0)/1000).toFixed(2)+'s';
    $('mining-overlay').classList.add('found');
    toast(`⛏ Block #${block.height} mined! +${block.reward} SRC`,'mining',6000);
    setTimeout(()=>stopMiningUI(false), 5000);
  }

  async function startMining() {
    if (miningActive) return;
    if (!(chainState.mempool||[]).length) { toast('No pending transactions to mine','warning'); return; }
    startMiningUI();
    try {
      await api('POST','/api/mine',{});
    } catch(err) {
      toast(err.message,'error');
      stopMiningUI();
    }
  }

  /* ════════════════════════════════
     WEBSOCKET
  ════════════════════════════════ */
  function connectSocket() {
    socket = io(Config.API_URL, {
      auth: { token },
      /* ─── FIX: add ngrok header so socket polling works through ngrok ─── */
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
      transports: ['polling','websocket'],
      withCredentials: false,
    });

    socket.on('connect', () => {
      $('connection-dot').className   = 'dot online';
      $('connection-label').textContent = 'Connected';
    });

    socket.on('disconnect', () => {
      $('connection-dot').className   = 'dot offline';
      $('connection-label').textContent = 'Reconnecting…';
    });

    socket.on('chain_state', state => {
      chainState = state;
      renderAll();
    });

    /* ─── FIX: listen for balance_update from server ─── */
    socket.on('balance_update', ({ addr, balance }) => {
      applyBalanceUpdate(addr, balance);
      renderLeaderboard();
    });

    socket.on('new_tx', tx => {
      chainState.mempool = [...(chainState.mempool||[]), tx];
      renderMempool();
      renderStats();
      if (tx.fromName !== user.username)
        toast(`New TX: ${tx.fromName}→${tx.toName} · ${tx.amount} SRC`,'info',3000);
    });

    socket.on('mining_progress', updateMiningProgress);

    socket.on('block_found', block => {
      chainState.blocks  = [...(chainState.blocks||[]), block];
      chainState.mempool = [];
      if (miningActive) onBlockFound(block);
      else toast(`⛏ Block #${block.height} mined by ${block.minerName}`,'info',4000);
      renderAll();
    });

    socket.on('user_joined', ({ username }) => toast(`${username} joined the network`,'info',2500));

    socket.on('online_users', users => {
      $('online-count').textContent = users.length;
      $('online-list').textContent  = users.join(', ');
    });

    socket.on('connect_error', err => {
      console.warn('Socket error:', err.message);
      $('connection-dot').className   = 'dot offline';
      $('connection-label').textContent = 'Disconnected';
    });
  }

  /* ════════ Tabs ════════ */
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        $(target)?.classList.add('active');
      });
    });
  }

  /* ════════ Scroll reveal ════════ */
  function initReveal() {
    const obs = new IntersectionObserver(entries=>entries.forEach(e=>{
      if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}
    }),{threshold:0.06});
    document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
    setTimeout(()=>document.querySelectorAll('.reveal').forEach(el=>{
      if(el.getBoundingClientRect().top<window.innerHeight) el.classList.add('visible');
    }),80);
  }

  /* ════════ Dropdowns ════════ */
  function walletOpts(excludeAddr) {
    return walletList.filter(w=>w.addr!==excludeAddr).map((w,i)=>({
      value: w.addr, label: w.username,
      sub: (w.balance||0).toFixed(4)+' SRC',
      color: COLORS[i%COLORS.length],
    }));
  }

  function refreshDropdowns() {
    const opts = walletOpts(user.addr);
    if (toDropdown) toDropdown.refresh(opts.length ? opts : [{value:'',label:'No other wallets',sub:'',color:'#666'}]);
  }

  /* ════════ Full render ════════ */
  function renderAll() {
    renderStats(); renderMempool(); renderChain(); renderHistory(); renderLeaderboard(); refreshDropdowns();
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  async function init() {
    $('nav-username').textContent    = user.username;
    $('nav-user-avatar').textContent = user.username[0].toUpperCase();
    renderWalletBar();

    try {
      const [chain, board] = await Promise.all([
        api('GET','/api/chain'),
        api('GET','/api/leaderboard'),
      ]);
      chainState = chain;
      walletList = board;
      if (!walletList.find(w=>w.addr===user.addr))
        walletList.unshift({ username:user.username, addr:user.addr, balance:user.balance });
    } catch(err) {
      toast('Cannot reach server. Check server is running and API_URL in config.js','error',10000);
    }

    // Build "To" dropdown
    const toOpts = walletOpts(user.addr);
    toDropdown = buildDropdown('to-dropdown', toOpts.length ? toOpts : [{value:'',label:'No wallets yet',sub:'',color:'#666'}], ()=>{});

    // Visualizer
    const canvas = $('tx-canvas');
    if (canvas) Visualizer.init(canvas);

    // Wire buttons
    $('send-btn').addEventListener('click', sendTransaction);
    $('mine-btn').addEventListener('click', startMining);
    $('logout-btn').addEventListener('click', logout);
    $('copy-addr-btn')?.addEventListener('click', ()=>
      navigator.clipboard.writeText(user.addr).then(()=>toast('Address copied!','success',2000)));

    // Amount input — fee preview + validation colour
    $('amount-input').addEventListener('input', function() {
      const v = parseFloat(this.value), bal = user.balance||0;
      this.style.borderColor = (!isNaN(v)&&v>0&&v<=bal) ? 'rgba(16,185,129,.5)' : '';
      $('fee-display').textContent = isNaN(v) ? '—' : (v*0.001).toFixed(6)+' SRC';
    });

    // Keyboard shortcut
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(!$('send-btn').disabled)sendTransaction();}
      if (e.key==='Escape') stopMiningUI();
    });

    ['send-btn','mine-btn'].forEach(id=>{const b=$(id);if(b)ripple(b);});

    initTabs();
    initReveal();
    connectSocket();
    renderAll();

    // Refresh timestamps every 15s
    setInterval(()=>{renderMempool();renderHistory();renderChain();}, 15000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
