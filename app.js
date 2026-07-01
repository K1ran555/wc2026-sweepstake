// ============================================================
// WC2026 Sweepstake — Clean rebuild
// Tabs: Leaderboard, Scores, Groups, Prizes, Admin
// ============================================================

var SUPABASE_URL = 'https://mltuocbtbizessxxuwwc.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdHVvY2J0Yml6ZXNzeHh1d3djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjEyMTQsImV4cCI6MjA5NjY5NzIxNH0.f-EE8bXiHzRenOTkQm-SIvzlg-ZlDKXX7GUDfEFGaL8';
var ENTRY_FEE = 5;
var ADMIN_PASSWORD = 'wc2026admin';
var TOURNAMENT_YEAR = 2026;
var MONTH_MAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

var GROUPS = {
  A:['Mexico','South Africa','South Korea','Czechia'],
  B:['Canada','Switzerland','Qatar','Bosnia & Herz.'],
  C:['Brazil','Morocco','Haiti','Scotland'],
  D:['USA','Paraguay','Australia','T\u00fcrkiye'],
  E:['Germany','Cura\u00e7ao',"C\u00f4te d'Ivoire",'Ecuador'],
  F:['Netherlands','Japan','Sweden','Tunisia'],
  G:['Belgium','Egypt','Iran','New Zealand'],
  H:['Spain','Cape Verde','Saudi Arabia','Uruguay'],
  I:['France','Senegal','Norway','Iraq'],
  J:['Argentina','Algeria','Austria','Jordan'],
  K:['Portugal','DR Congo','Uzbekistan','Colombia'],
  L:['England','Croatia','Ghana','Panama']
};

var STAGE_BONUS = {GROUP_STAGE:0,LAST_32:10,LAST_16:20,QUARTER_FINALS:35,SEMI_FINALS:50,THIRD_PLACE:35,FINAL:0};

// Map DB stage strings to internal keys for bonus lookup
var STAGE_DB_MAP = {
  'Group Stage':'GROUP_STAGE','GROUP_STAGE':'GROUP_STAGE',
  'Round of 32':'LAST_32','LAST_32':'LAST_32',
  'Last 16':'LAST_16','LAST_16':'LAST_16',
  'Quarter-final':'QUARTER_FINALS','QUARTER_FINALS':'QUARTER_FINALS',
  'Semi-final':'SEMI_FINALS','SEMI_FINALS':'SEMI_FINALS',
  '3rd Place':'THIRD_PLACE','THIRD_PLACE':'THIRD_PLACE',
  'Final':'FINAL','FINAL':'FINAL'
};

var PRIZE_SPLITS = [
  {pct:0.40,label:'1st place',icon:'\ud83e\udd47'},
  {pct:0.25,label:'2nd place',icon:'\ud83e\udd48'},
  {pct:0.15,label:'3rd place',icon:'\ud83e\udd49'},
  {pct:0.065,label:'Golden glove',icon:'\ud83e\udde4'},
  {pct:0.065,label:'Golden boot',icon:'\ud83d\udc5f'},
  {pct:0.07,label:'Worst goal diff',icon:'\ud83d\udfe1'}
];

// ── STATE ─────────────────────────────────────────────────
var participants = [];
var settings = {};
var matches = [];
var currentTab = 'leaderboard';
var adminUnlocked = false;
var adminSubTab = 'scores';
var scoreSubTab = 'upcoming';
var saveTimers = {};
var prevLbOrder = [];
var lastUpdated = null;
var myTeamName = localStorage.getItem('wc26_myname') || '';

var SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

// ── SUPABASE ──────────────────────────────────────────────
function sbGet(table, query){
  return fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+(query||''), {headers:SB_HEADERS})
    .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(t);}); return r.json(); });
}
function sbPatch(table, matchObj, data){
  var params = Object.keys(matchObj).map(function(k){ return k+'=eq.'+encodeURIComponent(matchObj[k]); }).join('&');
  return fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+params, {method:'PATCH', headers:Object.assign({},SB_HEADERS,{'Prefer':'return=minimal'}), body:JSON.stringify(data)})
    .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(t);}); });
}
function sbInsert(table, data){
  return fetch(SUPABASE_URL+'/rest/v1/'+table, {method:'POST', headers:Object.assign({},SB_HEADERS,{'Prefer':'return=representation'}), body:JSON.stringify(data)})
    .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(t);}); return r.json(); });
}

function loadAll(){
  return Promise.all([
    sbGet('participants','select=slot,name,team,team2&order=slot'),
    sbGet('settings','select=key,value')
  ]).then(function(results){
    participants = results[0];
    settings = {};
    results[1].forEach(function(s){ settings[s.key] = s.value; });
    return sbGet('matches','select=*&order=id').then(function(m){ matches = m; }).catch(function(){ matches = []; });
  });
}

// ── TIME ──────────────────────────────────────────────────
function parseMatchDateTime(m){
  if(!m.match_date||!m.match_time) return null;
  var dp = m.match_date.trim().split(' ');
  if(dp.length!==2) return null;
  var day = parseInt(dp[0],10), month = MONTH_MAP[dp[1]];
  if(isNaN(day)||month===undefined) return null;
  var tp = m.match_time.split(':');
  if(tp.length!==2) return null;
  var hour = parseInt(tp[0],10), min = parseInt(tp[1],10);
  if(isNaN(hour)||isNaN(min)) return null;
  return new Date(Date.UTC(TOURNAMENT_YEAR, month, day, hour-1, min));
}
function getMatchPhase(m){
  if(m.home_goals!==null && m.home_goals!==undefined && m.away_goals!==null && m.away_goals!==undefined){
    var ko = parseMatchDateTime(m);
    if(!ko) return 'finished';
    var stageKey = STAGE_DB_MAP[m.stage]||'GROUP_STAGE';
    var durMin = (stageKey==='GROUP_STAGE') ? 130 : 155;
    var end = new Date(ko.getTime() + durMin*60000);
    if(Date.now() < end) return 'live';
    return 'finished';
  }
  var kickoff = parseMatchDateTime(m);
  if(!kickoff) return 'upcoming';
  var now = new Date();
  var stageKey2 = STAGE_DB_MAP[m.stage]||'GROUP_STAGE';
  var dur2 = (stageKey2==='GROUP_STAGE') ? 130 : 155;
  var end2 = new Date(kickoff.getTime() + dur2*60000);
  if(now < kickoff) return 'upcoming';
  if(now < end2) return 'live';
  return 'finished';
}

