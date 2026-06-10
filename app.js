// ── CONFIG ──────────────────────────────────────────────
const SUPABASE_URL = 'https://mltuocbtbizessxxuwwc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdHVvY2J0Yml6ZXNzeHh1d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjEyMTQsImV4cCI6MjA5NjY5NzIxNH0.f-EE8bXiHzRenOTkQm-SIvzlg-ZlDKXX7GUDfEFGaL8';
const FOOTBALL_KEY = 'fded9c892feb4ab6b82773f3da05e879';
const FOOTBALL_BASE = 'https://api.football-data.org/v4';
const ENTRY_FEE = 5;
const ADMIN_PASSWORD = 'wc2026admin';

// ── GROUPS ──────────────────────────────────────────────
const GROUPS = {
  A: ['Mexico','South Africa','South Korea','Czech Republic'],
  B: ['Switzerland','Cameroon','Serbia','Guatemala'],
  C: ['Brazil','Croatia','Morocco','Chile'],
  D: ['Spain','Japan',"Côte d'Ivoire",'DR Congo'],
  E: ['Portugal','Ukraine','Algeria','Tanzania'],
  F: ['Argentina','Saudi Arabia','Canada','Australia'],
  G: ['Belgium','Egypt','Iran','New Zealand'],
  H: ['Netherlands','Hungary','Qatar','Venezuela'],
  I: ['France','Senegal','Iraq','Norway'],
  J: ['England','Tunisia','USA','Panama'],
  K: ['Germany','Colombia','Ecuador','Bosnia & Herz.'],
  L: ['Uruguay','Turkey','Kenya','Thailand']
};

const NAME_MAP = {
  'Korea Republic':'South Korea','Czechia':'Czech Republic',
  'United States':'USA','Ivory Coast':"Côte d'Ivoire",
  'Democratic Republic of the Congo':'DR Congo',
  'Bosnia and Herzegovina':'Bosnia & Herz.',
  'Bosnia & Herzegovina':'Bosnia & Herz.',
  'Türkiye':'Turkey','IR Iran':'Iran'
};

const STAGE_BONUS = {
  GROUP_STAGE:0, LAST_32:10, LAST_16:20,
  QUARTER_FINALS:35, SEMI_FINALS:50, THIRD_PLACE:35, FINAL:0
};

const PRIZE_SPLITS = [
  {pct:0.40, label:'1st place', icon:'🥇', cls:'p1'},
  {pct:0.25, label:'2nd place', icon:'🥈', cls:'p2'},
  {pct:0.15, label:'3rd place', icon:'🥉', cls:'p3'},
  {pct:0.10, label:'Best goal', icon:'⚽', cls:''},
  {pct:0.10, label:'Golden boot', icon:'👟', cls:''}
];

// ── STATE ───────────────────────────────────────────────
let participants = [];
let settings = { best_goal_team: '', golden_boot_team: '' };
let apiMatches = [];
let currentTab = 'leaderboard';
let adminUnlocked = false;
let saveTimers = {};

