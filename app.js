// ── CONFIG ──────────────────────────────────────────────
const SUPABASE_URL = 'https://mltuocbtbizessxxuwwc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdHVvY2J0Yml6ZXNzeHh1d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjEyMTQsImV4cCI6MjA5NjY5NzIxNH0.f-EE8bXiHzRenOTkQm-SIvzlg-ZlDKXX7GUDfEFGaL8';
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

const STAGE_BONUS = {
  GROUP_STAGE:0, LAST_32:10, LAST_16:20,
  QUARTER_FINALS:35, SEMI_FINALS:50, THIRD_PLACE:35, FINAL:0
};

const STAGE_LABELS = {
  GROUP_STAGE:'Group Stage', LAST_32:'Round of 32', LAST_16:'Round of 16',
  QUARTER_FINALS:'Quarter-final', SEMI_FINALS:'Semi-final',
  THIRD_PLACE:'3rd Place', FINAL:'Final'
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
let matches = [];
let currentTab = 'leaderboard';
let adminUnlocked = false;
let saveTimers = {};

// ── SUPABASE ────────────────────────────────────────────
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPatch(table, matchObj, data) {
  const params = Object.entries(matchObj).map(([k,v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbDelete(table, matchObj) {
  const params = Object.entries(matchObj).map(([k,v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'DELETE', headers: SB_HEADERS
  });
  if (!res.ok) throw new Error(await res.text());
}

async function loadAll() {
  const [parts, sets] = await Promise.all([
    sbGet('participants', 'select=slot,name,team&order=slot'),
    sbGet('settings', 'select=key,value')
  ]);
  participants = parts;
  settings = {};
  sets.forEach(s => { settings[s.key] = s.value; });
  // matches table may not exist yet if SQL hasn't been run
  try {
    matches = await sbGet('matches', 'select=*&order=id');
  } catch(e) {
    matches = [];
  }
}

// ── HELPERS ─────────────────────────────────────────────
function teamGroup(t) { for (const [g, ts] of Object.entries(GROUPS)) if (ts.includes(t)) return g; return '?'; }
function owner(team) { const p = participants.find(p => p.team === team && p.name); return p ? p.name : null; }
function pot() { return participants.filter(p => p.name).length * ENTRY_FEE; }
function fmt(n) { return `£${Math.round(n)}`; }
function namedCount() { return participants.filter(p => p.name).length; }
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function computeGroupTables() {
  const t = {};
  for (const [g, teams] of Object.entries(GROUPS)) {
    t[g] = {};
    teams.forEach(tm => { t[g][tm] = {p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}; });
  }
  for (const m of matches) {
    if (m.stage !== 'GROUP_STAGE') continue;
    if (m.home_goals === null || m.away_goals === null) continue;
    const h = m.home, a = m.away;
    const gh = teamGroup(h), ga = teamGroup(a);
    const hg = m.home_goals, ag = m.away_goals;
    if (t[gh]?.[h]) { t[gh][h].p++; t[gh][h].gf+=hg; t[gh][h].ga+=ag; if(hg>ag){t[gh][h].w++;t[gh][h].pts+=3;}else if(hg===ag){t[gh][h].d++;t[gh][h].pts++;}else t[gh][h].l++; }
    if (t[ga]?.[a]) { t[ga][a].p++; t[ga][a].gf+=ag; t[ga][a].ga+=hg; if(ag>hg){t[ga][a].w++;t[ga][a].pts+=3;}else if(ag===hg){t[ga][a].d++;t[ga][a].pts++;}else t[ga][a].l++; }
  }
  return t;
}

function computeLeaderboard() {
  const tables = computeGroupTables();
  return participants.filter(p => p.name).map(p => {
    const team = p.team, g = teamGroup(team);
    const s = tables[g]?.[team] || {pts:0,gf:0,ga:0};
    let bonus = 0;
    for (const m of matches) {
      if (m.stage === 'GROUP_STAGE') continue;
      if (m.home !== team && m.away !== team) continue;
      if (m.home_goals === null || m.away_goals === null) continue;
      const hg = m.home_goals, ag = m.away_goals;
      if (m.stage === 'FINAL') {
        if ((m.home===team&&hg>ag)||(m.away===team&&ag>hg)) bonus = Math.max(bonus,100);
        else bonus = Math.max(bonus,70);
      } else {
        const won = (m.home===team&&hg>ag)||(m.away===team&&ag>hg);
        if (won) bonus = Math.max(bonus, STAGE_BONUS[m.stage]||0);
      }
    }
    return { name:p.name, team, group:g, gpts:s.pts, bonus, total:s.pts+bonus };
  }).sort((a,b) => b.total-a.total || b.gpts-a.gpts);
}

// ── RENDER: LEADERBOARD ─────────────────────────────────
function renderLeaderboard() {
  const lb = computeLeaderboard();
  const p = pot();
  const played = matches.filter(m => m.status === 'FT').length;
  const live = matches.filter(m => m.status === 'LIVE').length;
  document.getElementById('pot-amount').textContent = fmt(p);

  let html = `<div class="metrics">
    <div class="metric"><div class="metric-label">Prize pot</div><div class="metric-value">${fmt(p)}</div></div>
    <div class="metric"><div class="metric-label">Participants</div><div class="metric-value">${namedCount()}<span style="font-size:14px;color:var(--text-muted)">/48</span></div></div>
    <div class="metric"><div class="metric-label">Matches played</div><div class="metric-value">${played}</div></div>
    <div class="metric"><div class="metric-label">Live now</div><div class="metric-value">${live}</div></div>
  </div>`;

  if (p > 0 && lb.length >= 3) {
    const bgOwner = settings.best_goal_team ? owner(settings.best_goal_team) : null;
    const gbOwner = settings.golden_boot_team ? owner(settings.golden_boot_team) : null;
    const winners = [lb[0]?.name, lb[1]?.name, lb[2]?.name, bgOwner, gbOwner];
    html += '<div class="prize-summary">';
    PRIZE_SPLITS.forEach((sp, i) => {
      html += `<div class="prize-box ${sp.cls}"><div class="picon">${sp.icon}</div><div class="plabel">${sp.label}</div><div class="pamount">${fmt(p*sp.pct)}</div><div class="pwinner">${winners[i]||'TBD'}</div></div>`;
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
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
    const prizeAmt = p>0&&i<3 ? ` · <span class="lb-prize">${fmt(p*PRIZE_SPLITS[i].pct)}</span>` : '';
    const bonusLabel = entry.bonus ? `+${entry.bonus} bonus` : `Grp ${entry.gpts} pts`;
    html += `<div class="lb-row rank-${i+1}">
      <span class="lb-pos">${medal||i+1}</span>
      <span class="lb-name">${escHtml(entry.name)}</span>
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
  if (!matches.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⚽</div>No fixtures loaded yet</div>';
    return;
  }
  const live = matches.filter(m => m.status === 'LIVE');
  const finished = matches.filter(m => m.status === 'FT').slice().reverse().slice(0, 20);
  const upcoming = matches.filter(m => m.status === 'NS').slice(0, 15);
  let html = '';
  if (live.length) { html += '<div class="section-label">Live now</div>'; live.forEach(m => { html += matchCard(m, 'live'); }); }
  if (finished.length) { html += `<div class="section-label" style="margin-top:${live.length?'1.5rem':'0'}">Recent results</div>`; finished.forEach(m => { html += matchCard(m, 'ft'); }); }
  if (upcoming.length) { html += '<div class="section-label" style="margin-top:1.5rem">Upcoming</div>'; upcoming.forEach(m => { html += matchCard(m, 'ns'); }); }
  el.innerHTML = html || '<div class="empty">No match data</div>';
}

function matchCard(m, type) {
  const ho = owner(m.home), ao = owner(m.away);
  const pill = type==='live' ? '<span class="pill pill-live">● Live</span>' :
    type==='ft' ? '<span class="pill pill-ft">FT</span>' :
    '<span class="pill pill-ns">Upcoming</span>';
  const scoreHtml = type === 'ns'
    ? '<span class="match-score vs">vs</span>'
    : `<span class="match-score">${m.home_goals} – ${m.away_goals}</span>`;
  const stageLbl = STAGE_LABELS[m.stage] || m.stage;
  return `<div class="match-card ${type==='live'?'is-live':''}">
    <div class="match-teams">
      <span class="match-team">${escHtml(m.home)}</span>
      ${scoreHtml}
      <span class="match-team away">${escHtml(m.away)}</span>
    </div>
    <div class="match-meta">${pill}<span>${stageLbl}</span><span>${m.match_date} ${m.match_time}</span></div>
    ${(ho||ao) ? `<div class="match-owners"><span>${ho?'👤 '+escHtml(ho):''}</span><span>${ao?'👤 '+escHtml(ao):''}</span></div>` : ''}
  </div>`;
}

// ── RENDER: GROUPS ──────────────────────────────────────
function renderGroups() {
  const tables = computeGroupTables();
  let html = '<div class="groups-grid">';
  for (const [g, teams] of Object.entries(GROUPS)) {
    const sorted = [...teams].sort((a,b) => {
      const ta=tables[g][a],tb=tables[g][b];
      return (tb.pts-ta.pts)||((tb.gf-tb.ga)-(ta.gf-ta.ga))||(tb.gf-ta.gf);
    });
    html += `<div class="group-card"><div class="group-header">GROUP ${g}</div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>Owner</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead>
        <tbody>`;
    sorted.forEach((t, i) => {
      const s = tables[g][t];
      html += `<tr class="${s.p>=2&&i<2?'qualified':''}">
        <td>${t}</td><td>${owner(t)||'—'}</td>
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
  const bgOwner = settings.best_goal_team ? owner(settings.best_goal_team) : null;
  const gbOwner = settings.golden_boot_team ? owner(settings.golden_boot_team) : null;
  const winners = [lb[0]?.name, lb[1]?.name, lb[2]?.name, bgOwner, gbOwner];
  const allTeams = Object.values(GROUPS).flat();
  const teamOpts = allTeams.map(t => `<option value="${t}" ${settings.best_goal_team===t?'selected':''}>${t}${owner(t)?' ('+owner(t)+')':''}</option>`).join('');
  const teamOpts2 = allTeams.map(t => `<option value="${t}" ${settings.golden_boot_team===t?'selected':''}>${t}${owner(t)?' ('+owner(t)+')':''}</option>`).join('');

  let html = `<div class="metrics" style="margin-bottom:20px">
    <div class="metric"><div class="metric-label">Total pot</div><div class="metric-value">${fmt(p)}</div></div>
    <div class="metric"><div class="metric-label">Entry fee</div><div class="metric-value">£5</div></div>
    <div class="metric"><div class="metric-label">Paid in</div><div class="metric-value">${namedCount()}</div></div>
    <div class="metric"><div class="metric-label">Remaining</div><div class="metric-value">${48-namedCount()}</div></div>
  </div>
  <div class="section-label">Prize breakdown</div>
  <div class="card prizes-breakdown">`;
  PRIZE_SPLITS.forEach((sp,i) => {
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
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select the team whose player won each award — their owner gets the prize. Set in Admin.</p>
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
    ${!adminUnlocked?'<p style="font-size:12px;color:var(--text-muted);margin-top:10px">🔒 Unlock Admin tab to change these</p>':''}
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
      <p>Enter the admin password to manage participants and scores.</p>
      <input type="password" class="input-field" id="admin-pw-input" placeholder="Password" onkeydown="if(event.key==='Enter')checkAdminPw()">
      <button class="btn primary" onclick="checkAdminPw()" style="width:100%">Unlock</button>
      <p id="pw-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none">Incorrect password</p>
    </div>`;
    return;
  }

  const nc = namedCount();
  const pct = Math.round((nc/48)*100);

  // Group fixtures for score entry - show by stage
  const groupFixtures = matches.filter(m => m.stage === 'GROUP_STAGE');
  const knockoutFixtures = matches.filter(m => m.stage !== 'GROUP_STAGE');
  const liveOrFt = matches.filter(m => m.status === 'LIVE' || m.status === 'FT').slice().reverse().slice(0,5);

  let html = `<div class="alert info">Logged in as admin. All changes save instantly for everyone viewing the site.</div>

  <!-- PARTICIPANTS -->
  <div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="section-label" style="margin:0">Participants — ${nc}/48</span>
      <span style="font-size:13px;font-weight:600;color:var(--gold-dark)">${fmt(pot())} pot</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="progress-label" style="margin-bottom:12px">${nc} of 48 · ${48-nc} spots left</div>
    <div class="participants-grid" id="participants-grid">`;

  participants.forEach(p => {
    html += `<div class="participant-row ${p.name?'filled':''}" id="prow-${p.slot}">
      <span class="slot-num">${p.slot}</span>
      <input type="text" placeholder="Name…" value="${escHtml(p.name)}" data-slot="${p.slot}" oninput="scheduleNameSave(this)"/>
      <span class="team-name">${p.team}</span>
      <span class="save-indicator" id="save-ind-${p.slot}">✓</span>
    </div>`;
  });

  html += `</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" onclick="refreshAll()">↻ Reload</button>
      <button class="btn danger" onclick="if(confirm('Clear all names?'))clearAllNames()">Clear all names</button>
    </div>
  </div>

  <!-- SCORE ENTRY -->
  <div class="section-label">Enter scores</div>
  <div class="alert info" style="margin-bottom:12px">Today's games are at the top. Set <strong>LIVE</strong> during a match, <strong>FT</strong> when it ends.</div>\`;

  // Sort: LIVE first, then FT most recent (highest id), then NS soonest (lowest id)
  const sortedMatches = [...matches].sort((a, b) => {
    const ord = {LIVE:0, FT:1, NS:2};
    const sa = ord[a.status] ?? 1, sb = ord[b.status] ?? 1;
    if (sa !== sb) return sa - sb;
    if (a.status === 'FT') return b.id - a.id;
    return a.id - b.id;
  });

  // Group by date label
  const byDate = {};
  sortedMatches.forEach(m => {
    const key = m.status === 'LIVE' ? '🔴 Live now' :
                m.status === 'FT'   ? m.match_date :
                'Upcoming — ' + m.match_date;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(m);
  });

  for (const [dateLabel, fixtures] of Object.entries(byDate)) {
    html += `<div class="card" style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.05em">${dateLabel}</div>`;
    fixtures.forEach(m => { html += scoreRow(m); });
    html += '</div>';
  }

  // Add knockout match button
  html += `<div class="section-label" style="margin-top:1rem">Add knockout fixture</div>
  <div class="card">
    <div style="display:grid;grid-template-columns:1fr auto 1fr auto auto;gap:8px;align-items:center;margin-bottom:8px">
      <select id="new-home" class="select-field" style="font-size:13px">
        ${Object.values(GROUPS).flat().map(t=>`<option>${t}</option>`).join('')}
      </select>
      <span style="font-size:13px;color:var(--text-muted);padding:0 4px">vs</span>
      <select id="new-away" class="select-field" style="font-size:13px">
        ${Object.values(GROUPS).flat().map(t=>`<option>${t}</option>`).join('')}
      </select>
      <select id="new-stage" class="select-field" style="font-size:13px">
        <option value="LAST_32">R32</option>
        <option value="LAST_16">R16</option>
        <option value="QUARTER_FINALS">QF</option>
        <option value="SEMI_FINALS">SF</option>
        <option value="THIRD_PLACE">3rd</option>
        <option value="FINAL">Final</option>
      </select>
      <button class="btn gold" onclick="addKnockoutMatch()">+ Add</button>
    </div>
  </div>`;

  el.innerHTML = html;
}

function scoreRow(m) {
  const statusOpts = ['NS','LIVE','FT'].map(s =>
    `<option value="${s}" ${m.status===s?'selected':''}>${s}</option>`
  ).join('');
  const hg = m.home_goals !== null ? m.home_goals : '';
  const ag = m.away_goals !== null ? m.away_goals : '';
  return `<div class="score-row" id="srow-${m.id}" style="display:grid;grid-template-columns:1fr 36px 16px 36px auto auto;gap:6px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:13px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(m.home)} vs ${escHtml(m.away)}</span>
    <input type="number" min="0" max="99" value="${hg}" placeholder="–" data-id="${m.id}" data-side="home"
      oninput="scheduleScoreSave(this)"
      style="border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;font-size:14px;font-weight:700;width:36px">
    <span style="text-align:center;color:var(--text-muted);font-size:12px">–</span>
    <input type="number" min="0" max="99" value="${ag}" placeholder="–" data-id="${m.id}" data-side="away"
      oninput="scheduleScoreSave(this)"
      style="border:1px solid var(--border);border-radius:6px;padding:4px;text-align:center;font-size:14px;font-weight:700;width:36px">
    <select data-id="${m.id}" onchange="saveStatus(this)"
      style="border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:12px;background:var(--surface)">
      ${statusOpts}
    </select>
    <span class="save-indicator" id="score-ind-${m.id}" style="font-size:11px;color:var(--green);opacity:0;transition:opacity 0.3s;min-width:14px">✓</span>
  </div>`;
}

// ── ADMIN ACTIONS ───────────────────────────────────────
function checkAdminPw() {
  if (document.getElementById('admin-pw-input')?.value === ADMIN_PASSWORD) {
    adminUnlocked = true;
    renderAdmin();
  } else {
    const err = document.getElementById('pw-error');
    if (err) err.style.display = 'block';
  }
}

function scheduleNameSave(input) {
  const slot = parseInt(input.dataset.slot);
  const name = input.value.trim();
  const row = document.getElementById(`prow-${slot}`);
  if (row) row.className = `participant-row ${name?'filled':''}`;
  clearTimeout(saveTimers[`n-${slot}`]);
  saveTimers[`n-${slot}`] = setTimeout(() => saveName(slot, name), 600);
}

async function saveName(slot, name) {
  try {
    await sbPatch('participants', {slot}, {name});
    const p = participants.find(p => p.slot === slot);
    if (p) p.name = name;
    flashIndicator(`save-ind-${slot}`);
    document.getElementById('pot-amount').textContent = fmt(pot());
  } catch(e) { console.error('Name save failed:', e); }
}

function scheduleScoreSave(input) {
  const id = parseInt(input.dataset.id);
  clearTimeout(saveTimers[`s-${id}`]);
  saveTimers[`s-${id}`] = setTimeout(() => saveScore(id), 700);
}

async function saveScore(id) {
  const hInput = document.querySelector(`input[data-id="${id}"][data-side="home"]`);
  const aInput = document.querySelector(`input[data-id="${id}"][data-side="away"]`);
  if (!hInput || !aInput) return;
  const hg = hInput.value !== '' ? parseInt(hInput.value) : null;
  const ag = aInput.value !== '' ? parseInt(aInput.value) : null;
  try {
    await sbPatch('matches', {id}, {home_goals: hg, away_goals: ag});
    const m = matches.find(m => m.id === id);
    if (m) { m.home_goals = hg; m.away_goals = ag; }
    flashIndicator(`score-ind-${id}`);
    refreshCurrent();
  } catch(e) { console.error('Score save failed:', e); }
}

async function saveStatus(sel) {
  const id = parseInt(sel.dataset.id);
  const status = sel.value;
  try {
    await sbPatch('matches', {id}, {status});
    const m = matches.find(m => m.id === id);
    if (m) m.status = status;
    flashIndicator(`score-ind-${id}`);
    refreshCurrent();
  } catch(e) { console.error('Status save failed:', e); }
}

async function addKnockoutMatch() {
  const home = document.getElementById('new-home').value;
  const away = document.getElementById('new-away').value;
  const stage = document.getElementById('new-stage').value;
  if (home === away) { alert('Home and away teams must be different'); return; }
  try {
    const result = await sbInsert('matches', {home, away, stage, match_date:'TBC', match_time:'', status:'NS'});
    matches.push(result[0]);
    renderAdmin();
  } catch(e) { console.error('Add match failed:', e); }
}

function flashIndicator(id) {
  const el = document.getElementById(id);
  if (el) { el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 1500); }
}

async function updateSetting(key, value) {
  try {
    await sbPatch('settings', {key}, {value});
    settings[key] = value;
    renderPrizes();
    if (currentTab === 'leaderboard') renderLeaderboard();
  } catch(e) { console.error('Setting save failed:', e); }
}

async function refreshAll() {
  await loadAll();
  refreshCurrent();
}

async function clearAllNames() {
  for (const p of participants) {
    await sbPatch('participants', {slot: p.slot}, {name: ''});
    p.name = '';
  }
  renderAdmin();
}

// ── TAB ROUTING ─────────────────────────────────────────
function showTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
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

// ── STATUS BADGE ─────────────────────────────────────────
function updateStatusBadge() {
  const badge = document.getElementById('api-badge');
  const ft = matches.filter(m => m.status === 'FT').length;
  const live = matches.filter(m => m.status === 'LIVE').length;
  if (live) { badge.textContent = `● ${live} live`; badge.className = 'badge live'; }
  else if (ft) { badge.textContent = `${ft} results`; badge.className = 'badge'; }
  else { badge.textContent = 'No scores yet'; badge.className = 'badge'; }
}

// ── INIT ────────────────────────────────────────────────
document.getElementById('api-badge').textContent = 'Loading...';

async function init() {
  try {
    await loadAll();
    updateStatusBadge();
  } catch(e) {
    document.getElementById('api-badge').textContent = 'DB error';
    document.getElementById('api-badge').className = 'badge err';
    console.error(e);
  }
  renderLeaderboard();
  // Auto-reload data every 30s
  setInterval(async () => {
    try { await loadAll(); updateStatusBadge(); refreshCurrent(); } catch(e) {}
  }, 30000);
}

// Refresh button reloads data
document.querySelector('.refresh-btn').addEventListener('click', async () => {
  document.getElementById('api-badge').textContent = 'Loading...';
  await loadAll();
  updateStatusBadge();
  refreshCurrent();
});

init();