// ── HELPERS ───────────────────────────────────────────────
function pot(){ return participants.filter(function(p){ return p.name; }).length * ENTRY_FEE; }
function fmt(n){ return '\u00a3' + Math.round(n); }
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function namedCount(){ return participants.filter(function(p){ return p.name; }).length; }
function teamGroup(t){ var keys=Object.keys(GROUPS); for(var i=0;i<keys.length;i++){ if(GROUPS[keys[i]].indexOf(t)!==-1) return keys[i]; } return '?'; }
function ownerOfTeam(team){ for(var i=0;i<participants.length;i++){ var p=participants[i]; if(!p.name) continue; if(p.team===team||p.team2===team) return p.name; } return null; }
function ownersOfTeam(team){ var out=[]; for(var i=0;i<participants.length;i++){ var p=participants[i]; if(!p.name) continue; if(p.team===team||p.team2===team) out.push(p.name); } return out; }
function flashIndicator(id){ var el=document.getElementById(id); if(el){ el.style.opacity='1'; setTimeout(function(){ el.style.opacity='0'; },1500); } }

function showToast(msg, type){
  var ex = document.getElementById('toast-msg'); if(ex) ex.remove();
  var t = document.createElement('div');
  t.id='toast-msg'; t.className='toast toast-'+(type||'error'); t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.classList.add('show'); }, 10);
  setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ if(t.parentNode) t.remove(); },300); }, 3500);
}

// ── SCORING ───────────────────────────────────────────────
function computeGroupTables(){
  var t = {};
  Object.keys(GROUPS).forEach(function(g){
    t[g] = {};
    GROUPS[g].forEach(function(tm){ t[g][tm]={p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}; });
  });
  matches.forEach(function(m){
    var stageKey = STAGE_DB_MAP[m.stage]||m.stage;
    if(stageKey!=='GROUP_STAGE') return;
    if(m.home_goals===null||m.home_goals===undefined||m.away_goals===null||m.away_goals===undefined) return;
    var h=m.home,a=m.away,hg=parseInt(m.home_goals,10),ag=parseInt(m.away_goals,10);
    if(isNaN(hg)||isNaN(ag)) return;
    var gh=teamGroup(h),ga=teamGroup(a);
    if(t[gh]&&t[gh][h]){ t[gh][h].p++; t[gh][h].gf+=hg; t[gh][h].ga+=ag; if(hg>ag){t[gh][h].w++;t[gh][h].pts+=3;}else if(hg===ag){t[gh][h].d++;t[gh][h].pts++;}else t[gh][h].l++; }
    if(t[ga]&&t[ga][a]){ t[ga][a].p++; t[ga][a].gf+=ag; t[ga][a].ga+=hg; if(ag>hg){t[ga][a].w++;t[ga][a].pts+=3;}else if(ag===hg){t[ga][a].d++;t[ga][a].pts++;}else t[ga][a].l++; }
  });
  return t;
}

function getTeamScore(team, tables){
  var g = teamGroup(team);
  var row = (tables[g]&&tables[g][team]) ? tables[g][team] : {pts:0,gf:0,ga:0};
  var bonus=0, koGf=0, koGa=0;
  matches.forEach(function(m){
    if(m.home!==team&&m.away!==team) return;
    if(m.home_goals===null||m.home_goals===undefined||m.away_goals===null||m.away_goals===undefined) return;
    var stageKey = STAGE_DB_MAP[m.stage]||m.stage;
    if(stageKey==='GROUP_STAGE') return;
    var hg=parseInt(m.home_goals,10), ag=parseInt(m.away_goals,10);
    if(isNaN(hg)||isNaN(ag)) return;
    koGf += (m.home===team)?hg:ag;
    koGa += (m.home===team)?ag:hg;
    if(stageKey==='FINAL'){
      var finalWinner = (hg===ag) ? m.penalties_winner : (hg>ag ? m.home : m.away);
      if(finalWinner===team) bonus+=100;
      else bonus+=70;
    } else {
      // Bonus for progressing THROUGH this stage (i.e. winning it)
      // Penalties winner also counts as winning
      var winner = (hg===ag) ? m.penalties_winner : (hg>ag ? m.home : m.away);
      if(winner===team) bonus+=(STAGE_BONUS[stageKey]||0);
    }
  });
  return {grpPts:row.pts,bonus:bonus,total:row.pts+bonus,gf:row.gf+koGf,ga:row.ga+koGa};
}

function computeLeaderboard(){
  var tables = computeGroupTables();
  return participants.filter(function(p){ return p.name; }).map(function(p){
    var s1=getTeamScore(p.team,tables), s2=getTeamScore(p.team2,tables);
    return {name:p.name,team:p.team,team2:p.team2,t1pts:s1.total,t2pts:s2.total,total:s1.total+s2.total,gf:s1.gf+s2.gf,ga:s1.ga+s2.ga,gd:(s1.gf+s2.gf)-(s1.ga+s2.ga)};
  }).sort(function(a,b){ return b.total!==a.total ? b.total-a.total : b.gf-a.gf; });
}

function computeWorstGD(){
  var lb = computeLeaderboard();
  if(!lb.length) return null;
  return lb.slice().sort(function(a,b){ return a.gd!==b.gd ? a.gd-b.gd : b.ga-a.ga; })[0];
}


// ── DETAILED TEAM BREAKDOWN ───────────────────────────────
function getTeamDetailedBreakdown(team, tables){
  var g = teamGroup(team);
  var row = (tables[g]&&tables[g][team]) ? tables[g][team] : {pts:0,gf:0,ga:0,w:0,d:0,l:0};

  // Group matches
  var groupResults = [];
  matches.forEach(function(m){
    if(m.home!==team&&m.away!==team) return;
    var stageKey = STAGE_DB_MAP[m.stage]||m.stage;
    if(stageKey!=='GROUP_STAGE') return;
    if(m.home_goals===null||m.away_goals===null) return;
    var hg=parseInt(m.home_goals,10), ag=parseInt(m.away_goals,10);
    var isHome=m.home===team;
    var scored=isHome?hg:ag, conceded=isHome?ag:hg;
    var opp=isHome?m.away:m.home;
    var result=scored>conceded?'W':scored===conceded?'D':'L';
    var pts=result==='W'?3:result==='D'?1:0;
    groupResults.push({opp:opp,scored:scored,conceded:conceded,result:result,pts:pts});
  });

  // Knockout matches
  var koResults = [];
  var bonus = 0, koGf=0, koGa=0;
  var STAGE_LABEL = {
    'LAST_32':'Round of 32','LAST_16':'Last 16',
    'QUARTER_FINALS':'Quarter-final','SEMI_FINALS':'Semi-final',
    'THIRD_PLACE':'3rd Place','FINAL':'Final'
  };
  matches.forEach(function(m){
    if(m.home!==team&&m.away!==team) return;
    if(m.home_goals===null||m.home_goals===undefined||m.away_goals===null||m.away_goals===undefined) return;
    var stageKey = STAGE_DB_MAP[m.stage]||m.stage;
    if(stageKey==='GROUP_STAGE') return;
    var hg=parseInt(m.home_goals,10), ag=parseInt(m.away_goals,10);
    if(isNaN(hg)||isNaN(ag)) return;
    var isHome=m.home===team;
    var scored=isHome?hg:ag, conceded=isHome?ag:hg;
    var opp=isHome?m.away:m.home;
    koGf+=scored; koGa+=conceded;
    var winner, stageBonus=0, result;
    if(stageKey==='FINAL'){
      winner=(hg===ag)?m.penalties_winner:(hg>ag?m.home:m.away);
      stageBonus=winner===team?100:70;
    } else {
      winner=(hg===ag)?m.penalties_winner:(hg>ag?m.home:m.away);
      stageBonus=winner===team?(STAGE_BONUS[stageKey]||0):0;
    }
    var pens=(hg===ag&&m.penalties_winner)?'('+esc(m.penalties_winner)+' won on pens)':'';
    result=winner===team?'W':'L';
    if(stageBonus) bonus+=stageBonus;
    koResults.push({
      stage:STAGE_LABEL[stageKey]||m.stage,
      opp:opp,scored:scored,conceded:conceded,
      result:result,bonus:stageBonus,pens:pens
    });
  });

  return {
    team:team,group:g,
    grpPts:row.pts,grpGf:row.gf,grpGa:row.ga,
    groupResults:groupResults,
    koResults:koResults,
    bonus:bonus,
    total:row.pts+bonus,
    gf:row.gf+koGf,ga:row.ga+koGa,
    gd:(row.gf+koGf)-(row.ga+koGa)
  };
}