// ── SUPABASE HELPERS ────────────────────────────────────
async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}&order=slot`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPatch(table, match, data) {
  const params = Object.entries(match).map(([k,v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── LOAD DATA ───────────────────────────────────────────
async function loadSupabase() {
  const [parts, sets] = await Promise.all([
    sbGet('participants', 'select=slot,name,team'),
    sbGet('settings', 'select=key,value')
  ]);
  participants = parts;
  settings = {};
  sets.forEach(s => { settings[s.key] = s.value; });
}

// ── FOOTBALL DATA ───────────────────────────────────────
async function doFetch() {
  const badge = document.getElementById('api-badge');
  badge.textContent = 'Fetching...';
  badge.className = 'badge';
  try {
    // Route through Cloudflare Worker proxy
    
    const res = await fetch('https://wc2026-proxy.kiranchhina06.workers.dev');

    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    parseMatches(data.matches || []);
    const ft = apiMatches.filter(m => m.status === 'FINISHED').length;
    const live = apiMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED').length;
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    badge.textContent = `${live ? '● Live — ' : ''}${ft} results · ${now}`;
    badge.className = live ? 'badge live' : 'badge';
  } catch(e) {
    badge.textContent = `API error`;
    badge.className = 'badge err';
  }
  refreshCurrent();
}

function parseMatches(raw) {
  apiMatches = raw.map(m => ({
    id: m.id,
    home: m.homeTeam?.name || 'TBD',
    away: m.awayTeam?.name || 'TBD',
    hg: m.score?.fullTime?.home ?? null,
    ag: m.score?.fullTime?.away ?? null,
    status: m.status,
    stage: m.stage,
    round: m.matchday ? `Matchday ${m.matchday}` : (m.stage || '').replace(/_/g,' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    date: m.utcDate ? new Date(m.utcDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''
  }));
}

// ── HELPERS ─────────────────────────────────────────────
function mapName(n) { return NAME_MAP[n] || n; }
function teamGroup(t) { for (const [g, ts] of Object.entries(GROUPS)) if (ts.includes(t)) return g; return '?'; }
function owner(team) { const p = participants.find(p => p.team === team && p.name); return p ? p.name : null; }
function pot() { return participants.filter(p => p.name).length * ENTRY_FEE; }
function fmt(n) { return `£${Math.round(n)}`; }
function namedCount() { return participants.filter(p => p.name).length; }

function computeGroupTables() {
  const t = {};
  for (const [g, teams] of Object.entries(GROUPS)) {
    t[g] = {};
    teams.forEach(tm => { t[g][tm] = { p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 }; });
  }
  for (const m of apiMatches) {
    if (m.stage !== 'GROUP_STAGE') continue;
    const h = mapName(m.home), a = mapName(m.away);
    if (m.hg === null || m.ag === null) continue;
    const gh = teamGroup(h), ga = teamGroup(a);
    if (t[gh]?.[h]) { t[gh][h].p++; t[gh][h].gf+=m.hg; t[gh][h].ga+=m.ag; if(m.hg>m.ag){t[gh][h].w++;t[gh][h].pts+=3;}else if(m.hg===m.ag){t[gh][h].d++;t[gh][h].pts++;}else t[gh][h].l++; }
    if (t[ga]?.[a]) { t[ga][a].p++; t[ga][a].gf+=m.ag; t[ga][a].ga+=m.hg; if(m.ag>m.hg){t[ga][a].w++;t[ga][a].pts+=3;}else if(m.ag===m.hg){t[ga][a].d++;t[ga][a].pts++;}else t[ga][a].l++; }
  }
  return t;
}

function computeLeaderboard() {
  const tables = computeGroupTables();
  return participants.filter(p => p.name).map(p => {
    const team = p.team, g = teamGroup(team);
    const s = tables[g]?.[team] || { pts:0, gf:0, ga:0 };
    let bonus = 0;
    for (const m of apiMatches) {
      if (m.stage === 'GROUP_STAGE') continue;
      const h = mapName(m.home), a = mapName(m.away);
      if (h !== team && a !== team) continue;
      if (m.hg === null || m.ag === null) continue;
      if (m.stage === 'FINAL') {
        if ((h===team&&m.hg>m.ag)||(a===team&&m.ag>m.hg)) bonus = Math.max(bonus, 100);
        else bonus = Math.max(bonus, 70);
      } else {
        const won = (h===team&&m.hg>m.ag)||(a===team&&m.ag>m.hg);
        if (won) bonus = Math.max(bonus, STAGE_BONUS[m.stage] || 0);
      }
    }
    return { name: p.name, team, group: g, gpts: s.pts, bonus, total: s.pts + bonus };
  }).sort((a, b) => b.total - a.total || b.gpts - a.gpts);
}

// ── RENDER: LEADERBOARD ─────────────────────────────────
function renderLeaderboard() {
  const lb = computeLeaderboard();
  const p = pot();
  const nc = namedCount();
  const played = apiMatches.filter(m => m.status === 'FINISHED').length;
  const live = apiMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED').length;
  const total = apiMatches.length;

  document.getElementById('pot-amount').textContent = fmt(p);

  let html = `<div class="metrics">
    <div class="metric"><div class="metric-label">Prize pot</div><div class="metric-value">${fmt(p)}</div></div>
    <div class="metric"><div class="metric-label">Participants</div><div class="metric-value">${nc}<span style="font-size:14px;color:var(--text-muted)">/48</span></div></div>
    <div class="metric"><div class="metric-label">Matches played</div><div class="metric-value">${played}</div></div>
    <div class="metric"><div class="metric-label">Live now</div><div class="metric-value">${live}</div></div>
  </div>`;

  if (p > 0 && lb.length >= 3) {
    const bgOwner = settings.best_goal_team ? owner(settings.best_goal_team) : null;
    const gbOwner = settings.golden_boot_team ? owner(settings.golden_boot_team) : null;
    const winners = [lb[0]?.name, lb[1]?.name, lb[2]?.name, bgOwner, gbOwner];
    html += '<div class="prize-summary">';
    PRIZE_SPLITS.forEach((sp, i) => {
      html += `<div class="prize-box ${sp.cls}">
        <div class="picon">${sp.icon}</div>
        <div class="plabel">${sp.label}</div>
        <div class="pamount">${fmt(p * sp.pct)}</div>
        <div class="pwinner">${winners[i] || 'TBD'}</div>
      </div>`;
    });
    html += '</div>';
  }

  if (!lb.length) {
    html += '<div class="empty"><div class="empty-icon">👥</div>No participants yet — add names in Admin</div>';
    document.getElementById('tab-leaderboard').innerHTML = html;
    return;
  }

  html += '<div class="section-label">Standings</div><div class="card">';
  lb.forEach((entry, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const prizeAmt = p > 0 && i < 3 ? ` · <span class="lb-prize">${fmt(p * PRIZE_SPLITS[i].pct)}</span>` : '';
    const bonusLabel = entry.bonus ? `+${entry.bonus} bonus` : `Grp ${entry.gpts} pts`;
    html += `<div class="lb-row rank-${i+1}">
      <span class="lb-pos">${medal || i+1}</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-team">${entry.team}</span>
      <span class="lb-bonus">${bonusLabel}${prizeAmt}</span>
      <span class="lb-pts">${entry.total}</span>
    </div>`;
  });
  html += '</div>';

  html += `<div class="section-label" style="margin-top:1.5rem">Scoring key</div>
  <div class="card" style="display:grid;grid-template-columns:1fr auto;gap:6px 32px;font-size:13px">
    <span style="color:var(--text-muted)">Group stage points</span><span style="font-weight:600;text-align:right">Carry over</span>
    <span style="color:var(--text-muted)">Round of 32</span><span style="font-weight:600;text-align:right">+10</span>
    <span style="color:var(--text-muted)">Round of 16</span><span style="font-weight:600;text-align:right">+20</span>
    <span style="color:var(--text-muted)">Quarter-final</span><span style="font-weight:600;text-align:right">+35</span>
    <span style="color:var(--text-muted)">Semi-final</span><span style="font-weight:600;text-align:right">+50</span>
    <span style="color:var(--text-muted)">Runner-up</span><span style="font-weight:600;text-align:right">+70</span>
    <span style="color:var(--text-muted)">Winner 🏆</span><span style="font-weight:600;text-align:right">+100</span>
  </div>`;

  document.getElementById('tab-leaderboard').innerHTML = html;
}

// ── RENDER: SCORES ──────────────────────────────────────
function renderScores() {
  const el = document.getElementById('tab-scores');
  if (!apiMatches.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⚽</div>No match data yet</div>';
    return;
  }
  const live = apiMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
  const finished = apiMatches.filter(m => m.status === 'FINISHED').slice(-20).reverse();
  const upcoming = apiMatches.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED').slice(0, 12);
  let html = '';
  if (live.length) { html += '<div class="section-label">Live now</div>'; live.forEach(m => html += matchCard(m, 'live')); }
  if (finished.length) { html += `<div class="section-label" style="margin-top:${live.length?'1.5rem':'0'}">Recent results</div>`; finished.forEach(m => html += matchCard(m, 'ft')); }
  if (upcoming.length) { html += '<div class="section-label" style="margin-top:1.5rem">Upcoming</div>'; upcoming.forEach(m => html += matchCard(m, 'ns')); }
  el.innerHTML = html || '<div class="empty">No match data</div>';
}

function matchCard(m, type) {
  const h = mapName(m.home), a = mapName(m.away);
  const ho = owner(h), ao = owner(a);
  const isLive = type === 'live';
  const pill = isLive ? '<span class="pill pill-live">● Live</span>' :
    type === 'ft' ? '<span class="pill pill-ft">FT</span>' :
    '<span class="pill pill-ns">Upcoming</span>';
  const scoreHtml = type === 'ns'
    ? '<span class="match-score vs">vs</span>'
    : `<span class="match-score">${m.hg} – ${m.ag}</span>`;
  return `<div class="match-card ${isLive ? 'is-live' : ''}">
    <div class="match-teams">
      <span class="match-team">${h}</span>
      ${scoreHtml}
      <span class="match-team away">${a}</span>
    </div>
    <div class="match-meta">${pill}<span>${m.round}</span><span>${m.date}</span></div>
    ${(ho || ao) ? `<div class="match-owners"><span>${ho ? '👤 ' + ho : ''}</span><span>${ao ? '👤 ' + ao : ''}</span></div>` : ''}
  </div>`;
}

// ── RENDER: GROUPS ──────────────────────────────────────
function renderGroups() {
  const tables = computeGroupTables();
  let html = '<div class="groups-grid">';
  for (const [g, teams] of Object.entries(GROUPS)) {
    const sorted = [...teams].sort((a, b) => {
      const ta = tables[g][a], tb = tables[g][b];
      return (tb.pts - ta.pts) || ((tb.gf - tb.ga) - (ta.gf - ta.ga)) || (tb.gf - ta.gf);
    });
    html += `<div class="group-card">
      <div class="group-header">GROUP ${g}</div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>Owner</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead>
        <tbody>`;
    sorted.forEach((t, i) => {
      const s = tables[g][t];
      const qualified = s.p >= 2 && i < 2;
      html += `<tr class="${qualified ? 'qualified' : ''}">
        <td>${t}</td><td>${owner(t) || '—'}</td>
        <td>${s.p}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td>
        <td>${s.gf}</td><td>${s.ga}</td><td class="pts-col">${s.pts}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  document.getElementById('tab-groups').innerHTML = html;
}

