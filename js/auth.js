/* ─────────────────────────────────────────────
   SecureCoin · auth.js  (login / signup page)
───────────────────────────────────────────── */

(function () {
  /* Redirect if already logged in */
  if (localStorage.getItem('src_token')) {
    window.location.href = 'dashboard.html';
    return;
  }

  const $  = id => document.getElementById(id);
  let activeTab = 'login';

  /* ── Tab switching ── */
  function switchTab(tab) {
    activeTab = tab;
    $('tab-login').classList.toggle('active',  tab === 'login');
    $('tab-signup').classList.toggle('active', tab === 'signup');
    $('login-form').classList.toggle('hidden',  tab !== 'login');
    $('signup-form').classList.toggle('hidden', tab !== 'signup');
    clearError();
  }

  $('tab-login').addEventListener('click',  () => switchTab('login'));
  $('tab-signup').addEventListener('click', () => switchTab('signup'));

  /* ── Error display ── */
  function showError(msg) {
    const el = $(`${activeTab}-error`);
    el.textContent = msg;
    el.style.display = 'flex';
    el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
  }
  function clearError() {
    ['login-error', 'signup-error'].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ''; el.style.display = 'none'; }
    });
  }

  /* ── Set button loading state ── */
  function setLoading(btnId, loading) {
    const btn = $(btnId);
    btn.disabled = loading;
    const txt = btn.querySelector('.btn-text');
    const spn = btn.querySelector('.btn-spinner');
    if (txt) txt.style.opacity = loading ? '0' : '1';
    if (spn) spn.style.display = loading ? 'block' : 'none';
  }

  /* ── API call ── */
  async function apiPost(endpoint, body) {
    const res = await fetch(`${Config.API_URL}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ── Login ── */
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    if (!username || !password) { showError('Please fill in all fields'); return; }

    setLoading('login-btn', true);
    try {
      const { token, user } = await apiPost('/api/auth/login', { username, password });
      localStorage.setItem('src_token', token);
      localStorage.setItem('src_user',  JSON.stringify(user));
      window.location.href = 'dashboard.html';
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading('login-btn', false);
    }
  });

  /* ── Signup ── */
  $('signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    clearError();
    const username  = $('signup-username').value.trim();
    const password  = $('signup-password').value;
    const password2 = $('signup-password2').value;

    if (!username || !password) { showError('Please fill in all fields'); return; }
    if (password !== password2) { showError('Passwords do not match'); return; }
    if (password.length < 6)    { showError('Password must be at least 6 characters'); return; }

    setLoading('signup-btn', true);
    try {
      const { token, user } = await apiPost('/api/auth/signup', { username, password });
      localStorage.setItem('src_token', token);
      localStorage.setItem('src_user',  JSON.stringify(user));
      window.location.href = 'dashboard.html';
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading('signup-btn', false);
    }
  });

  /* ── Strength meter ── */
  $('signup-password').addEventListener('input', function () {
    const val = this.value;
    let strength = 0;
    if (val.length >= 6)  strength++;
    if (val.length >= 10) strength++;
    if (/[A-Z]/.test(val)) strength++;
    if (/[0-9]/.test(val)) strength++;
    if (/[^A-Za-z0-9]/.test(val)) strength++;

    const bar   = $('strength-bar');
    const label = $('strength-label');
    const levels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
    const colors = ['', '#ef4444', '#f59e0b', '#eab308', '#10b981', '#00d4ff'];

    bar.style.width = `${Math.min(100, strength * 22)}%`;
    bar.style.background = colors[strength] || 'transparent';
    label.textContent = levels[strength] || '';
    label.style.color = colors[strength] || 'transparent';
  });

  /* ── Password visibility toggle ── */
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.innerHTML = isText ? EYE_ICON : EYE_OFF_ICON;
    });
  });

  const EYE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

})();