function buildBreakdownHtml(name, tables){
  var p = participants.find(function(x){return x.name===name;});
  if(!p) return '';
  var b1=getTeamDetailedBreakdown(p.team,tables);
  var b2=getTeamDetailedBreakdown(p.team2,tables);

  function teamBlock(b){
    var html='<div class="bd-team-block">';
    html+='<div class="bd-team-header">';
    html+='<span class="bd-team-name">'+esc(b.team)+'</span>';
    html+='<span class="bd-team-group">Group '+b.group+'</span>';
    html+='<span class="bd-team-total">'+b.total+'pts</span>';
    html+='</div>';

    // Group stage results
    if(b.groupResults.length){
      html+='<div class="bd-section-label">Group stage &mdash; '+b.grpPts+'pts &nbsp; GF'+b.grpGf+' GA'+b.grpGa+' GD'+(b.grpGd>=0?'+':'')+( b.grpGf-b.grpGa)+'</div>';
      html+='<div class="bd-matches">';
      b.groupResults.forEach(function(r){
        html+='<div class="bd-match">'
          +'<span class="bd-result bd-result-'+r.result.toLowerCase()+'">'+r.result+'</span>'
          +'<span class="bd-opp">vs '+esc(r.opp)+'</span>'
          +'<span class="bd-score">'+r.scored+'&ndash;'+r.conceded+'</span>'
          +'<span class="bd-pts '+(r.pts>0?'bd-pts-pos':'bd-pts-zero')+'">+'+r.pts+'</span>'
          +'</div>';
      });
      html+='</div>';
    }

    // Knockout results
    if(b.koResults.length){
      html+='<div class="bd-section-label" style="margin-top:8px">Knockout stage</div>';
      html+='<div class="bd-matches">';
      b.koResults.forEach(function(r){
        html+='<div class="bd-match">'
          +'<span class="bd-result bd-result-'+r.result.toLowerCase()+'">'+r.result+'</span>'
          +'<span class="bd-opp"><span style="font-size:10px;color:var(--text-muted)">'+esc(r.stage)+'</span> vs '+esc(r.opp)+'</span>'
          +'<span class="bd-score">'+r.scored+'&ndash;'+r.conceded+(r.pens?' <span style="font-size:10px;color:var(--text-muted)">'+r.pens+'</span>':'')+'</span>'
          +'<span class="bd-pts '+(r.bonus>0?'bd-pts-pos':'bd-pts-zero')+'">+'+(r.bonus||0)+'</span>'
          +'</div>';
      });
      html+='</div>';
    }

    // Team totals
    html+='<div class="bd-team-footer">';
    html+='<span>GF '+b.gf+' &nbsp; GA '+b.ga+' &nbsp; GD '+(b.gd>=0?'+':'')+b.gd+'</span>';
    html+='<span class="bd-total-pts">'+b.total+' pts</span>';
    html+='</div>';
    html+='</div>';
    return html;
  }

  var combined=b1.total+b2.total;
  var combinedGd=b1.gd+b2.gd;
  return '<div class="bd-wrap">'
    +teamBlock(b1)
    +'<div class="bd-divider"></div>'
    +teamBlock(b2)
    +'<div class="bd-combined">'
    +'<span>Combined total</span>'
    +'<span><strong>'+combined+'pts</strong> &nbsp; GD '+(combinedGd>=0?'+':'')+combinedGd+'</span>'
    +'</div>'
    +'</div>';
}

var _lbExpandedName = null;
function toggleLbRow(name){
  if(_lbExpandedName===name){ _lbExpandedName=null; }
  else { _lbExpandedName=name; }
  renderLeaderboard();
}