// ── RENDER: PRIZES ──────────────────────────────────────
function renderPrizes() {
  const lb = computeLeaderboard();
  const p = pot();
  const nc = namedCount();
  const bgOwner = settings.best_goal_team ? owner(settings.best_goal_team) : null;
  const gbOwner = settings.golden_boot_team ? owner(settings.golden_boot_team) : null;
  const winners = [lb[0]?.name, lb[1]?.name, lb[2]?.name, bgOwner, gbOwner];

  const allTeams = Object.values(GROUPS).flat();
  const teamOpts = allTeams.map(t => `<option value="${t}" ${settings.best_goal_team===t?'selected':''}>${t}${owner(t)?' ('+owner(t)+')':''}</option>`).join('');
  const teamOpts2 = allTeams.map(t => `<option value="${t}" ${settings.golden_boot_team===t?'selected':''}>${t}${owner(t)?' ('+owner(t)+')':''}</option>`).join('');

  let html = `
  <div class="metrics" style="margin-bottom:20px">
    <div class="metric"><div class="metric-label">Total pot</div><div class="metric-value">${fmt(p)}</div></div>
    <div class="metric"><div class="metric-label">Entry fee</div><div class="metric-value">£5</div></div>
    <div class="metric"><div class="metric-label">Paid in</div><div class="metric-value">${nc}</div></div>
    <div class="metric"><div class="metric-label">Remaining</div><div class="metric-value">${48-nc}</div></div>
  </div>

  <div class="section-label">Prize breakdown</div>
  <div class="card prizes-breakdown">`;
  PRIZE_SPLITS.forEach((sp, i) => {
    html += `<div class="lb-row">
      <span style="width:28px;text-align:center;font-size:18px;flex-shrink:0">${sp.icon}</span>
      <span class="lb-name">${sp.label}</span>
      <span class="lb-team">${Math.round(sp.pct*100)}%</span>
      <span style="font-size:14px;font-weight:700;flex-shrink:0;min-width:50px;text-align:right">${fmt(p*sp.pct)}</span>
      <span style="font-size:13px;color:var(--text-muted);flex-shrink:0;min-width:100px;text-align:right">${winners[i]||'TBD'}</span>
    </div>`;
  });
  html += `</div>

  <div class="section-label" style="margin-top:1.5rem">Best goal &amp; golden boot</div>
  <div class="card">
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select the team whose player won each award — their owner gets the prize. Set by admin only.</p>
    <div class="two-col">
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">⚽ Best goal — team</div>
        <select class="select-field" onchange="updateSetting('best_goal_team',this.value)" ${!adminUnlocked?'disabled':''}>
          <option value="">— not yet awarded —</option>${teamOpts}
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">👟 Golden boot — team</div>
        <select class="select-field" onchange="updateSetting('golden_boot_team',this.value)" ${!adminUnlocked?'disabled':''}>
          <option value="">— not yet awarded —</option>${teamOpts2}
        </select>
      </div>
    </div>
    ${!adminUnlocked ? '<p style="font-size:12px;color:var(--text-muted);margin-top:10px">🔒 Unlock Admin tab to change these</p>' : ''}
  </div>`;

  document.getElementById('tab-prizes').innerHTML = html;
}

