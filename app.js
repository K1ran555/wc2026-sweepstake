var SUPABASE_URL = 'https://mltuocbtbizessxxuwwc.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdHVvY2J0Yml6ZXNzeHh1d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjEyMTQsImV4cCI6MjA5NjY5NzIxNH0.f-EE8bXiHzRenOTkQm-SIvzlg-ZlDKXX7GUDfEFGaL8';
var ENTRY_FEE = 5;
var ADMIN_PASSWORD = 'wc2026admin';

var GROUPS = {
  A: ['Mexico','South Africa','South Korea','Czechia'],
  B: ['Canada','Switzerland','Qatar','Bosnia & Herz.'],
  C: ['Brazil','Morocco','Haiti','Scotland'],
  D: ['USA','Paraguay','Australia','T\u00fcrkiye'],
  E: ['Germany','Cura\u00e7ao',"C\u00f4te d'Ivoire",'Ecuador'],
  F: ['Netherlands','Japan','Sweden','Tunisia'],
  G: ['Belgium','Egypt','Iran','New Zealand'],
  H: ['Spain','Cape Verde','Saudi Arabia','Uruguay'],
  I: ['France','Senegal','Norway','Iraq'],
  J: ['Argentina','Algeria','Austria','Jordan'],
  K: ['Portugal','DR Congo','Uzbekistan','Colombia'],
  L: ['England','Croatia','Ghana','Panama']
};

var STAGE_BONUS = {GROUP_STAGE:0,LAST_32:10,LAST_16:20,QUARTER_FINALS:35,SEMI_FINALS:50,THIRD_PLACE:35,FINAL:0};
var STAGE_LABELS = {GROUP_STAGE:'Group Stage',LAST_32:'Round of 32',LAST_16:'Round of 16',QUARTER_FINALS:'Quarter-final',SEMI_FINALS:'Semi-final',THIRD_PLACE:'3rd Place',FINAL:'Final'};
var PRIZE_SPLITS = [
  {pct:0.40,label:'1st place',icon:'\ud83e\udd47',cls:'p1'},
  {pct:0.25,label:'2nd place',icon:'\ud83e\udd48',cls:'p2'},
  {pct:0.15,label:'3rd place',icon:'\ud83e\udd49',cls:'p3'},
  {pct:0.065,label:'Best goal',icon:'\u26bd',cls:''},
  {pct:0.065,label:'Golden boot',icon:'\ud83d\udc5f',cls:''},
  {pct:0.07,label:'Worst goal diff',icon:'\ud83d\udfe1',cls:''}
];

var participants = [];
var settings = {best_goal_team:'',golden_boot_team:''};
var matches = [];
var currentTab = 'leaderboard';
var adminUnlocked = false;
var saveTimers = {};
var adminSubTab = 'scores';
var scoreSubTab = 'finished';

var MONTH_MAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
var TOURNAMENT_YEAR = 2026;

// Parses match_date ("11 Jun") + match_time ("20:00", BST/UTC+1) into a Date
// representing the real-world kickoff instant. Returns null if unparseable
// (e.g. knockout fixtures with match_date "TBC").
function parseMatchDateTime(m) {
  if (!m.match_date || !m.match_time) return null;
  var dateParts = m.match_date.trim().split(' ');
  if (dateParts.length !== 2) return null;
  var day = parseInt(dateParts[0], 10);
  var month = MONTH_MAP[dateParts[1]];
  if (isNaN(day) || month === undefined) return null;
  var timeParts = m.match_time.split(':');
  if (timeParts.length !== 2) return null;
  var hour = parseInt(timeParts[0], 10);
  var minute = parseInt(timeParts[1], 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  // match_time is BST (UTC+1) — subtract 1hr to get the true UTC instant
  return new Date(Date.UTC(TOURNAMENT_YEAR, month, day, hour - 1, minute));
}

// Returns 'upcoming', 'live', or 'finished' purely based on the current time
// vs the parsed kickoff time (+ an assumed match duration).
function getMatchPhase(m) {
  var kickoff = parseMatchDateTime(m);
  if (!kickoff) {
    return (m.home_goals !== null && m.away_goals !== null) ? 'finished' : 'upcoming';
  }
  var now = new Date();
  var durationMin = (m.stage === 'GROUP_STAGE') ? 130 : 155; // knockouts allow for ET/pens
  var end = new Date(kickoff.getTime() + durationMin * 60000);
  if (now < kickoff) return 'upcoming';
  if (now < end) return 'live';
  return 'finished';
}

var SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

function sbGet(table, query) {
  query = query || '';
  return fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + query, {headers: SB_HEADERS})
    .then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error(t); });
      return r.json();
    });
}

function sbPatch(table, matchObj, data) {
  var params = Object.keys(matchObj).map(function(k) {
    return k + '=eq.' + encodeURIComponent(matchObj[k]);
  }).join('&');
  return fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + params, {
    method: 'PATCH',
    headers: Object.assign({}, SB_HEADERS, {'Prefer': 'return=minimal'}),
    body: JSON.stringify(data)
  }).then(function(r) {
    if (!r.ok) return r.text().then(function(t) { throw new Error(t); });
  });
}