// ── LEADERBOARD ───────────────────────────────────────────
function renderLeaderboard(){
  var el = document.getElementById('tab-leaderboard');
  if(!el) return;
  var lb = computeLeaderboard();
  var p = pot();
  var played = matches.filter(function(m){ return getMatchPhase(m)==='finished'; }).length;
  var liveNow = matches.filter(function(m){ return getMatchPhase(m)==='live'; }).length;

  // Build movement map
  var moveMap = {};
  if(prevLbOrder.length){
    lb.forEach(function(e,i){
      var prev=prevLbOrder.indexOf(e.name);
      moveMap[e.name] = prev===-1?'new':prev>i?'up':prev<i?'down':'same';
    });
  }
  prevLbOrder = lb.map(function(e){ return e.name; });

  // Metrics
  var html = '<div class="metrics">'
    +'<div class="metric"><div class="metric-label">Prize pot</div><div class="metric-value">'+fmt(p)+'</div></div>'
    +'<div class="metric"><div class="metric-label">Participants</div><div class="metric-value">'+namedCount()+'<span style="font-size:14px;color:var(--text-muted)">/28</span></div></div>'
    +'<div class="metric"><div class="metric-label">Played</div><div class="metric-value">'+played+'</div></div>'
    +'<div class="metric"><div class="metric-label">Live</div><div class="metric-value">'+liveNow+'</div></div>'
    +'</div>';

  // Share + countdown bar
  var next = getNextFixture();
  var cdText = next ? getCountdownText() : '';
  html += '<div class="lb-topbar">'
    +'<button class="btn-whatsapp" onclick="shareWhatsApp()">'
    +'<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.556 4.122 1.528 5.856L.057 23.882l6.188-1.448A11.934 11.934 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.86 0-3.604-.504-5.102-1.382l-.366-.217-3.793.888.904-3.7-.238-.38A9.946 9.946 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>'
    +'Share</button>'
    +(cdText ? '<span class="lb-countdown">\u23f0 '+esc(next.home)+' vs '+esc(next.away)+' in <strong>'+cdText+'</strong></span>' : '')
    +'<span id="last-updated-display" style="font-size:11px;color:var(--text-muted);margin-left:auto">'+getLastUpdatedText()+'</span>'
    +'</div>';

  // Live ticker
  var live = matches.filter(function(m){ return getMatchPhase(m)==='live'; });
  if(live.length){
    html += '<div class="live-ticker">'
      + live.map(function(m){ return '\uD83D\uDD34 LIVE: '+esc(m.home)+' '+m.home_goals+' \u2013 '+m.away_goals+' '+esc(m.away); }).join('&nbsp;&nbsp;\u2022&nbsp;&nbsp;')
      +'</div>';
  }

  // Leaderboard rows
  if(!lb.length){
    html += '<div class="empty"><div class="empty-icon">\uD83C\uDFC6</div>No participants yet</div>';
  } else {
    var tables2 = computeGroupTables();
    var medals=['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
    lb.forEach(function(e,i){
      var mv = moveMap[e.name];
      var mvHtml = mv==='up'?'<span class="mv-up">\u25b2</span>':mv==='down'?'<span class="mv-dn">\u25bc</span>':'<span class="mv-same">&mdash;</span>';
      var pos = i<3 ? medals[i] : (i+1);
      var prizeHtml = (p>0&&i<3) ? '<span class="lb-prize">'+fmt(p*PRIZE_SPLITS[i].pct)+'</span>' : '';
      var gdStr = (e.gd>=0?'+':'')+e.gd;
      var isExpanded = _lbExpandedName===e.name;
      html += '<div class="lb-row'+(i===0?' lb-leader':'')+(isExpanded?' lb-row-open':'')+'" onclick="toggleLbRow(\'' +e.name+ '\')" style="cursor:pointer">'
        +'<span class="lb-pos">'+pos+'</span>'
        +mvHtml
        +'<div class="lb-info">'
        +'<span class="lb-name">'+esc(e.name)+'</span>'
        +'<span class="lb-teams">'+esc(e.team)+' &amp; '+esc(e.team2)+'</span>'
        +'</div>'
        +'<div class="lb-right">'
        +'<span class="lb-pts">'+e.total+'<span class="lb-pts-label">pts</span></span>'
        +'<span class="lb-gd">GD '+gdStr+'</span>'
        +prizeHtml
        +'</div>'
        +'<span class="lb-chevron">'+(isExpanded?'\u25b2':'\u25bc')+'</span>'
        +'</div>';
      if(isExpanded){
        html += '<div class="lb-breakdown">'+buildBreakdownHtml(e.name, tables2)+'</div>';
      }
    });
  }
  el.innerHTML = html;
}

// ── SCORES ────────────────────────────────────────────────
function renderScores(){
  var el = document.getElementById('tab-scores');
  if(!matches.length){ el.innerHTML='<div class="empty"><div class="empty-icon">\u26bd</div>No fixtures loaded</div>'; return; }
  var withPhase = matches.map(function(m){ return {m:m, phase:getMatchPhase(m), kickoff:parseMatchDateTime(m)}; });
  var live = withPhase.filter(function(x){ return x.phase==='live'; }).map(function(x){ return x.m; });
  var finished = withPhase.filter(function(x){ return x.phase==='finished'; })
    .sort(function(a,b){ var ka=a.kickoff?a.kickoff.getTime():0,kb=b.kickoff?b.kickoff.getTime():0; return kb-ka; })
    .map(function(x){ return x.m; }).slice(0,20);
  var upcoming = withPhase.filter(function(x){ return x.phase==='upcoming'; })
    .sort(function(a,b){ var ka=a.kickoff?a.kickoff.getTime():Infinity,kb=b.kickoff?b.kickoff.getTime():Infinity; return ka-kb; })
    .map(function(x){ return x.m; }).slice(0,20);
  var html = '';
  if(live.length){ html+='<div class="section-label">Live now</div>'; live.forEach(function(m){ html+=matchCard(m,'live'); }); }
  if(finished.length){ html+='<div class="section-label"'+(live.length?' style="margin-top:1.5rem"':'')+'>Recent results</div>'; finished.forEach(function(m){ html+=matchCard(m,'ft'); }); }
  if(upcoming.length){ html+='<div class="section-label" style="margin-top:1.5rem">Upcoming</div>'; upcoming.forEach(function(m){ html+=matchCard(m,'ns'); }); }
  el.innerHTML = html || '<div class="empty">No match data</div>';
}

function matchCard(m, type){
  var ho=ownerOfTeam(m.home), ao=ownerOfTeam(m.away);
  var pill = type==='live'?'<span class="pill pill-live">\u25cf Live</span>':type==='ft'?'<span class="pill pill-ft">FT</span>':'<span class="pill pill-ns">Upcoming</span>';
  var isDrawn = type==='ft' && m.home_goals===m.away_goals;
  var penSuffix = (isDrawn && m.penalties_winner) ? ' <span class="pen-result">('+esc(m.penalties_winner)+' won on pens)</span>' : '';
  var scoreHtml = type==='ns' ? '<span class="match-score vs">vs</span>' : '<span class="match-score">'+m.home_goals+' \u2013 '+m.away_goals+'</span>';
  var STAGE_DISPLAY={'GROUP_STAGE':'Group Stage','LAST_32':'Round of 32','LAST_16':'Last 16','QUARTER_FINALS':'Quarter-final','SEMI_FINALS':'Semi-final','THIRD_PLACE':'3rd Place','FINAL':'Final'};
  var stageLbl = STAGE_DISPLAY[m.stage]||m.stage||'';
  var ownersHtml = (ho||ao) ? '<div class="match-owners"><span>'+(ho?'\uD83D\uDC64 '+esc(ho):'')+'</span><span>'+(ao?'\uD83D\uDC64 '+esc(ao):'')+'</span></div>' : '';
  return '<div class="match-card'+(type==='live'?' is-live':'')+'">'
    +'<div class="match-teams"><span class="match-team">'+esc(m.home)+'</span>'+scoreHtml+'<span class="match-team away">'+esc(m.away)+'</span></div>'
    +'<div class="match-meta">'+pill+'<span>'+esc(stageLbl)+'</span><span>'+esc(m.match_date||'')+(m.match_time?' '+esc(m.match_time):'')+'</span></div>'
    +(penSuffix?'<div style="text-align:center;margin-top:4px">'+penSuffix+'</div>':'')
    +ownersHtml
    +'</div>';
}

// ── GROUPS ────────────────────────────────────────────────
function renderGroups(){
  var tables = computeGroupTables();
  var html = '<div class="groups-grid">';
  Object.keys(GROUPS).forEach(function(g){
    var sorted = GROUPS[g].slice().sort(function(a,b){
      var ta=tables[g][a],tb=tables[g][b];
      return (tb.pts-ta.pts)||((tb.gf-tb.ga)-(ta.gf-ta.ga))||(tb.gf-ta.gf);
    });
    var maxPlayed = Math.max.apply(null, sorted.map(function(t){ return tables[g][t].p; }));
    html += '<div class="group-card"><div class="group-header">GROUP '+g+'</div>'
      +'<table class="group-table"><thead><tr><th>Team</th><th>Owner</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead><tbody>';
    sorted.forEach(function(t,i){
      var s=tables[g][t];
      var qualified=maxPlayed>=3&&i<2, eliminated=maxPlayed>=3&&i>=2;
      html += '<tr class="'+(qualified?'qualified':eliminated?'eliminated':'')+'">'
        +'<td>'+esc(t)+'</td><td>'+(ownerOfTeam(t)||'\u2014')+'</td>'
        +'<td>'+s.p+'</td><td>'+s.w+'</td><td>'+s.d+'</td><td>'+s.l+'</td>'
        +'<td>'+s.gf+'</td><td>'+s.ga+'</td><td class="pts-col">'+s.pts+'</td></tr>';
    });
    html += '</tbody></table></div>';
  });
  html += '</div>';
  document.getElementById('tab-groups').innerHTML = html;
}

// ── PRIZES ────────────────────────────────────────────────
function renderPrizes(){
  var lb=computeLeaderboard(), p=pot();
  var bgOwners=settings.golden_glove_team?ownersOfTeam(settings.golden_glove_team):[];
  var gbOwners=settings.golden_boot_team?ownersOfTeam(settings.golden_boot_team):[];
  var bgOwner=bgOwners.length?bgOwners.join(' & '):null;
  var gbOwner=gbOwners.length?gbOwners.join(' & '):null;
  var worstGD=computeWorstGD();
  var worstGDLabel=worstGD?worstGD.name+' ('+(worstGD.gd>=0?'+':'')+worstGD.gd+')':null;
  var winners=[lb[0]&&lb[0].name,lb[1]&&lb[1].name,lb[2]&&lb[2].name,bgOwner,gbOwner,worstGDLabel];
  var allTeams=Object.keys(GROUPS).reduce(function(a,g){return a.concat(GROUPS[g]);}, []);
  var disabled=adminUnlocked?'':'disabled';

  // Tiebreaker helper
  function lbPos(name){ for(var i=0;i<lb.length;i++){if(lb[i].name===name)return i+1;} return 999; }
  function tieNote(owners, prize){
    if(owners.length<2) return '';
    var sorted=owners.slice().sort(function(a,b){return lbPos(a)-lbPos(b);});
    return '\u2020 '+prize+' tie\u2014'+sorted[0]+' wins ('+sorted.map(function(n){return n+' #'+lbPos(n);}).join(', ')+').  ';
  }
  var gloveNote=tieNote(bgOwners,'Golden glove');
  var bootNote=tieNote(gbOwners,'Golden boot');

  var html = '<div class="metrics" style="margin-bottom:20px">'
    +'<div class="metric"><div class="metric-label">Total pot</div><div class="metric-value">'+fmt(p)+'</div></div>'
    +'<div class="metric"><div class="metric-label">Entry fee</div><div class="metric-value">\u00a35</div></div>'
    +'<div class="metric"><div class="metric-label">Paid in</div><div class="metric-value">'+namedCount()+'</div></div>'
    +'</div>'
    +'<div class="section-label">Prize breakdown</div><div class="card prizes-breakdown">';

  PRIZE_SPLITS.forEach(function(sp,i){
    html += '<div class="lb-row">'
      +'<span style="width:28px;text-align:center;font-size:18px;flex-shrink:0">'+sp.icon+'</span>'
      +'<span class="lb-name">'+sp.label+'</span>'
      +'<span class="lb-team">'+Math.round(sp.pct*100)+'%</span>'
      +'<span style="font-size:14px;font-weight:700;flex-shrink:0;min-width:50px;text-align:right">'+fmt(p*sp.pct)+'</span>'
      +'<span style="font-size:13px;color:var(--text-muted);flex-shrink:0;min-width:100px;text-align:right">'+(winners[i]||'TBD')+'</span>'
      +'</div>';
  });

  html += '</div>';
  if(gloveNote||bootNote){
    html += '<p style="font-size:11px;color:var(--text-muted);margin:8px 4px 0;line-height:1.5">'+gloveNote+bootNote+'If two participants share the same country for the golden glove or golden boot, the prize goes to whoever is highest on the leaderboard.</p>';
  }

  var teamOpts=allTeams.map(function(t){return'<option value="'+t+'"'+(settings.golden_glove_team===t?' selected':'')+'>'+t+(ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'')+' </option>';}).join('');
  var teamOpts2=allTeams.map(function(t){return'<option value="'+t+'"'+(settings.golden_boot_team===t?' selected':'')+'>'+t+(ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'')+' </option>';}).join('');

  html += '<div class="section-label" style="margin-top:1.5rem">Golden glove &amp; golden boot</div>'
    +'<div class="card"><p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select the team whose player won each award.</p>'
    +'<div class="two-col">'
    +'<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\u26bd Best goal \u2014 team</div>'
    +'<select class="select-field" onchange="updateSetting(\'golden_glove_team\',this.value)" '+disabled+'>'
    +'<option value="">\u2014 not yet awarded \u2014</option>'+teamOpts+'</select></div>'
    +'<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\uD83D\uDC5F Golden boot \u2014 team</div>'
    +'<select class="select-field" onchange="updateSetting(\'golden_boot_team\',this.value)" '+disabled+'>'
    +'<option value="">\u2014 not yet awarded \u2014</option>'+teamOpts2+'</select></div>'
    +'</div>'
    +(!adminUnlocked?'<p style="font-size:12px;color:var(--text-muted);margin-top:10px">\uD83D\uDD12 Unlock Admin to change these</p>':'')
    +'</div>';

  document.getElementById('tab-prizes').innerHTML = html;
}

// ── ADMIN ─────────────────────────────────────────────────
function scoreRow(m){
  var hg=m.home_goals!==null?m.home_goals:0;
  var ag=m.away_goals!==null?m.away_goals:0;
  var phase=getMatchPhase(m);
  var badge=phase==='live'?'<span class="pill pill-live">\u25cf LIVE</span>':phase==='finished'?'<span class="pill pill-ft">FT</span>':'<span class="pill pill-ns">Soon</span>';
  var stageKey=STAGE_DB_MAP[m.stage]||m.stage;
  var isKnockout=stageKey!=='GROUP_STAGE';
  var isDrawn=phase==='finished'&&hg===ag;
  var penHtml='';
  if(isKnockout&&isDrawn){
    var penWinner=m.penalties_winner||'';
    penHtml='<div class="ser-pens">'
      +'<span class="ser-pens-label">\u26bd Pens winner:</span>'
      +'<select class="select-field" style="width:auto;font-size:12px;padding:5px 8px" onchange="savePenaltiesWinner('+m.id+',this.value)">'
      +'<option value=""'+(penWinner===''?' selected':'')+'>\u2014 select \u2014</option>'
      +'<option value="'+esc(m.home)+'"'+(penWinner===m.home?' selected':'')+'>'+esc(m.home)+'</option>'
      +'<option value="'+esc(m.away)+'"'+(penWinner===m.away?' selected':'')+'>'+esc(m.away)+'</option>'
      +'</select>'
      +'</div>';
  }
  return '<div class="score-entry-row">'
    +'<div class="ser-top">'
    +'<span class="score-entry-label">'+esc(m.home)+'</span>'
    +'<span class="ser-vs">vs</span>'
    +'<span class="score-entry-label">'+esc(m.away)+'</span>'
    +'<span class="ser-badge">'+badge+'</span>'
    +'<span id="score-ind-'+m.id+'" class="ser-tick">\u2713</span>'
    +'</div>'
    +'<div class="ser-bottom">'
    +'<div class="score-stepper"><button class="step-btn" onclick="stepScore('+m.id+',\'home\',-1)">-</button><span class="step-val" id="sv-home-'+m.id+'">'+hg+'</span><button class="step-btn" onclick="stepScore('+m.id+',\'home\',1)">+</button></div>'
    +'<span class="ser-dash">\u2013</span>'
    +'<div class="score-stepper"><button class="step-btn" onclick="stepScore('+m.id+',\'away\',-1)">-</button><span class="step-val" id="sv-away-'+m.id+'">'+ag+'</span><button class="step-btn" onclick="stepScore('+m.id+',\'away\',1)">+</button></div>'
    +'</div>'
    +penHtml
    +'</div>';
}

function renderAdmin(){
  var el=document.getElementById('tab-admin');
  if(!adminUnlocked){
    el.innerHTML='<div class="admin-lock">'
      +'<div style="font-size:40px;margin-bottom:12px">\uD83D\uDD12</div>'
      +'<h2>Admin access</h2>'
      +'<p>Enter the admin password to manage participants and scores.</p>'
      +'<input type="password" class="input-field" id="admin-pw-input" placeholder="Password" onkeydown="if(event.key===\'Enter\')checkAdminPw()">'
      +'<button class="btn primary" onclick="checkAdminPw()" style="width:100%">Unlock</button>'
      +'<p id="pw-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none">Incorrect password</p>'
      +'</div>';
    return;
  }
  var nc=namedCount();
  var html='<div class="alert info" style="margin-bottom:12px">Logged in as admin. Changes save instantly.</div>'
    +'<div class="admin-subtabs">'
    +'<button class="admin-subtab'+(adminSubTab==='scores'?' active':'')+'" onclick="switchAdminTab(\'scores\')">\u26bd Scores</button>'
    +'<button class="admin-subtab'+(adminSubTab==='participants'?' active':'')+'" onclick="switchAdminTab(\'participants\')">\uD83D\uDC65 Participants</button>'
    +'</div>';

  if(adminSubTab==='scores'){
    html+='<div class="admin-subtabs" style="margin-bottom:14px">'
      +'<button class="admin-subtab'+(scoreSubTab==='upcoming'?' active':'')+'" onclick="switchScoreTab(\'upcoming\')">Upcoming</button>'
      +'<button class="admin-subtab'+(scoreSubTab==='finished'?' active':'')+'" onclick="switchScoreTab(\'finished\')">Finished</button>'
      +'</div>';
    var withPhase=matches.map(function(m){return{m:m,phase:getMatchPhase(m),kickoff:parseMatchDateTime(m)};});
    if(scoreSubTab==='finished'){
      var list=withPhase.filter(function(x){return x.phase==='live'||x.phase==='finished';})
        .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():0,kb=b.kickoff?b.kickoff.getTime():0;return kb-ka;});
      if(!list.length){html+='<div class="empty"><div class="empty-icon">\u23f3</div>No games started yet</div>';}
      else{
        var byDate={};var dateOrder=[];
        list.forEach(function(x){var key=x.phase==='live'?'\uD83D\uDD34 Live now':x.m.match_date;if(!byDate[key]){byDate[key]=[];dateOrder.push(key);}byDate[key].push(x.m);});
        dateOrder.forEach(function(dl){html+='<div class="card" style="margin-bottom:12px"><div class="date-block-header">'+dl+'</div>';byDate[dl].forEach(function(m){html+=scoreRow(m);});html+='</div>';});
      }
    } else {
      var list2=withPhase.filter(function(x){return x.phase==='upcoming';})
        .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():Infinity,kb=b.kickoff?b.kickoff.getTime():Infinity;return ka-kb;});
      if(!list2.length){html+='<div class="empty"><div class="empty-icon">\uD83D\uDCC5</div>No upcoming fixtures</div>';}
      else{
        var byDate2={};var dateOrder2=[];
        list2.forEach(function(x){var key=x.m.match_date||'TBC';if(!byDate2[key]){byDate2[key]=[];dateOrder2.push(key);}byDate2[key].push(x.m);});
        dateOrder2.forEach(function(dl){html+='<div class="card" style="margin-bottom:12px"><div class="date-block-header">'+dl+'</div>';byDate2[dl].forEach(function(m){html+=scoreRow(m);});html+='</div>';});
      }
    }
    // Add knockout fixture
    var allTeams=Object.keys(GROUPS).reduce(function(a,g){return a.concat(GROUPS[g]);}, []);
    html+='<div class="section-label" style="margin-top:1rem">Update team name in fixture</div>'
      +'<div class="card"><div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">'
      +'<input id="update-home" class="input-field" placeholder="Home team" style="font-size:13px">'
      +'<input id="update-away" class="input-field" placeholder="Away team" style="font-size:13px">'
      +'<input id="update-match-id" class="input-field" placeholder="Match ID" type="number" style="font-size:13px">'
      +'</div>'
      +'<button class="btn gold" style="margin-top:8px;width:100%" onclick="updateMatchTeams()">Update fixture teams</button></div>';
  }

  if(adminSubTab==='participants'){
    html+='<div class="card" style="margin-bottom:16px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      +'<span class="section-label" style="margin:0">Participants \u2014 '+nc+'/28</span>'
      +'<span style="font-size:13px;font-weight:600;color:var(--gold)">'+fmt(pot())+' pot</span>'
      +'</div>'
      +'<div class="participants-grid" id="participants-grid">';
    participants.forEach(function(p){
      html+='<div class="participant-row '+(p.name?'filled':'')+'" id="prow-'+p.slot+'" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px">'
        +'<div style="display:flex;align-items:center;gap:8px;width:100%">'
        +'<span class="slot-num">'+p.slot+'</span>'
        +'<input type="text" placeholder="Name\u2026" value="'+esc(p.name)+'" data-slot="'+p.slot+'" oninput="scheduleNameSave(this)" style="flex:1;border:none;background:transparent;font-size:13px;color:var(--text);outline:none"/>'
        +'<span class="save-indicator" id="save-ind-'+p.slot+'">\u2713</span>'
        +'</div>'
        +'<div style="display:flex;gap:6px;padding-left:28px;flex-wrap:wrap">'
        +'<span style="font-size:11px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:12px;padding:2px 8px;color:var(--green);font-weight:500">\uD83D\uDFE2 '+esc(p.team)+'</span>'
        +'<span style="font-size:11px;background:var(--red-bg);border:1px solid #5a1a1a;border-radius:12px;padding:2px 8px;color:var(--red);font-weight:500">\uD83D\uDD34 '+esc(p.team2)+'</span>'
        +'</div></div>';
    });
    html+='</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">'
      +'<button class="btn" onclick="refreshAll()">\u21bb Reload</button>'
      +'<button class="btn danger" onclick="if(confirm(\'Clear all names?\'))clearAllNames()">Clear all names</button>'
      +'</div>'
      +'<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">'
      +'<div class="section-label" style="margin-bottom:8px">Bulk assign names</div>'
      +'<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste one name per line (up to 28). Randomly assigned.</p>'
      +'<textarea id="bulk-names" style="width:100%;height:160px;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;font-family:inherit;resize:vertical" placeholder="Alice\nBob\nCharlie\n..."></textarea>'
      +'<div style="display:flex;gap:8px;margin-top:8px;align-items:center">'
      +'<button class="btn gold" onclick="bulkAssign()">Randomly assign names</button>'
      +'<span id="bulk-status" style="font-size:12px;color:var(--text-muted)"></span>'
      +'</div></div></div>';
  }

  el.innerHTML = html;
}