// ── RENDER: ADMIN ───────────────────────────────────────
function renderAdmin() {
  const el = document.getElementById('tab-admin');
  if (!adminUnlocked) {
    el.innerHTML = `<div class="admin-lock">
      <div style="font-size:40px;margin-bottom:12px">🔒</div>
      <h2>Admin access</h2>
      <p>Enter the admin password to manage participants and settings.</p>
      <input type="password" class="input-field" id="admin-pw-input" placeholder="Password" onkeydown="if(event.key==='Enter')checkAdminPw()">
      <button class="btn primary" onclick="checkAdminPw()" style="width:100%">Unlock</button>
      <p id="pw-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none">Incorrect password</p>
    </div>`;
    return;
  }

  const nc = namedCount();
  const pct = Math.round((nc / 48) * 100);

  let html = `
  <div class="alert info" style="margin-bottom:16px">You're logged in as admin. Changes save automatically to the database and update for all visitors.</div>

  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="section-label" style="margin:0">Participants — ${nc}/48 entered</span>
      <span style="font-size:13px;font-weight:600;color:var(--gold-dark)">${fmt(pot())} pot</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="progress-label">${nc} of 48 paid · ${48-nc} spots remaining</div>
  </div>

  <div class="participants-grid" id="participants-grid">`;

  participants.forEach((p, i) => {
    html += `<div class="participant-row ${p.name ? 'filled' : ''}" id="prow-${p.slot}">
      <span class="slot-num">${p.slot}</span>
      <input type="text" placeholder="Name…" value="${escHtml(p.name)}" data-slot="${p.slot}"
        oninput="scheduleNameSave(this)" />
      <span class="team-name">${p.team}</span>
      <span class="save-indicator" id="save-ind-${p.slot}">✓</span>
    </div>`;
  });

  html += `</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
    <button class="btn" onclick="refreshParticipants()">↻ Reload names</button>
    <button class="btn danger" onclick="if(confirm('Clear all names?'))clearAllNames()">Clear all names</button>
  </div>`;

  el.innerHTML = html;
}

