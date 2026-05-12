/* ─────────────────────────────────────────────
   SecureCoin · visualizer.js
   Canvas-based transaction send animation
───────────────────────────────────────────── */

const Visualizer = (() => {
  let canvas, ctx, animId;
  let phase = 'idle';     // idle | signing | broadcast | traveling | confirmed
  let progress = 0;       // 0-1 for packet travel
  let particles = [];
  let signatureChars = '';
  let targetSig = '';
  let charRevealIdx = 0;
  let charInterval;
  let fromName = '', toName = '', amount = 0;
  let fromColor = '#00d4ff', toColor = '#a855f7';
  let phaseLabel = '';

  const PHASES = {
    idle:       { label: '',                         color: 'rgba(255,255,255,0.3)' },
    signing:    { label: '🔐 Signing transaction…',  color: '#f59e0b' },
    broadcast:  { label: '📡 Broadcasting to network…', color: '#a855f7' },
    traveling:  { label: '⚡ Propagating through mempool…', color: '#00d4ff' },
    confirmed:  { label: '✓ Transaction confirmed!', color: '#10b981' },
  };

  function resize() {
    if (!canvas) return;
    canvas.width  = canvas.offsetWidth  * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    drawIdle();
  }

  function drawIdle() {
    if (!canvas || !ctx) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    ctx.clearRect(0, 0, W, H);

    // Floating "waiting" text
    ctx.font = '14px Sora, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'center';
    ctx.fillText('Fill in the form to preview a transaction', W / 2, H / 2);
  }

  /* ── Node drawing ── */
  function drawNode(x, y, label, color, glow = false) {
    const W = canvas.offsetWidth;
    // Glow
    if (glow) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
      g.addColorStop(0, color + '55');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ring
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill
    ctx.fillStyle = color + '22';
    ctx.fill();

    // Initial
    ctx.font = 'bold 14px Sora, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label[0].toUpperCase(), x, y);
    ctx.textBaseline = 'alphabetic';

    // Name
    ctx.font = '12px Sora, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(label, x, y + 36);
  }

  /* ── Bezier curve path ── */
  function getPath(W, H) {
    const lx = 60, rx = W - 60, my = H * 0.42;
    const cx1 = lx + (rx - lx) * 0.33;
    const cy1 = my - 55;
    const cx2 = lx + (rx - lx) * 0.67;
    const cy2 = my - 55;
    return { lx, rx, my, cx1, cy1, cx2, cy2 };
  }

  /* ── Point on bezier ── */
  function bezierPoint(t, lx, my, cx1, cy1, cx2, cy2, rx) {
    const mt = 1 - t;
    return {
      x: mt*mt*mt*lx + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*rx,
      y: mt*mt*mt*my + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*my,
    };
  }

  /* ── Particle burst ── */
  function spawnParticles(x, y, color) {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  /* ── Main draw loop ── */
  function drawFrame() {
    if (!canvas || !ctx) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    ctx.clearRect(0, 0, W, H);

    const { lx, rx, my, cx1, cy1, cx2, cy2 } = getPath(W, H);

    /* --- Draw bezier path (dashed) --- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lx, my);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, rx, my);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* --- Draw traveled path glow --- */
    if (phase === 'traveling' || phase === 'confirmed') {
      const grad = ctx.createLinearGradient(lx, 0, rx, 0);
      grad.addColorStop(0, fromColor + '88');
      grad.addColorStop(progress, fromColor + 'cc');
      grad.addColorStop(Math.min(progress + 0.001, 1), 'transparent');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lx, my);
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, rx, my);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();
    }

    /* --- Nodes --- */
    const isSigning   = phase === 'signing';
    const isConfirmed = phase === 'confirmed';
    drawNode(lx, my, fromName, fromColor, phase !== 'idle');
    drawNode(rx, my, toName, toColor, isConfirmed);

    /* --- Packet / glowing orb --- */
    if (phase === 'traveling' || phase === 'confirmed') {
      const p = bezierPoint(Math.min(progress, 1), lx, my, cx1, cy1, cx2, cy2, rx);

      // Trail
      for (let i = 1; i <= 8; i++) {
        const tp = bezierPoint(Math.max(0, progress - i * 0.018), lx, my, cx1, cy1, cx2, cy2, rx);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 3 - i * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = fromColor + Math.floor((1 - i/8) * 99).toString(16).padStart(2,'0');
        ctx.fill();
      }

      // Glow
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
      gr.addColorStop(0, fromColor + 'ff');
      gr.addColorStop(0.4, fromColor + '88');
      gr.addColorStop(1, 'transparent');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    /* --- Broadcast ring pulse --- */
    if (phase === 'broadcast') {
      const t = (Date.now() % 1200) / 1200;
      for (let i = 0; i < 3; i++) {
        const rt = (t + i / 3) % 1;
        ctx.beginPath();
        ctx.arc(lx, my, rt * 50, 0, Math.PI * 2);
        ctx.strokeStyle = fromColor + Math.floor((1 - rt) * 200).toString(16).padStart(2,'0');
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    /* --- Signing flash effect --- */
    if (phase === 'signing') {
      const t = (Date.now() % 800) / 800;
      ctx.beginPath();
      ctx.arc(lx, my, 22 + t * 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#f59e0b' + Math.floor((1-t) * 180).toString(16).padStart(2,'0');
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* --- Particles --- */
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(p.life * 255).toString(16).padStart(2,'0');
      ctx.fill();
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= 0.025;
    });

    /* --- Signature text reveal --- */
    if (phase === 'signing' || (phase === 'broadcast' && signatureChars)) {
      ctx.font = `11px 'JetBrains Mono', monospace`;
      ctx.fillStyle = '#f59e0b88';
      ctx.textAlign = 'left';
      ctx.fillText('sig: ' + signatureChars.slice(0, 22) + '…', lx - 22, my + 60);
    }

    /* --- Amount label --- */
    if (phase === 'traveling' && amount) {
      const p = bezierPoint(progress * 0.5, lx, my, cx1, cy1, cx2, cy2, rx);
      ctx.font = 'bold 13px Sora, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(`${amount} SRC`, p.x, p.y - 20);
    }

    /* --- Phase label --- */
    const info = PHASES[phase];
    if (info && info.label) {
      ctx.font = '13px Sora, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = info.color;
      ctx.fillText(info.label, W / 2, H - 16);
    }

    animId = requestAnimationFrame(drawFrame);
  }

  /* ══════════════════════════════
     Public API
  ══════════════════════════════ */

  function setContext(from, to, amt, fromCol, toCol) {
    fromName  = from;
    toName    = to;
    amount    = amt;
    fromColor = fromCol || '#00d4ff';
    toColor   = toCol   || '#a855f7';
  }

  function start(sig) {
    cancelAnimationFrame(animId);
    clearInterval(charInterval);
    particles   = [];
    progress    = 0;
    targetSig   = sig;
    signatureChars = '';
    charRevealIdx = 0;

    // Phase 1: Signing (0.8s) — reveal signature characters
    phase = 'signing';
    charInterval = setInterval(() => {
      if (charRevealIdx < targetSig.length) {
        signatureChars += targetSig[charRevealIdx++];
      } else {
        clearInterval(charInterval);
      }
    }, 15);

    drawFrame();

    setTimeout(() => {
      // Phase 2: Broadcast (0.6s)
      phase = 'broadcast';
      setTimeout(() => {
        // Phase 3: Travel
        phase = 'traveling';
        const START    = Date.now();
        const DURATION = 2200; // ms

        function travel() {
          progress = Math.min(1, (Date.now() - START) / DURATION);
          // Ease in-out
          const t = progress < 0.5
            ? 2 * progress * progress
            : -1 + (4 - 2 * progress) * progress;
          progress = t;

          if (progress < 1) {
            requestAnimationFrame(travel);
          } else {
            // Phase 4: Confirmed
            phase = 'confirmed';
            const W = canvas.offsetWidth, H = canvas.offsetHeight;
            const { rx, my } = getPath(W, H);
            spawnParticles(rx, my, toColor);
            setTimeout(() => {
              phase = 'idle';
              drawIdle();
            }, 4000);
          }
        }

        // Override the main loop for travel
        cancelAnimationFrame(animId);
        function mainLoop() {
          const W = canvas.offsetWidth, H = canvas.offsetHeight;
          ctx.clearRect(0, 0, W, H);
          const { lx, rx, my, cx1, cy1, cx2, cy2 } = getPath(W, H);

          // path
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(lx, my);
          ctx.bezierCurveTo(cx1, cy1, cx2, cy2, rx, my);
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 8]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();

          if (phase === 'traveling') {
            // traveled glow
            const grad = ctx.createLinearGradient(lx, 0, rx, 0);
            grad.addColorStop(0, fromColor + '66');
            grad.addColorStop(Math.min(progress, 0.999), fromColor + 'aa');
            grad.addColorStop(Math.min(progress + 0.001, 1), 'transparent');
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(lx, my);
            ctx.bezierCurveTo(cx1, cy1, cx2, cy2, rx, my);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();

            const p = bezierPoint(progress, lx, my, cx1, cy1, cx2, cy2, rx);
            for (let i = 1; i <= 8; i++) {
              const tp = bezierPoint(Math.max(0, progress - i * 0.02), lx, my, cx1, cy1, cx2, cy2, rx);
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, 3 - i * 0.3, 0, Math.PI * 2);
              ctx.fillStyle = fromColor + Math.floor((1 - i/8) * 160).toString(16).padStart(2,'0');
              ctx.fill();
            }
            const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18);
            gr.addColorStop(0, fromColor + 'ff');
            gr.addColorStop(0.4, fromColor + '77');
            gr.addColorStop(1, 'transparent');
            ctx.fillStyle = gr;
            ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();

            // Amount label
            const mp = bezierPoint(0.5, lx, my, cx1, cy1, cx2, cy2, rx);
            ctx.font = 'bold 13px Sora, sans-serif';
            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
            ctx.fillText(`${amount} SRC`, mp.x, mp.y - 22);
          }

          if (phase === 'confirmed') {
            spawnParticles(rx, my, toColor);
          }

          // nodes
          drawNode(lx, my, fromName, fromColor, phase === 'traveling');
          drawNode(rx, my, toName, toColor, phase === 'confirmed');

          // particles
          particles = particles.filter(p => p.life > 0);
          particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fillStyle = p.color + Math.floor(p.life * 255).toString(16).padStart(2,'0');
            ctx.fill();
            p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life -= 0.022;
          });

          // phase label
          const info = PHASES[phase];
          if (info && info.label) {
            ctx.font = '13px Sora, sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = info.color;
            ctx.fillText(info.label, W / 2, H - 16);
          }

          animId = requestAnimationFrame(mainLoop);
        }

        travel();
        mainLoop();
      }, 700);
    }, 900);
  }

  function reset() {
    cancelAnimationFrame(animId);
    clearInterval(charInterval);
    phase = 'idle';
    particles = [];
    if (canvas && ctx) drawIdle();
  }

  return { init, setContext, start, reset };
})();