// ── ADMIN ACTIONS ─────────────────────────────────────────
function checkAdminPw(){
  var input=document.getElementById('admin-pw-input');
  if(input&&input.value===ADMIN_PASSWORD){adminUnlocked=true;renderAdmin();}
  else{var err=document.getElementById('pw-error');if(err)err.style.display='block';}
}
function switchAdminTab(sub){adminSubTab=sub;renderAdmin();}
function switchScoreTab(sub){scoreSubTab=sub;renderAdmin();}

function stepScore(id, side, delta){
  var el=document.getElementById('sv-'+side+'-'+id);
  if(!el) return;
  var cur=parseInt(el.textContent)||0;
  var next=Math.max(0,cur+delta);
  el.textContent=next;
  var m=matches.find(function(m){return m.id===id;});
  if(m){ if(side==='home')m.home_goals=next; else m.away_goals=next; }
  clearTimeout(saveTimers['s-'+id]);
  saveTimers['s-'+id]=setTimeout(function(){saveScoreDirect(id);},600);
}

function saveScoreDirect(id){
  var m=matches.find(function(m){return m.id===id;});
  if(!m) return;
  sbPatch('matches',{id:id},{home_goals:m.home_goals,away_goals:m.away_goals})
    .then(function(){
      flashIndicator('score-ind-'+id);
      if(currentTab==='admin') renderAdmin(); else refreshCurrent();
    })
    .catch(function(e){ console.error('Score save failed:',e); });
}