function checkAdminPw() {
  const val = document.getElementById('admin-pw-input')?.value;
  if (val === ADMIN_PASSWORD) {
    adminUnlocked = true;
    renderAdmin();
  } else {
    const err = document.getElementById('pw-error');
    if (err) { err.style.display = 'block'; }
  }
}

function scheduleNameSave(input) {
  const slot = parseInt(input.dataset.slot);
  const name = input.value.trim();
  const row = document.getElementById(`prow-${slot}`);
  if (row) row.className = `participant-row ${name ? 'filled' : ''}`;
  clearTimeout(saveTimers[slot]);
  saveTimers[slot] = setTimeout(() => saveName(slot, name), 600);
}

async function saveName(slot, name) {
  try {
    await sbPatch('participants', { slot }, { name });
    const p = participants.find(p => p.slot === slot);
    if (p) p.name = name;
    const ind = document.getElementById(`save-ind-${slot}`);
    if (ind) { ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1500); }
    document.getElementById('pot-amount').textContent = fmt(pot());
    const nc = namedCount();
    const pct = Math.round((nc / 48) * 100);
    const fill = document.querySelector('.progress-fill');
    if (fill) fill.style.width = `${pct}%`;
    const lbl = document.querySelector('.progress-label');
    if (lbl) lbl.textContent = `${nc} of 48 paid · ${48 - nc} spots remaining`;
  } catch(e) { console.error('Save failed:', e); }
}

async function updateSetting(key, value) {
  try {
    await sbPatch('settings', { key }, { value });
    settings[key] = value;
    renderPrizes();
    if (currentTab === 'leaderboard') renderLeaderboard();
  } catch(e) { console.error('Setting save failed:', e); }
}

async function refreshParticipants() {
  await loadSupabase();
  renderAdmin();
}

async function clearAllNames() {
  for (const p of participants) {
    await sbPatch('participants', { slot: p.slot }, { name: '' });
    p.name = '';
  }
  renderAdmin();
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TAB ROUTING ─────────────────────────────────────────
function showTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  currentTab = tab;
  refreshCurrent();
}

function refreshCurrent() {
  if (currentTab === 'leaderboard') renderLeaderboard();
  else if (currentTab === 'scores') renderScores();
  else if (currentTab === 'groups') renderGroups();
  else if (currentTab === 'prizes') renderPrizes();
  else if (currentTab === 'admin') renderAdmin();
}

// ── INIT ────────────────────────────────────────────────
async function init() {
  try {
    await loadSupabase();
  } catch(e) {
    console.warn('Supabase load failed:', e);
  }
  renderLeaderboard();
  doFetch();
  setInterval(doFetch, 60000);
  setInterval(async () => {
    try { await loadSupabase(); refreshCurrent(); } catch(e) {}
  }, 30000);
}

init();