function sbInsert(table, data) {
  return fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: Object.assign({}, SB_HEADERS, {'Prefer': 'return=representation'}),
    body: JSON.stringify(data)
  }).then(function(r) {
    if (!r.ok) return r.text().then(function(t) { throw new Error(t); });
    return r.json();
  });
}

function loadAll() {
  return Promise.all([
    sbGet('participants', 'select=slot,name,team,team2&order=slot'),
    sbGet('settings', 'select=key,value')
  ]).then(function(results) {
    participants = results[0];
    settings = {};
    results[1].forEach(function(s) { settings[s.key] = s.value; });
    return sbGet('matches', 'select=*&order=id').then(function(m) {
      matches = m;
    }).catch(function() { matches = []; });
  });
}

function teamGroup(t) {
  var keys = Object.keys(GROUPS);
  for (var i = 0; i < keys.length; i++) {
    if (GROUPS[keys[i]].indexOf(t) !== -1) return keys[i];
  }
  return '?';
}

function ownerOfTeam(team) {
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    if (!p.name) continue;
    if (p.team === team || p.team2 === team) return p.name;
  }
  return null;
}

function pot() { return participants.filter(function(p) { return p.name; }).length * ENTRY_FEE; }
function fmt(n) { return '\u00a3' + Math.round(n); }
function namedCount() { return participants.filter(function(p) { return p.name; }).length; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function computeGroupTables() {
  var t = {};
  Object.keys(GROUPS).forEach(function(g) {
    t[g] = {};
    GROUPS[g].forEach(function(tm) { t[g][tm] = {p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}; });
  });
  matches.forEach(function(m) {
    if (m.stage !== 'GROUP_STAGE') return;
    if (m.home_goals === null || m.away_goals === null) return;
    var h = m.home, a = m.away, hg = m.home_goals, ag = m.away_goals;
    var gh = teamGroup(h), ga = teamGroup(a);
    if (t[gh] && t[gh][h]) {
      t[gh][h].p++; t[gh][h].gf+=hg; t[gh][h].ga+=ag;
      if (hg>ag){t[gh][h].w++;t[gh][h].pts+=3;}else if(hg===ag){t[gh][h].d++;t[gh][h].pts++;}else t[gh][h].l++;
    }
    if (t[ga] && t[ga][a]) {
      t[ga][a].p++; t[ga][a].gf+=ag; t[ga][a].ga+=hg;
      if (ag>hg){t[ga][a].w++;t[ga][a].pts+=3;}else if(ag===hg){t[ga][a].d++;t[ga][a].pts++;}else t[ga][a].l++;
    }
  });
  return t;
}

function getTeamScore(team, tables) {
  var g = teamGroup(team);
  var grpPts = (tables[g] && tables[g][team]) ? tables[g][team].pts : 0;
  var gf = (tables[g] && tables[g][team]) ? tables[g][team].gf : 0;
  var ga = (tables[g] && tables[g][team]) ? tables[g][team].ga : 0;
  var bonus = 0;
  var koGf = 0;
  var koGa = 0;
  matches.forEach(function(m) {
    if (m.home !== team && m.away !== team) return;
    if (m.home_goals === null || m.away_goals === null) return;
    var hg = m.home_goals, ag = m.away_goals;
    if (m.stage === 'GROUP_STAGE') return;
    // Track goals in knockout rounds
    koGf += (m.home === team) ? hg : ag;
    koGa += (m.home === team) ? ag : hg;
    if (m.stage === 'FINAL') {
      if ((m.home===team&&hg>ag)||(m.away===team&&ag>hg)) bonus = Math.max(bonus,100);
      else bonus = Math.max(bonus,70);
    } else {
      var won = (m.home===team&&hg>ag)||(m.away===team&&ag>hg);
      if (won) bonus = Math.max(bonus, STAGE_BONUS[m.stage]||0);
    }
  });
  return {grpPts:grpPts, bonus:bonus, total:grpPts+bonus, gf:gf+koGf, ga:ga+koGa};
}

function computeLeaderboard() {
  var tables = computeGroupTables();
  return participants.filter(function(p) { return p.name; }).map(function(p) {
    var s1 = getTeamScore(p.team, tables);
    var s2 = getTeamScore(p.team2, tables);
    return {
      name: p.name,
      team: p.team,
      team2: p.team2,
      t1pts: s1.total,
      t2pts: s2.total,
      total: s1.total + s2.total,
      gf: s1.gf + s2.gf,  // combined goals scored — tiebreaker for top standings
      ga: s1.ga + s2.ga,  // combined goals conceded
      gd: (s1.gf + s2.gf) - (s1.ga + s2.ga)  // combined goal difference
    };
  }).sort(function(a,b) {
    if (b.total !== a.total) return b.total - a.total;
    return b.gf - a.gf;  // tiebreaker: most goals scored
  });
}

// Returns participant with the worst (lowest) combined goal difference.
// Tiebreaker: most goals conceded (higher GA = worse)
function computeWorstGD() {
  var lb = computeLeaderboard();
  if (!lb.length) return null;
  var sorted = lb.slice().sort(function(a, b) {
    if (a.gd !== b.gd) return a.gd - b.gd; // ascending: most negative first
    return b.ga - a.ga; // tiebreak: higher GA is "worse"
  });
  return sorted[0];
}

// ── RENDER: LEADERBOARD ──────────────────────────────────
function renderLeaderboard() {
  var lb = computeLeaderboard();
  var p = pot();
  var played = matches.filter(function(m) { return m.status==='FT'; }).length;
  var live = matches.filter(function(m) { return m.status==='LIVE'; }).length;
  document.getElementById('pot-amount').textContent = fmt(p);

  var html = '<div class="metrics">'
    + '<div class="metric"><div class="metric-label">Prize pot</div><div class="metric-value">' + fmt(p) + '</div></div>'
    + '<div class="metric"><div class="metric-label">Participants</div><div class="metric-value">' + namedCount() + '<span style="font-size:14px;color:var(--text-muted)">/28</span></div></div>'
    + '<div class="metric"><div class="metric-label">Matches played</div><div class="metric-value">' + played + '</div></div>'
    + '<div class="metric"><div class="metric-label">Live now</div><div class="metric-value">' + live + '</div></div>'
    + '</div>';

  if (p > 0 && lb.length >= 3) {
    var bgOwner = settings.best_goal_team ? ownerOfTeam(settings.best_goal_team) : null;
    var gbOwner = settings.golden_boot_team ? ownerOfTeam(settings.golden_boot_team) : null;
    var worstGD = computeWorstGD();
    var worstGDLabel = worstGD ? worstGD.name + ' (' + (worstGD.gd>0?'+':'') + worstGD.gd + ')' : null;
    var winners = [lb[0]&&lb[0].name, lb[1]&&lb[1].name, lb[2]&&lb[2].name, bgOwner, gbOwner, worstGDLabel];
    html += '<div class="prize-summary">';
    PRIZE_SPLITS.forEach(function(sp, i) {
      html += '<div class="prize-box ' + sp.cls + '"><div class="picon">' + sp.icon + '</div>'
        + '<div class="plabel">' + sp.label + '</div>'
        + '<div class="pamount">' + fmt(p*sp.pct) + '</div>'
        + '<div class="pwinner">' + (winners[i]||'TBD') + '</div></div>';
    });
    html += '</div>';
  }

  if (!lb.length) {
    html += '<div class="empty"><div class="empty-icon">\ud83d\udc65</div>No participants yet \u2014 add names in Admin</div>';
    document.getElementById('tab-leaderboard').innerHTML = html;
    return;
  }

  html += '<div class="section-label">Standings</div><div class="card">';
  lb.forEach(function(entry, i) {
    var medal = i===0?'\ud83e\udd47':i===1?'\ud83e\udd48':i===2?'\ud83e\udd49':'';
    var prizeAmt = (p>0&&i<3) ? '<span class="lb-prize">' + fmt(p*PRIZE_SPLITS[i].pct) + '</span>' : '';
    html += '<div class="lb-row rank-' + (i+1) + '">'
      + '<span class="lb-pos">' + (medal||i+1) + '</span>'
      + '<div class="lb-main">'
      + '<div class="lb-top-row">'
      + '<span class="lb-name">' + esc(entry.name) + '</span>'
      + '<span class="lb-pts">' + entry.total + ' pts</span>'
      + '</div>'
      + '<div class="lb-teams-row">'
      + '<span class="lb-team-chip strong" title="' + esc(entry.team) + '">'
      + '<span class="chip-dot green-dot"></span>'
      + esc(entry.team) + '<span class="chip-pts">' + entry.t1pts + '</span></span>'
      + '<span class="lb-plus">+</span>'
      + '<span class="lb-team-chip weak" title="' + esc(entry.team2) + '">'
      + '<span class="chip-dot red-dot"></span>'
      + esc(entry.team2) + '<span class="chip-pts">' + entry.t2pts + '</span></span>'
      + (prizeAmt ? '<span class="lb-prize-inline">' + prizeAmt + '</span>' : '')
      + '</div>'
      + '</div>'
      + '</div>';
  });
  html += '</div>';

  html += '<div class="section-label" style="margin-top:1.5rem">Scoring key</div>'
    + '<div class="card" style="display:grid;grid-template-columns:1fr auto;gap:6px 32px;font-size:13px">'
    + '<span style="color:var(--text-muted)">Each person\u2019s score = Team 1 pts + Team 2 pts</span><span style="font-weight:600;text-align:right">Combined</span>'
    + '<span style="color:var(--text-muted)">Group stage win</span><span style="font-weight:600;text-align:right">+3</span>'
    + '<span style="color:var(--text-muted)">Group stage draw</span><span style="font-weight:600;text-align:right">+1</span>'
    + '<span style="color:var(--text-muted)">Round of 32</span><span style="font-weight:600;text-align:right">+10</span>'
    + '<span style="color:var(--text-muted)">Round of 16</span><span style="font-weight:600;text-align:right">+20</span>'
    + '<span style="color:var(--text-muted)">Quarter-final</span><span style="font-weight:600;text-align:right">+35</span>'
    + '<span style="color:var(--text-muted)">Semi-final</span><span style="font-weight:600;text-align:right">+50</span>'
    + '<span style="color:var(--text-muted)">Runner-up</span><span style="font-weight:600;text-align:right">+70</span>'
    + '<span style="color:var(--text-muted)">Winner \ud83c\udfc6</span><span style="font-weight:600;text-align:right">+100</span>'
    + '</div>';

  document.getElementById('tab-leaderboard').innerHTML = html;
}

// ── RENDER: SCORES ───────────────────────────────────────
function renderScores() {
  var el = document.getElementById('tab-scores');
  if (!matches.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">\u26bd</div>No fixtures loaded yet</div>';
    return;
  }
  var withPhase = matches.map(function(m) { return {m:m, phase:getMatchPhase(m), kickoff:parseMatchDateTime(m)}; });

  var live = withPhase.filter(function(x) { return x.phase==='live'; }).map(function(x) { return x.m; });

  var finished = withPhase.filter(function(x) { return x.phase==='finished'; })
    .sort(function(a,b) {
      var ka = a.kickoff ? a.kickoff.getTime() : 0;
      var kb = b.kickoff ? b.kickoff.getTime() : 0;
      return kb - ka; // most recent first
    }).map(function(x) { return x.m; }).slice(0,20);

  var upcoming = withPhase.filter(function(x) { return x.phase==='upcoming'; })
    .sort(function(a,b) {
      var ka = a.kickoff ? a.kickoff.getTime() : Infinity;
      var kb = b.kickoff ? b.kickoff.getTime() : Infinity;
      return ka - kb; // soonest first
    }).map(function(x) { return x.m; }).slice(0,15);

  var html = '';
  if (live.length) { html += '<div class="section-label">Live now</div>'; live.forEach(function(m) { html += matchCard(m,'live'); }); }
  if (finished.length) { html += '<div class="section-label" style="margin-top:' + (live.length?'1.5rem':'0') + '">Recent results</div>'; finished.forEach(function(m) { html += matchCard(m,'ft'); }); }
  if (upcoming.length) { html += '<div class="section-label" style="margin-top:1.5rem">Upcoming</div>'; upcoming.forEach(function(m) { html += matchCard(m,'ns'); }); }
  el.innerHTML = html || '<div class="empty">No match data</div>';
}

function matchCard(m, type) {
  var ho = ownerOfTeam(m.home), ao = ownerOfTeam(m.away);
  var pill = type==='live' ? '<span class="pill pill-live">\u25cf Live</span>'
    : type==='ft' ? '<span class="pill pill-ft">FT</span>'
    : '<span class="pill pill-ns">Upcoming</span>';
  var scoreHtml = type==='ns'
    ? '<span class="match-score vs">vs</span>'
    : '<span class="match-score">' + m.home_goals + ' \u2013 ' + m.away_goals + '</span>';
  var stageLbl = STAGE_LABELS[m.stage] || m.stage;
  var ownersHtml = (ho||ao) ? '<div class="match-owners"><span>' + (ho?'\ud83d\udc64 '+esc(ho):'') + '</span><span>' + (ao?'\ud83d\udc64 '+esc(ao):'') + '</span></div>' : '';
  return '<div class="match-card ' + (type==='live'?'is-live':'') + '">'
    + '<div class="match-teams"><span class="match-team">' + esc(m.home) + '</span>' + scoreHtml + '<span class="match-team away">' + esc(m.away) + '</span></div>'
    + '<div class="match-meta">' + pill + '<span>' + stageLbl + '</span><span>' + m.match_date + ' ' + m.match_time + '</span></div>'
    + ownersHtml + '</div>';
}

// ── RENDER: GROUPS ───────────────────────────────────────
function renderGroups() {
  var tables = computeGroupTables();
  var html = '<div class="groups-grid">';
  Object.keys(GROUPS).forEach(function(g) {
    var sorted = GROUPS[g].slice().sort(function(a,b) {
      var ta=tables[g][a], tb=tables[g][b];
      return (tb.pts-ta.pts)||((tb.gf-tb.ga)-(ta.gf-ta.ga))||(tb.gf-ta.gf);
    });
    html += '<div class="group-card"><div class="group-header">GROUP ' + g + '</div>'
      + '<table class="group-table"><thead><tr><th>Team</th><th>Owner</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead><tbody>';
    sorted.forEach(function(t, i) {
      var s = tables[g][t];
      html += '<tr class="' + (s.p>=2&&i<2?'qualified':'') + '">'
        + '<td>' + t + '</td><td>' + (ownerOfTeam(t)||'\u2014') + '</td>'
        + '<td>' + s.p + '</td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>'
        + '<td>' + s.gf + '</td><td>' + s.ga + '</td><td class="pts-col">' + s.pts + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });
  html += '</div>';
  document.getElementById('tab-groups').innerHTML = html;
}

// ── RENDER: PRIZES ───────────────────────────────────────
function renderPrizes() {
  var lb = computeLeaderboard();
  var p = pot();
  var bgOwner = settings.best_goal_team ? ownerOfTeam(settings.best_goal_team) : null;
  var gbOwner = settings.golden_boot_team ? ownerOfTeam(settings.golden_boot_team) : null;
  var worstGD = computeWorstGD();
  var worstGDLabel = worstGD ? worstGD.name + ' (' + (worstGD.gd>0?'+':'') + worstGD.gd + ')' : null;
  var winners = [lb[0]&&lb[0].name, lb[1]&&lb[1].name, lb[2]&&lb[2].name, bgOwner, gbOwner, worstGDLabel];
  var allTeams = Object.keys(GROUPS).reduce(function(a,g) { return a.concat(GROUPS[g]); }, []);
  var disabled = adminUnlocked ? '' : 'disabled';

  var teamOpts = allTeams.map(function(t) {
    return '<option value="' + t + '"' + (settings.best_goal_team===t?' selected':'') + '>' + t + (ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'') + '</option>';
  }).join('');
  var teamOpts2 = allTeams.map(function(t) {
    return '<option value="' + t + '"' + (settings.golden_boot_team===t?' selected':'') + '>' + t + (ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'') + '</option>';
  }).join('');

  var html = '<div class="metrics" style="margin-bottom:20px">'
    + '<div class="metric"><div class="metric-label">Total pot</div><div class="metric-value">' + fmt(p) + '</div></div>'
    + '<div class="metric"><div class="metric-label">Entry fee</div><div class="metric-value">\u00a35</div></div>'
    + '<div class="metric"><div class="metric-label">Paid in</div><div class="metric-value">' + namedCount() + '</div></div>'
    + '<div class="metric"><div class="metric-label">Remaining</div><div class="metric-value">' + (28-namedCount()) + '</div></div>'
    + '</div>'
    + '<div class="section-label">Prize breakdown</div><div class="card prizes-breakdown">';

  PRIZE_SPLITS.forEach(function(sp, i) {
    html += '<div class="lb-row">'
      + '<span style="width:28px;text-align:center;font-size:18px;flex-shrink:0">' + sp.icon + '</span>'
      + '<span class="lb-name">' + sp.label + '</span>'
      + '<span class="lb-team">' + Math.round(sp.pct*100) + '%</span>'
      + '<span style="font-size:14px;font-weight:700;flex-shrink:0;min-width:50px;text-align:right">' + fmt(p*sp.pct) + '</span>'
      + '<span style="font-size:13px;color:var(--text-muted);flex-shrink:0;min-width:100px;text-align:right">' + (winners[i]||'TBD') + '</span>'
      + '</div>';
  });

  html += '</div>'
    + '<div class="section-label" style="margin-top:1.5rem">Best goal &amp; golden boot</div>'
    + '<div class="card"><p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select the team whose player won each award.</p>'
    + '<div class="two-col">'
    + '<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\u26bd Best goal \u2014 team</div>'
    + '<select class="select-field" onchange="updateSetting(\'best_goal_team\',this.value)" ' + disabled + '>'
    + '<option value="">\u2014 not yet awarded \u2014</option>' + teamOpts + '</select></div>'
    + '<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\ud83d\udc5f Golden boot \u2014 team</div>'
    + '<select class="select-field" onchange="updateSetting(\'golden_boot_team\',this.value)" ' + disabled + '>'
    + '<option value="">\u2014 not yet awarded \u2014</option>' + teamOpts2 + '</select></div>'
    + '</div>'
    + (!adminUnlocked ? '<p style="font-size:12px;color:var(--text-muted);margin-top:10px">\ud83d\udd12 Unlock Admin to change these</p>' : '')
    + '</div>';

  document.getElementById('tab-prizes').innerHTML = html;
}

// ── SCORE ROW ────────────────────────────────────────────
function scoreRow(m) {
  var hg = m.home_goals !== null ? m.home_goals : '';
  var ag = m.away_goals !== null ? m.away_goals : '';
  var phase = getMatchPhase(m);
  var badge = phase === 'live' ? '<span class="pill pill-live">\u25cf LIVE</span>'
    : phase === 'finished' ? '<span class="pill pill-ft">FT</span>'
    : '<span class="pill pill-ns">Upcoming</span>';
  return '<div class="score-entry-row">'
    + '<span class="score-entry-label">' + esc(m.home) + ' <span style="color:var(--text-muted);font-weight:400">vs</span> ' + esc(m.away) + '</span>'
    + '<input type="number" min="0" max="99" value="' + hg + '" placeholder="-" data-id="' + m.id + '" data-side="home" oninput="scheduleScoreSave(this)" class="score-input">'
    + '<span style="text-align:center;color:var(--text-muted);font-size:13px;font-weight:300">\u2013</span>'
    + '<input type="number" min="0" max="99" value="' + ag + '" placeholder="-" data-id="' + m.id + '" data-side="away" oninput="scheduleScoreSave(this)" class="score-input">'
    + '<span style="text-align:center">' + badge + '</span>'
    + '<span id="score-ind-' + m.id + '" style="font-size:13px;color:var(--green);opacity:0;transition:opacity 0.3s">\u2713</span>'
    + '</div>';
}

// ── RENDER: ADMIN ────────────────────────────────────────
function renderAdmin() {
  var el = document.getElementById('tab-admin');
  if (!adminUnlocked) {
    el.innerHTML = '<div class="admin-lock">'
      + '<div style="font-size:40px;margin-bottom:12px">\ud83d\udd12</div>'
      + '<h2>Admin access</h2>'
      + '<p>Enter the admin password to manage participants and scores.</p>'
      + '<input type="password" class="input-field" id="admin-pw-input" placeholder="Password" onkeydown="if(event.key===\'Enter\')checkAdminPw()">'
      + '<button class="btn primary" onclick="checkAdminPw()" style="width:100%">Unlock</button>'
      + '<p id="pw-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none">Incorrect password</p>'
      + '</div>';
    return;
  }

  var nc = namedCount();

  // Sub-tab bar
  var html = '<div class="alert info" style="margin-bottom:12px">Logged in as admin. Changes save instantly for everyone.</div>'
    + '<div class="admin-subtabs">'
    + '<button class="admin-subtab' + (adminSubTab==='scores'?' active':'') + '" onclick="switchAdminTab(\'scores\')">\u26bd Scores</button>'
    + '<button class="admin-subtab' + (adminSubTab==='participants'?' active':'') + '" onclick="switchAdminTab(\'participants\')">\ud83d\udc65 Participants</button>'
    + '</div>';

  // ── SCORES SUB-TAB ──
  if (adminSubTab === 'scores') {
    // Nested sub-tabs: Finished Games (incl. live) vs Upcoming
    html += '<div class="admin-subtabs" style="margin-bottom:14px">'
      + '<button class="admin-subtab' + (scoreSubTab==='finished'?' active':'') + '" onclick="switchScoreTab(\'finished\')">Finished Games</button>'
      + '<button class="admin-subtab' + (scoreSubTab==='upcoming'?' active':'') + '" onclick="switchScoreTab(\'upcoming\')">Upcoming</button>'
      + '</div>';

    var withPhase = matches.map(function(m) { return {m:m, phase:getMatchPhase(m), kickoff:parseMatchDateTime(m)}; });

    if (scoreSubTab === 'finished') {
      // Games that have commenced (live or finished), latest kickoff first
      var list = withPhase.filter(function(x) { return x.phase==='live' || x.phase==='finished'; })
        .sort(function(a,b) {
          var ka = a.kickoff ? a.kickoff.getTime() : 0;
          var kb = b.kickoff ? b.kickoff.getTime() : 0;
          return kb - ka;
        });
      if (!list.length) {
        html += '<div class="empty"><div class="empty-icon">\u23f3</div>No games have started yet</div>';
      } else {
        var byDate = {}; var dateOrder = [];
        list.forEach(function(x) {
          var key = x.phase==='live' ? '\ud83d\udd34 Live now' : x.m.match_date;
          if (!byDate[key]) { byDate[key] = []; dateOrder.push(key); }
          byDate[key].push(x.m);
        });
        dateOrder.forEach(function(dateLabel) {
          html += '<div class="card" style="margin-bottom:12px"><div class="date-block-header">' + dateLabel + '</div>';
          byDate[dateLabel].forEach(function(m) { html += scoreRow(m); });
          html += '</div>';
        });
      }
    } else {
      // Upcoming — not yet commenced, soonest first
      var list2 = withPhase.filter(function(x) { return x.phase==='upcoming'; })
        .sort(function(a,b) {
          var ka = a.kickoff ? a.kickoff.getTime() : Infinity;
          var kb = b.kickoff ? b.kickoff.getTime() : Infinity;
          return ka - kb;
        });
      if (!list2.length) {
        html += '<div class="empty"><div class="empty-icon">\ud83d\udcc5</div>No upcoming fixtures</div>';
      } else {
        var byDate2 = {}; var dateOrder2 = [];
        list2.forEach(function(x) {
          var key = (x.m.match_date === 'TBC') ? 'To be confirmed' : x.m.match_date;
          if (!byDate2[key]) { byDate2[key] = []; dateOrder2.push(key); }
          byDate2[key].push(x.m);
        });
        dateOrder2.forEach(function(dateLabel) {
          html += '<div class="card" style="margin-bottom:12px"><div class="date-block-header">' + dateLabel + '</div>';
          byDate2[dateLabel].forEach(function(m) { html += scoreRow(m); });
          html += '</div>';
        });
      }
    }

    // Add knockout fixture
    var allTeams = Object.keys(GROUPS).reduce(function(a,g) { return a.concat(GROUPS[g]); }, []);
    html += '<div class="section-label" style="margin-top:1rem">Add knockout fixture</div>'
      + '<div class="card"><div style="display:grid;grid-template-columns:1fr auto 1fr auto auto;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<select id="new-home" class="select-field" style="font-size:13px">'
      + allTeams.map(function(t) { return '<option>' + t + '</option>'; }).join('')
      + '</select><span style="font-size:13px;color:var(--text-muted);padding:0 4px">vs</span>'
      + '<select id="new-away" class="select-field" style="font-size:13px">'
      + allTeams.map(function(t) { return '<option>' + t + '</option>'; }).join('')
      + '</select>'
      + '<select id="new-stage" class="select-field" style="font-size:13px">'
      + '<option value="LAST_32">R32</option><option value="LAST_16">R16</option>'
      + '<option value="QUARTER_FINALS">QF</option><option value="SEMI_FINALS">SF</option>'
      + '<option value="THIRD_PLACE">3rd</option><option value="FINAL">Final</option>'
      + '</select>'
      + '<button class="btn gold" onclick="addKnockoutMatch()">+ Add</button>'
      + '</div></div>';
  }

  // ── PARTICIPANTS SUB-TAB ──
  if (adminSubTab === 'participants') {
    var pct = Math.round((nc/28)*100);
    html += '<div class="card" style="margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<span class="section-label" style="margin:0">Participants \u2014 ' + nc + '/28</span>'
      + '<span style="font-size:13px;font-weight:600;color:var(--gold)">' + fmt(pot()) + ' pot</span>'
      + '</div>'
      + '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="progress-label" style="margin-bottom:12px">' + nc + ' of 28 \u00b7 ' + (28-nc) + ' spots left</div>'
      + '<div class="participants-grid" id="participants-grid">';
    participants.forEach(function(p) {
      html += '<div class="participant-row ' + (p.name?'filled':'') + '" id="prow-' + p.slot + '" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px">'
        + '<div style="display:flex;align-items:center;gap:8px;width:100%">'
        + '<span class="slot-num">' + p.slot + '</span>'
        + '<input type="text" placeholder="Name\u2026" value="' + esc(p.name) + '" data-slot="' + p.slot + '" oninput="scheduleNameSave(this)" style="flex:1;border:none;background:transparent;font-size:13px;color:var(--text);outline:none"/>'
        + '<span class="save-indicator" id="save-ind-' + p.slot + '">\u2713</span>'
        + '</div>'
        + '<div style="display:flex;gap:6px;padding-left:28px;flex-wrap:wrap">'
        + '<span style="font-size:11px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:12px;padding:2px 8px;color:var(--green);font-weight:500">\ud83d\udfe2 ' + esc(p.team) + '</span>'
        + '<span style="font-size:11px;background:var(--red-bg);border:1px solid #5a1a1a;border-radius:12px;padding:2px 8px;color:var(--red);font-weight:500">\ud83d\udd34 ' + esc(p.team2) + '</span>'
        + '</div>'
        + '</div>';
    });
    html += '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">'
      + '<button class="btn" onclick="refreshAll()">\u21bb Reload</button>'
      + '<button class="btn danger" onclick="if(confirm(\'Clear all names?\'))clearAllNames()">Clear all names</button>'
      + '</div>'
      + '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">'
      + '<div class="section-label" style="margin-bottom:8px">Bulk assign names</div>'
      + '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste one name per line (up to 28). Randomly assigned. Existing names overwritten.</p>'
      + '<textarea id="bulk-names" style="width:100%;height:160px;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;font-family:inherit;resize:vertical" placeholder="Alice\nBob\nCharlie\n..."></textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">'
      + '<button class="btn gold" onclick="bulkAssign()">Randomly assign names to slots</button>'
      + '<span id="bulk-status" style="font-size:12px;color:var(--text-muted)"></span>'
      + '</div></div></div>';
  }

  el.innerHTML = html;
}

function switchAdminTab(sub) {
  adminSubTab = sub;
  renderAdmin();
}

function switchScoreTab(sub) {
  scoreSubTab = sub;
  renderAdmin();
}

// ── ADMIN ACTIONS ────────────────────────────────────────
function checkAdminPw() {
  var input = document.getElementById('admin-pw-input');
  if (input && input.value === ADMIN_PASSWORD) {
    adminUnlocked = true;
    renderAdmin();
  } else {
    var err = document.getElementById('pw-error');
    if (err) err.style.display = 'block';
  }
}

function scheduleNameSave(input) {
  var slot = parseInt(input.dataset.slot);
  var name = input.value.trim();
  var row = document.getElementById('prow-' + slot);
  if (row) row.className = 'participant-row ' + (name?'filled':'');
  clearTimeout(saveTimers['n-'+slot]);
  saveTimers['n-'+slot] = setTimeout(function() { saveName(slot, name); }, 600);
}

function saveName(slot, name) {
  sbPatch('participants', {slot:slot}, {name:name}).then(function() {
    var p = participants.find(function(p) { return p.slot===slot; });
    if (p) p.name = name;
    flashIndicator('save-ind-'+slot);
    document.getElementById('pot-amount').textContent = fmt(pot());
  }).catch(function(e) { console.error('Name save failed:', e); });
}

function scheduleScoreSave(input) {
  var id = parseInt(input.dataset.id);
  clearTimeout(saveTimers['s-'+id]);
  saveTimers['s-'+id] = setTimeout(function() { saveScore(id); }, 700);
}

function saveScore(id) {
  var hInput = document.querySelector('input[data-id="'+id+'"][data-side="home"]');
  var aInput = document.querySelector('input[data-id="'+id+'"][data-side="away"]');
  if (!hInput||!aInput) return;
  var hg = hInput.value!=='' ? parseInt(hInput.value) : null;
  var ag = aInput.value!=='' ? parseInt(aInput.value) : null;
  sbPatch('matches', {id:id}, {home_goals:hg, away_goals:ag}).then(function() {
    var m = matches.find(function(m) { return m.id===id; });
    if (m) { m.home_goals=hg; m.away_goals=ag; }
    flashIndicator('score-ind-'+id);
    refreshCurrent();
  }).catch(function(e) { console.error('Score save failed:', e); });
}

function addKnockoutMatch() {
  var home = document.getElementById('new-home').value;
  var away = document.getElementById('new-away').value;
  var stage = document.getElementById('new-stage').value;
  if (home===away) { alert('Home and away teams must be different'); return; }
  sbInsert('matches', {home:home,away:away,stage:stage,match_date:'TBC',match_time:'',status:'NS'})
    .then(function(result) { matches.push(result[0]); renderAdmin(); })
    .catch(function(e) { console.error('Add match failed:', e); });
}

function bulkAssign() {
  var textarea = document.getElementById('bulk-names');
  var statusEl = document.getElementById('bulk-status');
  if (!textarea) return;
  var names = textarea.value.split('\n').map(function(n) { return n.trim(); }).filter(function(n) { return n.length>0; });
  if (!names.length) { if (statusEl) statusEl.textContent = 'No names entered.'; return; }
  if (names.length > 28) { if (statusEl) statusEl.textContent = 'Max 28 names. You entered ' + names.length + '.'; return; }
  var slots = participants.slice();
  for (var i = slots.length-1; i > 0; i--) {
    var j = Math.floor(Math.random()*(i+1));
    var tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
  }
  if (statusEl) statusEl.textContent = 'Saving\u2026';
  var promises = participants.map(function(p, idx) {
    var name = idx < names.length ? names[idx] : '';
    var slot = slots[idx].slot;
    return sbPatch('participants', {slot:slot}, {name:name}).then(function() {
      var orig = participants.find(function(x) { return x.slot===slot; });
      if (orig) orig.name = name;
    });
  });
  Promise.all(promises).then(function() {
    if (statusEl) statusEl.textContent = names.length + ' names assigned \u2713';
    renderAdmin();
  }).catch(function(e) { if (statusEl) statusEl.textContent = 'Error: '+e.message; });
}

function flashIndicator(id) {
  var el = document.getElementById(id);
  if (el) { el.style.opacity='1'; setTimeout(function() { el.style.opacity='0'; }, 1500); }
}

function updateSetting(key, value) {
  sbPatch('settings', {key:key}, {value:value}).then(function() {
    settings[key] = value;
    renderPrizes();
    if (currentTab==='leaderboard') renderLeaderboard();
  }).catch(function(e) { console.error('Setting save failed:', e); });
}

function refreshAll() {
  loadAll().then(function() { refreshCurrent(); });
}

function clearAllNames() {
  var promises = participants.map(function(p) {
    return sbPatch('participants', {slot:p.slot}, {name:''}).then(function() { p.name=''; });
  });
  Promise.all(promises).then(function() { renderAdmin(); });
}

function showTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('tab-'+tab).classList.add('active');
  currentTab = tab;
  refreshCurrent();
}

function refreshCurrent() {
  if (currentTab==='leaderboard') renderLeaderboard();
  else if (currentTab==='scores') renderScores();
  else if (currentTab==='groups') renderGroups();
  else if (currentTab==='prizes') renderPrizes();
  else if (currentTab==='admin') renderAdmin();
}

function updateStatusBadge() {
  var badge = document.getElementById('api-badge');
  var ft = matches.filter(function(m) { return m.status==='FT'; }).length;
  var live = matches.filter(function(m) { return m.status==='LIVE'; }).length;
  if (live) { badge.textContent='\u25cf '+live+' live'; badge.className='badge live'; }
  else if (ft) { badge.textContent=ft+' results'; badge.className='badge'; }
  else { badge.textContent='No scores yet'; badge.className='badge'; }
}

document.getElementById('api-badge').textContent = 'Loading\u2026';

loadAll().then(function() {
  updateStatusBadge();
  renderLeaderboard();
}).catch(function(e) {
  console.error('Init failed:', e);
  document.getElementById('api-badge').textContent = 'DB error';
  document.getElementById('api-badge').className = 'badge err';
  renderLeaderboard();
});

setInterval(function() {
  loadAll().then(function() { updateStatusBadge(); refreshCurrent(); }).catch(function() {});
}, 30000);