function savePenaltiesWinner(id, team){
  sbPatch('matches',{id:id},{penalties_winner: team||null})
    .then(function(){
      var m=matches.find(function(m){return m.id===id;});
      if(m) m.penalties_winner=team;
      showToast(team?'Penalties winner saved: '+team:'Penalties winner cleared','success');
      refreshCurrent();
    })
    .catch(function(e){ showToast('Error: '+e.message,'error'); });
}

function updateMatchTeams(){
  var id=parseInt(document.getElementById('update-match-id').value);
  var home=document.getElementById('update-home').value.trim();
  var away=document.getElementById('update-away').value.trim();
  if(!id||(!home&&!away)){showToast('Enter match ID and at least one team name','error');return;}
  var data={};
  if(home) data.home=home;
  if(away) data.away=away;
  sbPatch('matches',{id:id},data)
    .then(function(){
      var m=matches.find(function(m){return m.id===id;});
      if(m){if(home)m.home=home;if(away)m.away=away;}
      showToast('Fixture updated!','success');renderAdmin();
    })
    .catch(function(e){showToast('Error: '+e.message,'error');});
}

function scheduleNameSave(input){
  var slot=parseInt(input.dataset.slot);
  var name=input.value.trim();
  var row=document.getElementById('prow-'+slot);
  if(row) row.className='participant-row '+(name?'filled':'');
  clearTimeout(saveTimers['n-'+slot]);
  saveTimers['n-'+slot]=setTimeout(function(){saveName(slot,name);},600);
}
function saveName(slot,name){
  sbPatch('participants',{slot:slot},{name:name}).then(function(){
    var p=participants.find(function(p){return p.slot===slot;});
    if(p)p.name=name;
    flashIndicator('save-ind-'+slot);
    renderLeaderboard();
  }).catch(function(e){console.error('Name save failed:',e);});
}
function bulkAssign(){
  var textarea=document.getElementById('bulk-names');
  var statusEl=document.getElementById('bulk-status');
  if(!textarea) return;
  var names=textarea.value.split('\n').map(function(n){return n.trim();}).filter(function(n){return n.length>0;});
  if(!names.length){if(statusEl)statusEl.textContent='No names entered.';return;}
  if(names.length>28){if(statusEl)statusEl.textContent='Max 28 names.';return;}
  var slots=participants.slice();
  for(var i=slots.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=slots[i];slots[i]=slots[j];slots[j]=tmp;}
  if(statusEl)statusEl.textContent='Saving\u2026';
  var promises=participants.map(function(p,idx){
    var name=idx<names.length?names[idx]:'';
    var slot=slots[idx].slot;
    return sbPatch('participants',{slot:slot},{name:name}).then(function(){var orig=participants.find(function(x){return x.slot===slot;});if(orig)orig.name=name;});
  });
  Promise.all(promises).then(function(){if(statusEl)statusEl.textContent=names.length+' names assigned \u2713';renderAdmin();})
    .catch(function(e){if(statusEl)statusEl.textContent='Error: '+e.message;});
}
function clearAllNames(){
  var promises=participants.map(function(p){return sbPatch('participants',{slot:p.slot},{name:''}).then(function(){p.name='';});});
  Promise.all(promises).then(function(){renderAdmin();});
}

function updateSetting(key,value){
  sbPatch('settings',{key:key},{value:value}).then(function(){
    settings[key]=value;renderPrizes();
  }).catch(function(e){console.error('Setting save failed:',e);});
}
function refreshAll(){loadAll().then(function(){refreshCurrent();});}

// ── NAVIGATION ────────────────────────────────────────────
function showTab(tab, btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active');});
  document.getElementById('tab-'+tab).classList.add('active');
  currentTab=tab; refreshCurrent();
}
function refreshCurrent(){
  if(currentTab==='leaderboard') renderLeaderboard();
  else if(currentTab==='scores') renderScores();
  else if(currentTab==='groups') renderGroups();
  else if(currentTab==='prizes') renderPrizes();
  else if(currentTab==='admin') renderAdmin();
}
function updateStatusBadge(){
  var badge=document.getElementById('api-badge');
  var ft=matches.filter(function(m){return getMatchPhase(m)==='finished';}).length;
  var live=matches.filter(function(m){return getMatchPhase(m)==='live';}).length;
  if(live){badge.textContent='\u25cf '+live+' live';badge.className='badge live';}
  else if(ft){badge.textContent=ft+' results';badge.className='badge';}
  else{badge.textContent='No scores yet';badge.className='badge';}
  var potEl=document.getElementById('pot-amount');if(potEl)potEl.textContent=fmt(pot());
}

// ── COUNTDOWN ─────────────────────────────────────────────
function getNextFixture(){
  var upcoming=matches.filter(function(m){return getMatchPhase(m)==='upcoming';});
  if(!upcoming.length) return null;
  return upcoming.slice().sort(function(a,b){
    var ka=parseMatchDateTime(a),kb=parseMatchDateTime(b);
    if(!ka)return 1; if(!kb)return -1;
    return ka.getTime()-kb.getTime();
  })[0];
}
function getCountdownText(){
  var next=getNextFixture(); if(!next) return '';
  var kickoff=parseMatchDateTime(next); if(!kickoff) return '';
  var diff=kickoff.getTime()-Date.now();
  if(diff<=0) return 'Kick-off now!';
  var h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
  if(h>24){var d=Math.floor(h/24);return d+'d '+(h%24)+'h';}
  if(h>0) return h+'h '+m+'m '+s+'s';
  if(m>0) return m+'m '+s+'s';
  return s+'s';
}
function getLastUpdatedText(){
  if(!lastUpdated) return '';
  var diff=Math.floor((Date.now()-lastUpdated.getTime())/1000);
  if(diff<10) return 'Just updated';
  if(diff<60) return 'Updated '+diff+'s ago';
  var m=Math.floor(diff/60);
  return m<60 ? 'Updated '+m+'m ago' : 'Updated '+Math.floor(m/60)+'h ago';
}

// ── WHATSAPP SHARE ────────────────────────────────────────
function shareWhatsApp(){
  var lb=computeLeaderboard();
  var top3=lb.slice(0,3).map(function(e,i){
    return ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'][i]+' '+e.name+' - '+e.total+' pts ('+e.team+' & '+e.team2+')';
  }).join('\n');
  var msg='\u26bd WC2026 Sweepstake:\n\n'+top3+'\n\nhttps://k1ran555.github.io/wc2026-sweepstake/';
  if(navigator.share){navigator.share({title:'WC2026 Sweepstake',text:msg}).catch(function(){window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');});}
  else window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');
}

// ── SCROLL TO TOP ─────────────────────────────────────────
window.addEventListener('scroll',function(){
  var btn=document.getElementById('scroll-top-btn');
  if(btn){btn.style.opacity=window.scrollY>300?'1':'0';btn.style.pointerEvents=window.scrollY>300?'auto':'none';}
});
function scrollToTop(){window.scrollTo({top:0,behavior:'smooth'});}

// ── INIT ──────────────────────────────────────────────────
document.getElementById('api-badge').textContent='Loading\u2026';
loadAll().then(function(){
  lastUpdated=new Date();
  updateStatusBadge();
  renderLeaderboard();
}).catch(function(e){
  console.error('Init failed:',e);
  document.getElementById('api-badge').textContent='DB error';
  document.getElementById('api-badge').className='badge err';
  renderLeaderboard();
});

setInterval(function(){
  loadAll().then(function(){lastUpdated=new Date();updateStatusBadge();refreshCurrent();}).catch(function(){});
}, 30000);

setInterval(function(){
  var tu=document.getElementById('last-updated-display');
  if(tu) tu.textContent=getLastUpdatedText();
  if(currentTab==='leaderboard'){
    var cd=document.querySelector('.lb-countdown strong');
    if(cd) cd.textContent=getCountdownText();
  }
}, 1000);

// ── WHAT'S NEW POPUP ──────────────────────────────────────
(function(){
  var VERSION='v3.0-simplified';
  var SEEN_KEY='wc26_seen_'+VERSION;
  if(localStorage.getItem(SEEN_KEY)) return;
  function showWhatsNew(){
    var overlay=document.createElement('div');
    overlay.id='whats-new-overlay';
    overlay.innerHTML=[
      '<div id="whats-new-modal">',
        '<div id="whats-new-header"><span style="font-size:22px">\u2728</span><span>What\'s new</span>',
          '<button id="whats-new-close" onclick="document.getElementById(\'whats-new-overlay\').remove();localStorage.setItem(\''+SEEN_KEY+'\',\'1\')">\u2715</button>',
        '</div>',
        '<div id="whats-new-body">',
          '<div class="wn-item"><span class="wn-icon">\uD83E\uDDF9</span><div><strong>Simplified</strong><div class="wn-desc">The app has been streamlined. Predictions, bracket, banter wall and other extras have been removed to keep things fast and clean.</div></div></div>',
          '<div class="wn-item"><span class="wn-icon">\uD83C\uDFC6</span><div><strong>Leaderboard</strong><div class="wn-desc">Rank change arrows, live ticker, next kickoff countdown and WhatsApp share — all still here.</div></div></div>',
          '<div class="wn-item"><span class="wn-icon">\uD83C\uDF0D</span><div><strong>Groups tab</strong><div class="wn-desc">Full group tables with your team owners shown alongside each team.</div></div></div>',
          '<div class="wn-item"><span class="wn-icon">\uD83D\uDCB0</span><div><strong>Prizes</strong><div class="wn-desc">Tiebreaker rules for golden glove and boot still in fine print.</div></div></div>',
        '</div>',
        '<button id="whats-new-btn" onclick="document.getElementById(\'whats-new-overlay\').remove();localStorage.setItem(\''+SEEN_KEY+'\',\'1\')">Got it \uD83D\uDC4A</button>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);
    overlay.addEventListener('click',function(e){if(e.target===overlay){overlay.remove();localStorage.setItem(SEEN_KEY,'1');}});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(showWhatsNew,800);});
  else setTimeout(showWhatsNew,800);
})();
