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
  {pct:0.065,label:'Golden glove',icon:'\ud83e\udde4',cls:''},
  {pct:0.065,label:'Golden boot',icon:'\ud83d\udc5f',cls:''},
  {pct:0.07,label:'Worst goal diff',icon:'\ud83d\udfe1',cls:''}
];

var participants = [];
var settings = {golden_glove_team:'',golden_boot_team:''};
var matches = [];
var currentTab = 'leaderboard';
var adminUnlocked = false;
var saveTimers = {};
var adminSubTab = 'scores';
var scoreSubTab = 'upcoming';
var prevLbOrder = []; // for movement arrows
var myTeamName = localStorage.getItem('wc26_myname') || '';

var MONTH_MAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
var TOURNAMENT_YEAR = 2026;

// ── SUPABASE ────────────────────────────────────────────
var SB_HEADERS = {'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'};

function sbGet(table,query){
  return fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+(query||''),{headers:SB_HEADERS})
    .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t);});return r.json();});
}
function sbPatch(table,matchObj,data){
  var params=Object.keys(matchObj).map(function(k){return k+'=eq.'+encodeURIComponent(matchObj[k]);}).join('&');
  return fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+params,{method:'PATCH',headers:Object.assign({},SB_HEADERS,{'Prefer':'return=minimal'}),body:JSON.stringify(data)})
    .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t);});});
}
function sbInsert(table,data){
  return fetch(SUPABASE_URL+'/rest/v1/'+table,{method:'POST',headers:Object.assign({},SB_HEADERS,{'Prefer':'return=representation'}),body:JSON.stringify(data)})
    .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(t);});return r.json();});
}

function loadAll(){
  return Promise.all([
    sbGet('participants','select=slot,name,team,team2&order=slot'),
    sbGet('settings','select=key,value')
  ]).then(function(results){
    participants=results[0];
    settings={};
    results[1].forEach(function(s){settings[s.key]=s.value;});
    return sbGet('matches','select=*&order=id').then(function(m){matches=m;}).catch(function(){matches=[];});
  });
}

// ── TIME HELPERS ─────────────────────────────────────────
function parseMatchDateTime(m){
  if(!m.match_date||!m.match_time)return null;
  var dp=m.match_date.trim().split(' ');
  if(dp.length!==2)return null;
  var day=parseInt(dp[0],10),month=MONTH_MAP[dp[1]];
  if(isNaN(day)||month===undefined)return null;
  var tp=m.match_time.split(':');
  if(tp.length!==2)return null;
  var hour=parseInt(tp[0],10),min=parseInt(tp[1],10);
  if(isNaN(hour)||isNaN(min))return null;
  return new Date(Date.UTC(TOURNAMENT_YEAR,month,day,hour-1,min));
}

function getMatchPhase(m){
  var kickoff=parseMatchDateTime(m);
  if(!kickoff)return(m.home_goals!==null&&m.away_goals!==null)?'finished':'upcoming';
  var now=new Date();
  var durMin=(m.stage==='GROUP_STAGE')?130:155;
  var end=new Date(kickoff.getTime()+durMin*60000);
  if(now<kickoff)return'upcoming';
  if(now<end)return'live';
  return'finished';
}

// ── HELPERS ──────────────────────────────────────────────
function teamGroup(t){var keys=Object.keys(GROUPS);for(var i=0;i<keys.length;i++){if(GROUPS[keys[i]].indexOf(t)!==-1)return keys[i];}return'?';}
function ownerOfTeam(team){for(var i=0;i<participants.length;i++){var p=participants[i];if(!p.name)continue;if(p.team===team||p.team2===team)return p.name;}return null;}
function pot(){return participants.filter(function(p){return p.name;}).length*ENTRY_FEE;}
function fmt(n){return'\u00a3'+Math.round(n);}
function namedCount(){return participants.filter(function(p){return p.name;}).length;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function computeGroupTables(){
  var t={};
  Object.keys(GROUPS).forEach(function(g){t[g]={};GROUPS[g].forEach(function(tm){t[g][tm]={p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0};});});
  matches.forEach(function(m){
    if(m.stage!=='GROUP_STAGE')return;
    if(m.home_goals===null||m.away_goals===null)return;
    var h=m.home,a=m.away,hg=m.home_goals,ag=m.away_goals;
    var gh=teamGroup(h),ga=teamGroup(a);
    if(t[gh]&&t[gh][h]){t[gh][h].p++;t[gh][h].gf+=hg;t[gh][h].ga+=ag;if(hg>ag){t[gh][h].w++;t[gh][h].pts+=3;}else if(hg===ag){t[gh][h].d++;t[gh][h].pts++;}else t[gh][h].l++;}
    if(t[ga]&&t[ga][a]){t[ga][a].p++;t[ga][a].gf+=ag;t[ga][a].ga+=hg;if(ag>hg){t[ga][a].w++;t[ga][a].pts+=3;}else if(ag===hg){t[ga][a].d++;t[ga][a].pts++;}else t[ga][a].l++;}
  });
  return t;
}

function getTeamScore(team,tables){
  var g=teamGroup(team);
  var grpPts=(tables[g]&&tables[g][team])?tables[g][team].pts:0;
  var gf=(tables[g]&&tables[g][team])?tables[g][team].gf:0;
  var ga=(tables[g]&&tables[g][team])?tables[g][team].ga:0;
  var bonus=0,koGf=0,koGa=0;
  matches.forEach(function(m){
    if(m.home!==team&&m.away!==team)return;
    if(m.home_goals===null||m.away_goals===null)return;
    var hg=m.home_goals,ag=m.away_goals;
    if(m.stage==='GROUP_STAGE')return;
    koGf+=(m.home===team)?hg:ag;
    koGa+=(m.home===team)?ag:hg;
    if(m.stage==='FINAL'){
      if((m.home===team&&hg>ag)||(m.away===team&&ag>hg))bonus=Math.max(bonus,100);
      else bonus=Math.max(bonus,70);
    } else {
      var won=(m.home===team&&hg>ag)||(m.away===team&&ag>hg);
      if(won)bonus=Math.max(bonus,STAGE_BONUS[m.stage]||0);
    }
  });
  return{grpPts:grpPts,bonus:bonus,total:grpPts+bonus,gf:gf+koGf,ga:ga+koGa};
}

function computeLeaderboard(){
  var tables=computeGroupTables();
  return participants.filter(function(p){return p.name;}).map(function(p){
    var s1=getTeamScore(p.team,tables);
    var s2=getTeamScore(p.team2,tables);
    return{name:p.name,team:p.team,team2:p.team2,t1pts:s1.total,t2pts:s2.total,total:s1.total+s2.total,gf:s1.gf+s2.gf,ga:s1.ga+s2.ga,gd:(s1.gf+s2.gf)-(s1.ga+s2.ga)};
  }).sort(function(a,b){if(b.total!==a.total)return b.total-a.total;return b.gf-a.gf;});
}

function computeWorstGD(){
  var lb=computeLeaderboard();
  if(!lb.length)return null;
  return lb.slice().sort(function(a,b){if(a.gd!==b.gd)return a.gd-b.gd;return b.ga-a.ga;})[0];
}

// ── RENDER: LEADERBOARD ──────────────────────────────────
function renderLeaderboard(){
  var lb=computeLeaderboard();
  var p=pot();
  var played=matches.filter(function(m){return getMatchPhase(m)==='finished';}).length;
  var live=matches.filter(function(m){return getMatchPhase(m)==='live';}).length;
  document.getElementById('pot-amount').textContent=fmt(p);

  // Build movement map from previous order
  var moveMap={};
  if(prevLbOrder.length){
    lb.forEach(function(entry,i){
      var prevIdx=prevLbOrder.indexOf(entry.name);
      if(prevIdx===-1)moveMap[entry.name]='new';
      else if(prevIdx>i)moveMap[entry.name]='up';
      else if(prevIdx<i)moveMap[entry.name]='down';
      else moveMap[entry.name]='same';
    });
  }

  var html='<div class="metrics">'
    +'<div class="metric"><div class="metric-label">Prize pot</div><div class="metric-value">'+fmt(p)+'</div></div>'
    +'<div class="metric"><div class="metric-label">Participants</div><div class="metric-value">'+namedCount()+'<span style="font-size:14px;color:var(--text-muted)">/28</span></div></div>'
    +'<div class="metric"><div class="metric-label">Matches played</div><div class="metric-value">'+played+'</div></div>'
    +'<div class="metric"><div class="metric-label">Live now</div><div class="metric-value">'+live+'</div></div>'
    +'</div>';

  // Prize summary
  if(p>0&&lb.length>=3){
    var bgOwner=settings.golden_glove_team?ownerOfTeam(settings.golden_glove_team):null;
    var gbOwner=settings.golden_boot_team?ownerOfTeam(settings.golden_boot_team):null;
    var worstGD=computeWorstGD();
    var worstGDLabel=worstGD?worstGD.name+' ('+(worstGD.gd>0?'+':'')+worstGD.gd+')':null;
    var winners=[lb[0]&&lb[0].name,lb[1]&&lb[1].name,lb[2]&&lb[2].name,bgOwner,gbOwner,worstGDLabel];
    html+='<div class="prize-summary">';
    PRIZE_SPLITS.forEach(function(sp,i){
      html+='<div class="prize-box '+sp.cls+'"><div class="picon">'+sp.icon+'</div>'
        +'<div class="plabel">'+sp.label+'</div>'
        +'<div class="pamount">'+fmt(p*sp.pct)+'</div>'
        +'<div class="pwinner">'+(winners[i]||'TBD')+'</div></div>';
    });
    html+='</div>';
  }

  // "If tournament ended now" mini-table
  if(p>0&&lb.length>=3){
    var bgO=settings.golden_glove_team?ownerOfTeam(settings.golden_glove_team):null;
    var gbO=settings.golden_boot_team?ownerOfTeam(settings.golden_boot_team):null;
    var wGD=computeWorstGD();
    html+='<div class="section-label" style="margin-top:1.5rem">If the tournament ended now</div>'
      +'<div class="card" style="display:grid;grid-template-columns:1fr auto;gap:6px 24px;font-size:13px">';
    var nowWinners=[
      {lbl:'1st \ud83e\udd47',name:lb[0]&&lb[0].name,pct:0.40},
      {lbl:'2nd \ud83e\udd48',name:lb[1]&&lb[1].name,pct:0.25},
      {lbl:'3rd \ud83e\udd49',name:lb[2]&&lb[2].name,pct:0.15},
      {lbl:'Golden glove \ud83e\udde4',name:bgO,pct:0.065},
      {lbl:'Golden boot \ud83d\udc5f',name:gbO,pct:0.065},
      {lbl:'Worst GD \ud83d\udfe1',name:wGD&&wGD.name,pct:0.07}
    ];
    nowWinners.forEach(function(w){
      html+='<span style="color:var(--text-muted)">'+w.lbl+'</span>'
        +'<span style="font-weight:600;text-align:right">'+(w.name||'TBD')+' \u00b7 '+fmt(p*w.pct)+'</span>';
    });
    html+='</div>';
  }

  // My Teams banner
  if(myTeamName){
    var me=lb.find(function(e){return e.name.toLowerCase()===myTeamName.toLowerCase();});
    if(me){
      var myRank=lb.indexOf(me)+1;
      html+='<div class="my-teams-banner">'
        +'<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Your position</div>'
        +'<div style="display:flex;align-items:center;gap:10px">'
        +'<span style="font-size:22px;font-weight:700;color:var(--gold)">#'+myRank+'</span>'
        +'<div>'
        +'<div style="font-size:14px;font-weight:600;color:var(--text)">'+esc(me.name)+'</div>'
        +'<div style="display:flex;gap:6px;margin-top:3px">'
        +'<span class="lb-team-chip strong"><span class="chip-dot green-dot"></span>'+esc(me.team)+' <span class="chip-pts">'+me.t1pts+'</span></span>'
        +'<span class="lb-plus">+</span>'
        +'<span class="lb-team-chip weak"><span class="chip-dot red-dot"></span>'+esc(me.team2)+' <span class="chip-pts">'+me.t2pts+'</span></span>'
        +'</div></div>'
        +'<span style="margin-left:auto;font-size:20px;font-weight:700;color:var(--gold)">'+me.total+' pts</span>'
        +'</div></div>';
    }
  }

  if(!lb.length){
    html+='<div class="empty"><div class="empty-icon">\ud83d\udc65</div>No participants yet \u2014 add names in Admin</div>';
    document.getElementById('tab-leaderboard').innerHTML=html;
    return;
  }

  html+='<div class="section-label">Standings</div><div class="card">';
  lb.forEach(function(entry,i){
    var medal=i===0?'\ud83e\udd47':i===1?'\ud83e\udd48':i===2?'\ud83e\udd49':'';
    var prizeAmt=(p>0&&i<3)?' \u00b7 <span class="lb-prize">'+fmt(p*PRIZE_SPLITS[i].pct)+'</span>':'';
    var move=moveMap[entry.name];
    var arrow=move==='up'?'<span class="move-up">\u25b2</span>':move==='down'?'<span class="move-down">\u25bc</span>':'';
    var isMe=myTeamName&&entry.name.toLowerCase()===myTeamName.toLowerCase();
    html+='<div class="lb-row rank-'+(i+1)+(isMe?' is-me':'')+'">'
      +'<span class="lb-pos">'+(medal||i+1)+'</span>'
      +'<div class="lb-main">'
      +'<div class="lb-top-row">'
      +'<span class="lb-name">'+esc(entry.name)+arrow+'</span>'
      +'<span class="lb-pts">'+entry.total+' pts</span>'
      +'</div>'
      +'<div class="lb-teams-row">'
      +'<span class="lb-team-chip strong"><span class="chip-dot green-dot"></span>'+esc(entry.team)+' <span class="chip-pts">'+entry.t1pts+'</span></span>'
      +'<span class="lb-plus">+</span>'
      +'<span class="lb-team-chip weak"><span class="chip-dot red-dot"></span>'+esc(entry.team2)+' <span class="chip-pts">'+entry.t2pts+'</span></span>'
      +(prizeAmt?'<span class="lb-prize-inline">'+prizeAmt+'</span>':'')
      +'</div></div></div>';
  });
  html+='</div>';

  // My name input
  html+='<div class="card" style="margin-top:16px">'
    +'<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Enter your name to highlight your position</div>'
    +'<div style="display:flex;gap:8px">'
    +'<input type="text" id="my-name-input" placeholder="Your name\u2026" value="'+esc(myTeamName)+'" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:13px;background:var(--surface-2);color:var(--text)">'
    +'<button class="btn gold" onclick="setMyName()">Save</button>'
    +'</div></div>';

  // Scoring key
  html+='<div class="section-label" style="margin-top:1.5rem">Scoring key</div>'
    +'<div class="card" style="display:grid;grid-template-columns:1fr auto;gap:6px 32px;font-size:13px">'
    +'<span style="color:var(--text-muted)">Each person = Team 1 + Team 2 points</span><span style="font-weight:600;text-align:right">Combined</span>'
    +'<span style="color:var(--text-muted)">Group stage win</span><span style="font-weight:600;text-align:right">+3</span>'
    +'<span style="color:var(--text-muted)">Group stage draw</span><span style="font-weight:600;text-align:right">+1</span>'
    +'<span style="color:var(--text-muted)">Round of 32</span><span style="font-weight:600;text-align:right">+10</span>'
    +'<span style="color:var(--text-muted)">Round of 16</span><span style="font-weight:600;text-align:right">+20</span>'
    +'<span style="color:var(--text-muted)">Quarter-final</span><span style="font-weight:600;text-align:right">+35</span>'
    +'<span style="color:var(--text-muted)">Semi-final</span><span style="font-weight:600;text-align:right">+50</span>'
    +'<span style="color:var(--text-muted)">Runner-up</span><span style="font-weight:600;text-align:right">+70</span>'
    +'<span style="color:var(--text-muted)">Winner \ud83c\udfc6</span><span style="font-weight:600;text-align:right">+100</span>'
    +'</div>';

  document.getElementById('tab-leaderboard').innerHTML=html;

  // Update prevLbOrder for next refresh
  prevLbOrder=lb.map(function(e){return e.name;});
}

function setMyName(){
  var input=document.getElementById('my-name-input');
  if(input){myTeamName=input.value.trim();localStorage.setItem('wc26_myname',myTeamName);renderLeaderboard();}
}

// ── RENDER: SCORES ───────────────────────────────────────
function renderScores(){
  var el=document.getElementById('tab-scores');
  if(!matches.length){el.innerHTML='<div class="empty"><div class="empty-icon">\u26bd</div>No fixtures loaded yet</div>';return;}
  var withPhase=matches.map(function(m){return{m:m,phase:getMatchPhase(m),kickoff:parseMatchDateTime(m)};});
  var live=withPhase.filter(function(x){return x.phase==='live';}).map(function(x){return x.m;});
  var finished=withPhase.filter(function(x){return x.phase==='finished';})
    .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():0,kb=b.kickoff?b.kickoff.getTime():0;return kb-ka;})
    .map(function(x){return x.m;}).slice(0,20);
  var upcoming=withPhase.filter(function(x){return x.phase==='upcoming';})
    .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():Infinity,kb=b.kickoff?b.kickoff.getTime():Infinity;return ka-kb;})
    .map(function(x){return x.m;}).slice(0,15);
  var html='';
  if(live.length){html+='<div class="section-label">Live now</div>';live.forEach(function(m){html+=matchCard(m,'live');});}
  if(finished.length){html+='<div class="section-label" style="margin-top:'+(live.length?'1.5rem':'0')+'">Recent results</div>';finished.forEach(function(m){html+=matchCard(m,'ft');});}
  if(upcoming.length){html+='<div class="section-label" style="margin-top:1.5rem">Upcoming</div>';upcoming.forEach(function(m){html+=matchCard(m,'ns');});}
  el.innerHTML=html||'<div class="empty">No match data</div>';
}

function matchCard(m,type){
  var ho=ownerOfTeam(m.home),ao=ownerOfTeam(m.away);
  var pill=type==='live'?'<span class="pill pill-live">\u25cf Live</span>':type==='ft'?'<span class="pill pill-ft">FT</span>':'<span class="pill pill-ns">Upcoming</span>';
  var scoreHtml=type==='ns'?'<span class="match-score vs">vs</span>':'<span class="match-score">'+m.home_goals+' \u2013 '+m.away_goals+'</span>';
  var stageLbl=STAGE_LABELS[m.stage]||m.stage;
  var ownersHtml=(ho||ao)?'<div class="match-owners"><span>'+(ho?'\ud83d\udc64 '+esc(ho):'')+'</span><span>'+(ao?'\ud83d\udc64 '+esc(ao):'')+'</span></div>':'';
  return'<div class="match-card '+(type==='live'?'is-live':'')+'"><div class="match-teams"><span class="match-team">'+esc(m.home)+'</span>'+scoreHtml+'<span class="match-team away">'+esc(m.away)+'</span></div>'
    +'<div class="match-meta">'+pill+'<span>'+stageLbl+'</span><span>'+m.match_date+' '+m.match_time+'</span></div>'+ownersHtml+'</div>';
}

// ── RENDER: GROUPS ───────────────────────────────────────
function renderGroups(){
  var tables=computeGroupTables();
  var allMatchesByTeam={};
  matches.forEach(function(m){
    if(m.stage!=='GROUP_STAGE'||m.home_goals===null)return;
    if(!allMatchesByTeam[m.home])allMatchesByTeam[m.home]=[];
    if(!allMatchesByTeam[m.away])allMatchesByTeam[m.away]=[];
    allMatchesByTeam[m.home].push(m);
    allMatchesByTeam[m.away].push(m);
  });
  var html='<div class="groups-grid">';
  Object.keys(GROUPS).forEach(function(g){
    var sorted=GROUPS[g].slice().sort(function(a,b){
      var ta=tables[g][a],tb=tables[g][b];
      return(tb.pts-ta.pts)||((tb.gf-tb.ga)-(ta.gf-ta.ga))||(tb.gf-ta.gf);
    });
    var maxPlayed=Math.max.apply(null,sorted.map(function(t){return tables[g][t].p;}));
    html+='<div class="group-card"><div class="group-header">GROUP '+g+'</div>'
      +'<table class="group-table"><thead><tr><th>Team</th><th>Owner</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead><tbody>';
    sorted.forEach(function(t,i){
      var s=tables[g][t];
      var qualified=maxPlayed>=3&&i<2;
      var eliminated=maxPlayed>=3&&i>=2;
      var rowCls=qualified?'qualified':eliminated?'eliminated':'';
      html+='<tr class="'+rowCls+'"><td>'+t+'</td><td>'+(ownerOfTeam(t)||'\u2014')+'</td>'
        +'<td>'+s.p+'</td><td>'+s.w+'</td><td>'+s.d+'</td><td>'+s.l+'</td>'
        +'<td>'+s.gf+'</td><td>'+s.ga+'</td><td class="pts-col">'+s.pts+'</td></tr>';
    });
    html+='</tbody></table></div>';
  });
  html+='</div>';
  document.getElementById('tab-groups').innerHTML=html;
}

// ── RENDER: PRIZES ───────────────────────────────────────
function renderPrizes(){
  var lb=computeLeaderboard();
  var p=pot();
  var bgOwner=settings.golden_glove_team?ownerOfTeam(settings.golden_glove_team):null;
  var gbOwner=settings.golden_boot_team?ownerOfTeam(settings.golden_boot_team):null;
  var worstGD=computeWorstGD();
  var worstGDLabel=worstGD?worstGD.name+' ('+(worstGD.gd>0?'+':'')+worstGD.gd+')':null;
  var winners=[lb[0]&&lb[0].name,lb[1]&&lb[1].name,lb[2]&&lb[2].name,bgOwner,gbOwner,worstGDLabel];
  var allTeams=Object.keys(GROUPS).reduce(function(a,g){return a.concat(GROUPS[g]);}, []);
  var disabled=adminUnlocked?'':'disabled';
  var teamOpts=allTeams.map(function(t){return'<option value="'+t+'"'+(settings.golden_glove_team===t?' selected':'')+'>'+t+(ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'')+' </option>';}).join('');
  var teamOpts2=allTeams.map(function(t){return'<option value="'+t+'"'+(settings.golden_boot_team===t?' selected':'')+'>'+t+(ownerOfTeam(t)?' ('+ownerOfTeam(t)+')':'')+' </option>';}).join('');

  var html='<div class="metrics" style="margin-bottom:20px">'
    +'<div class="metric"><div class="metric-label">Total pot</div><div class="metric-value">'+fmt(p)+'</div></div>'
    +'<div class="metric"><div class="metric-label">Entry fee</div><div class="metric-value">\u00a35</div></div>'
    +'<div class="metric"><div class="metric-label">Paid in</div><div class="metric-value">'+namedCount()+'</div></div>'
    +'<div class="metric"><div class="metric-label">Remaining</div><div class="metric-value">'+(28-namedCount())+'</div></div>'
    +'</div>'
    +'<div class="section-label">Prize breakdown</div><div class="card prizes-breakdown">';
  PRIZE_SPLITS.forEach(function(sp,i){
    html+='<div class="lb-row">'
      +'<span style="width:28px;text-align:center;font-size:18px;flex-shrink:0">'+sp.icon+'</span>'
      +'<span class="lb-name">'+sp.label+'</span>'
      +'<span class="lb-team">'+Math.round(sp.pct*100)+'%</span>'
      +'<span style="font-size:14px;font-weight:700;flex-shrink:0;min-width:50px;text-align:right">'+fmt(p*sp.pct)+'</span>'
      +'<span style="font-size:13px;color:var(--text-muted);flex-shrink:0;min-width:100px;text-align:right">'+(winners[i]||'TBD')+'</span>'
      +'</div>';
  });
  html+='</div>'
    +'<div class="section-label" style="margin-top:1.5rem">Golden glove &amp; golden boot</div>'
    +'<div class="card"><p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Select the team whose player won each award.</p>'
    +'<div class="two-col">'
    +'<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\u26bd Best goal \u2014 team</div>'
    +'<select class="select-field" onchange="updateSetting(\'golden_glove_team\',this.value)" '+disabled+'>'
    +'<option value="">\u2014 not yet awarded \u2014</option>'+teamOpts+'</select></div>'
    +'<div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">\ud83d\udc5f Golden boot \u2014 team</div>'
    +'<select class="select-field" onchange="updateSetting(\'golden_boot_team\',this.value)" '+disabled+'>'
    +'<option value="">\u2014 not yet awarded \u2014</option>'+teamOpts2+'</select></div>'
    +'</div>'
    +(!adminUnlocked?'<p style="font-size:12px;color:var(--text-muted);margin-top:10px">\ud83d\udd12 Unlock Admin to change these</p>':'')
    +'</div>';
  document.getElementById('tab-prizes').innerHTML=html;
}

// ── SCORE ROW ────────────────────────────────────────────
function scoreRow(m){
  var hg=m.home_goals!==null?m.home_goals:0;
  var ag=m.away_goals!==null?m.away_goals:0;
  var phase=getMatchPhase(m);
  var badge=phase==='live'?'<span class="pill pill-live">\u25cf LIVE</span>':phase==='finished'?'<span class="pill pill-ft">FT</span>':'<span class="pill pill-ns">Soon</span>';
  return'<div class="score-entry-row">'
    +'<div class="ser-top">'
    +'<span class="score-entry-label">'+esc(m.home)+'</span>'
    +'<span class="ser-vs">vs</span>'
    +'<span class="score-entry-label">'+esc(m.away)+'</span>'
    +'<span class="ser-badge">'+badge+'</span>'
    +'<span id="score-ind-'+m.id+'" class="ser-tick">\u2713</span>'
    +'</div>'
    +'<div class="ser-bottom">'
    +'<div class="score-stepper">'
    +'<button class="step-btn" onclick="stepScore('+m.id+',\'home\',-1)">-</button>'
    +'<span class="step-val" id="sv-home-'+m.id+'">'+hg+'</span>'
    +'<button class="step-btn" onclick="stepScore('+m.id+',\'home\',1)">+</button>'
    +'</div>'
    +'<span class="ser-dash">\u2013</span>'
    +'<div class="score-stepper">'
    +'<button class="step-btn" onclick="stepScore('+m.id+',\'away\',-1)">-</button>'
    +'<span class="step-val" id="sv-away-'+m.id+'">'+ag+'</span>'
    +'<button class="step-btn" onclick="stepScore('+m.id+',\'away\',1)">+</button>'
    +'</div>'
    +'</div>'
    +'</div>';
}

function stepScore(id,side,delta){
  var el=document.getElementById('sv-'+side+'-'+id);
  if(!el)return;
  var cur=parseInt(el.textContent)||0;
  var next=Math.max(0,cur+delta);
  el.textContent=next;
  // Update local match state immediately
  var m=matches.find(function(m){return m.id===id;});
  if(m){
    if(side==='home')m.home_goals=next;
    else m.away_goals=next;
  }
  // Debounce save
  clearTimeout(saveTimers['s-'+id]);
  saveTimers['s-'+id]=setTimeout(function(){saveScoreDirect(id);},600);
}

function saveScoreDirect(id){
  var m=matches.find(function(m){return m.id===id;});
  if(!m)return;
  sbPatch('matches',{id:id},{home_goals:m.home_goals,away_goals:m.away_goals}).then(function(){
    flashIndicator('score-ind-'+id);
    refreshCurrent();
  }).catch(function(e){console.error('Score save failed:',e);});
}

// ── RENDER: ADMIN ────────────────────────────────────────
function renderAdmin(){
  var el=document.getElementById('tab-admin');
  if(!adminUnlocked){
    el.innerHTML='<div class="admin-lock">'
      +'<div style="font-size:40px;margin-bottom:12px">\ud83d\udd12</div>'
      +'<h2>Admin access</h2>'
      +'<p>Enter the admin password to manage participants and scores.</p>'
      +'<input type="password" class="input-field" id="admin-pw-input" placeholder="Password" onkeydown="if(event.key===\'Enter\')checkAdminPw()">'
      +'<button class="btn primary" onclick="checkAdminPw()" style="width:100%">Unlock</button>'
      +'<p id="pw-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none">Incorrect password</p>'
      +'</div>';
    return;
  }
  var nc=namedCount();
  var html='<div class="alert info" style="margin-bottom:12px">Logged in as admin. Changes save instantly for everyone.</div>'
    +'<div class="admin-subtabs">'
    +'<button class="admin-subtab'+(adminSubTab==='scores'?' active':'')+'" onclick="switchAdminTab(\'scores\')">\u26bd Scores</button>'
    +'<button class="admin-subtab'+(adminSubTab==='participants'?' active':'')+'" onclick="switchAdminTab(\'participants\')">\ud83d\udc65 Participants</button>'
    +'</div>';

  // ── SCORES SUB-TAB ──
  if(adminSubTab==='scores'){
    html+='<div class="admin-subtabs" style="margin-bottom:14px">'
      +'<button class="admin-subtab'+(scoreSubTab==='upcoming'?' active':'')+'" onclick="switchScoreTab(\'upcoming\')">Upcoming</button>'
      +'<button class="admin-subtab'+(scoreSubTab==='finished'?' active':'')+'" onclick="switchScoreTab(\'finished\')">Finished Games</button>'
      +'</div>';
    var withPhase=matches.map(function(m){return{m:m,phase:getMatchPhase(m),kickoff:parseMatchDateTime(m)};});
    if(scoreSubTab==='finished'){
      var list=withPhase.filter(function(x){return x.phase==='live'||x.phase==='finished';})
        .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():0,kb=b.kickoff?b.kickoff.getTime():0;return kb-ka;});
      if(!list.length){html+='<div class="empty"><div class="empty-icon">\u23f3</div>No games have started yet</div>';}
      else{
        var byDate={};var dateOrder=[];
        list.forEach(function(x){var key=x.phase==='live'?'\ud83d\udd34 Live now':x.m.match_date;if(!byDate[key]){byDate[key]=[];dateOrder.push(key);}byDate[key].push(x.m);});
        dateOrder.forEach(function(dl){html+='<div class="card" style="margin-bottom:12px"><div class="date-block-header">'+dl+'</div>';byDate[dl].forEach(function(m){html+=scoreRow(m);});html+='</div>';});
      }
    } else {
      var list2=withPhase.filter(function(x){return x.phase==='upcoming';})
        .sort(function(a,b){var ka=a.kickoff?a.kickoff.getTime():Infinity,kb=b.kickoff?b.kickoff.getTime():Infinity;return ka-kb;});
      if(!list2.length){html+='<div class="empty"><div class="empty-icon">\ud83d\udcc5</div>No upcoming fixtures</div>';}
      else{
        var byDate2={};var dateOrder2=[];
        list2.forEach(function(x){var key=(x.m.match_date==='TBC')?'To be confirmed':x.m.match_date;if(!byDate2[key]){byDate2[key]=[];dateOrder2.push(key);}byDate2[key].push(x.m);});
        dateOrder2.forEach(function(dl){html+='<div class="card" style="margin-bottom:12px"><div class="date-block-header">'+dl+'</div>';byDate2[dl].forEach(function(m){html+=scoreRow(m);});html+='</div>';});
      }
    }
    var allTeams=Object.keys(GROUPS).reduce(function(a,g){return a.concat(GROUPS[g]);}, []);
    html+='<div class="section-label" style="margin-top:1rem">Add knockout fixture</div>'
      +'<div class="card"><div style="display:grid;grid-template-columns:1fr auto 1fr auto auto;gap:8px;align-items:center;flex-wrap:wrap">'
      +'<select id="new-home" class="select-field" style="font-size:13px">'+allTeams.map(function(t){return'<option>'+t+'</option>';}).join('')+'</select>'
      +'<span style="font-size:13px;color:var(--text-muted);padding:0 4px">vs</span>'
      +'<select id="new-away" class="select-field" style="font-size:13px">'+allTeams.map(function(t){return'<option>'+t+'</option>';}).join('')+'</select>'
      +'<select id="new-stage" class="select-field" style="font-size:13px">'
      +'<option value="LAST_32">R32</option><option value="LAST_16">R16</option>'
      +'<option value="QUARTER_FINALS">QF</option><option value="SEMI_FINALS">SF</option>'
      +'<option value="THIRD_PLACE">3rd</option><option value="FINAL">Final</option>'
      +'</select>'
      +'<button class="btn gold" onclick="addKnockoutMatch()">+ Add</button>'
      +'</div></div>';
  }

  // ── PARTICIPANTS SUB-TAB ──
  if(adminSubTab==='participants'){
    var pct=Math.round((nc/28)*100);
    html+='<div class="card" style="margin-bottom:16px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      +'<span class="section-label" style="margin:0">Participants \u2014 '+nc+'/28</span>'
      +'<span style="font-size:13px;font-weight:600;color:var(--gold)">'+fmt(pot())+' pot</span>'
      +'</div>'
      +'<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>'
      +'<div class="progress-label" style="margin-bottom:12px">'+nc+' of 28 \u00b7 '+(28-nc)+' spots left</div>'
      +'<div class="participants-grid" id="participants-grid">';
    participants.forEach(function(p){
      html+='<div class="participant-row '+(p.name?'filled':'')+'" id="prow-'+p.slot+'" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px">'
        +'<div style="display:flex;align-items:center;gap:8px;width:100%">'
        +'<span class="slot-num">'+p.slot+'</span>'
        +'<input type="text" placeholder="Name\u2026" value="'+esc(p.name)+'" data-slot="'+p.slot+'" oninput="scheduleNameSave(this)" style="flex:1;border:none;background:transparent;font-size:13px;color:var(--text);outline:none"/>'
        +'<span class="save-indicator" id="save-ind-'+p.slot+'">\u2713</span>'
        +'</div>'
        +'<div style="display:flex;gap:6px;padding-left:28px;flex-wrap:wrap">'
        +'<span style="font-size:11px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:12px;padding:2px 8px;color:var(--green);font-weight:500">\ud83d\udfe2 '+esc(p.team)+'</span>'
        +'<span style="font-size:11px;background:var(--red-bg);border:1px solid #5a1a1a;border-radius:12px;padding:2px 8px;color:var(--red);font-weight:500">\ud83d\udd34 '+esc(p.team2)+'</span>'
        +'</div></div>';
    });
    html+='</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">'
      +'<button class="btn" onclick="refreshAll()">\u21bb Reload</button>'
      +'<button class="btn danger" onclick="if(confirm(\'Clear all names?\'))clearAllNames()">Clear all names</button>'
      +'</div>'
      +'<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">'
      +'<div class="section-label" style="margin-bottom:8px">Bulk assign names</div>'
      +'<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Paste one name per line (up to 28). Randomly assigned. Existing names overwritten.</p>'
      +'<textarea id="bulk-names" style="width:100%;height:160px;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px;font-family:inherit;resize:vertical" placeholder="Alice\nBob\nCharlie\n..."></textarea>'
      +'<div style="display:flex;gap:8px;margin-top:8px;align-items:center">'
      +'<button class="btn gold" onclick="bulkAssign()">Randomly assign names to slots</button>'
      +'<span id="bulk-status" style="font-size:12px;color:var(--text-muted)"></span>'
      +'</div></div></div>';
  }
  el.innerHTML=html;
}

// ── ADMIN ACTIONS ────────────────────────────────────────
function checkAdminPw(){
  var input=document.getElementById('admin-pw-input');
  if(input&&input.value===ADMIN_PASSWORD){adminUnlocked=true;renderAdmin();}
  else{var err=document.getElementById('pw-error');if(err)err.style.display='block';}
}
function switchAdminTab(sub){adminSubTab=sub;renderAdmin();}
function switchScoreTab(sub){scoreSubTab=sub;renderAdmin();}

function scheduleNameSave(input){
  var slot=parseInt(input.dataset.slot);
  var name=input.value.trim();
  var row=document.getElementById('prow-'+slot);
  if(row)row.className='participant-row '+(name?'filled':'');
  clearTimeout(saveTimers['n-'+slot]);
  saveTimers['n-'+slot]=setTimeout(function(){saveName(slot,name);},600);
}
function saveName(slot,name){
  sbPatch('participants',{slot:slot},{name:name}).then(function(){
    var p=participants.find(function(p){return p.slot===slot;});
    if(p)p.name=name;
    flashIndicator('save-ind-'+slot);
    document.getElementById('pot-amount').textContent=fmt(pot());
  }).catch(function(e){console.error('Name save failed:',e);});
}

function addKnockoutMatch(){
  var home=document.getElementById('new-home').value;
  var away=document.getElementById('new-away').value;
  var stage=document.getElementById('new-stage').value;
  if(home===away){alert('Home and away teams must be different');return;}
  sbInsert('matches',{home:home,away:away,stage:stage,match_date:'TBC',match_time:'',status:'NS'})
    .then(function(result){matches.push(result[0]);renderAdmin();})
    .catch(function(e){console.error('Add match failed:',e);});
}

function bulkAssign(){
  var textarea=document.getElementById('bulk-names');
  var statusEl=document.getElementById('bulk-status');
  if(!textarea)return;
  var names=textarea.value.split('\n').map(function(n){return n.trim();}).filter(function(n){return n.length>0;});
  if(!names.length){if(statusEl)statusEl.textContent='No names entered.';return;}
  if(names.length>28){if(statusEl)statusEl.textContent='Max 28 names. You entered '+names.length+'.';return;}
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

function flashIndicator(id){var el=document.getElementById(id);if(el){el.style.opacity='1';setTimeout(function(){el.style.opacity='0';},1500);}}

function updateSetting(key,value){
  sbPatch('settings',{key:key},{value:value}).then(function(){
    settings[key]=value;renderPrizes();
    if(currentTab==='leaderboard')renderLeaderboard();
  }).catch(function(e){console.error('Setting save failed:',e);});
}
function refreshAll(){loadAll().then(function(){refreshCurrent();});}
function clearAllNames(){
  var promises=participants.map(function(p){return sbPatch('participants',{slot:p.slot},{name:''}).then(function(){p.name='';});});
  Promise.all(promises).then(function(){renderAdmin();});
}

function showTab(tab,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active');});
  document.getElementById('tab-'+tab).classList.add('active');
  currentTab=tab;refreshCurrent();
}
function refreshCurrent(){
  if(currentTab==='leaderboard')renderLeaderboard();
  else if(currentTab==='scores')renderScores();
  else if(currentTab==='groups')renderGroups();
  else if(currentTab==='prizes')renderPrizes();
  else if(currentTab==='admin')renderAdmin();
}
function updateStatusBadge(){
  var badge=document.getElementById('api-badge');
  var ft=matches.filter(function(m){return getMatchPhase(m)==='finished';}).length;
  var live=matches.filter(function(m){return getMatchPhase(m)==='live';}).length;
  if(live){badge.textContent='\u25cf '+live+' live';badge.className='badge live';}
  else if(ft){badge.textContent=ft+' results';badge.className='badge';}
  else{badge.textContent='No scores yet';badge.className='badge';}
}

document.getElementById('api-badge').textContent='Loading\u2026';
loadAll().then(function(){updateStatusBadge();renderLeaderboard();})
  .catch(function(e){console.error('Init failed:',e);document.getElementById('api-badge').textContent='DB error';document.getElementById('api-badge').className='badge err';renderLeaderboard();});
setInterval(function(){loadAll().then(function(){updateStatusBadge();refreshCurrent();}).catch(function(){});},30000);

// ============================================================
// FEATURE ADDITIONS: WhatsApp, Countdown, Spinner, Toast, etc.
// ============================================================

var lastUpdated = null;

// ── SPINNER ──────────────────────────────────────────────
function showSpinner(){
  var el=document.getElementById('tab-leaderboard');
  if(el&&!el.innerHTML.trim()){
    el.innerHTML='<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>';
  }
}
function hideSpinner(){
  var el=document.getElementById('tab-leaderboard');
  if(el&&el.querySelector('.loading-spinner'))el.innerHTML='';
}

// ── TOAST ────────────────────────────────────────────────
function showToast(msg,type){
  type=type||'error';
  var ex=document.getElementById('toast-msg');if(ex)ex.remove();
  var t=document.createElement('div');
  t.id='toast-msg';t.className='toast toast-'+type;t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.classList.add('show');},10);
  setTimeout(function(){t.classList.remove('show');setTimeout(function(){if(t.parentNode)t.remove();},300);},3500);
}

// ── SCROLL TO TOP ────────────────────────────────────────
function scrollToTop(){window.scrollTo({top:0,behavior:'smooth'});}
window.addEventListener('scroll',function(){
  var btn=document.getElementById('scroll-top-btn');
  if(btn){
    btn.style.opacity=window.scrollY>300?'1':'0';
    btn.style.pointerEvents=window.scrollY>300?'auto':'none';
  }
});

// ── COUNTDOWN ────────────────────────────────────────────
function getNextFixture(){
  var upcoming=matches.filter(function(m){return getMatchPhase(m)==='upcoming';});
  if(!upcoming.length)return null;
  return upcoming.slice().sort(function(a,b){
    var ka=parseMatchDateTime(a),kb=parseMatchDateTime(b);
    if(!ka)return 1;if(!kb)return -1;
    return ka.getTime()-kb.getTime();
  })[0];
}
function getCountdownText(){
  var next=getNextFixture();if(!next)return'';
  var kickoff=parseMatchDateTime(next);if(!kickoff)return'';
  var diff=kickoff.getTime()-Date.now();
  if(diff<=0)return'Kick-off now!';
  var h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
  if(h>24){var d=Math.floor(h/24);return d+'d '+(h%24)+'h';}
  if(h>0)return h+'h '+m+'m '+s+'s';
  if(m>0)return m+'m '+s+'s';
  return s+'s';
}

// ── LAST UPDATED ─────────────────────────────────────────
function getLastUpdatedText(){
  if(!lastUpdated)return'';
  var diff=Math.floor((Date.now()-lastUpdated.getTime())/1000);
  if(diff<10)return'Just updated';
  if(diff<60)return'Updated '+diff+'s ago';
  var m=Math.floor(diff/60);
  if(m<60)return'Updated '+m+'m ago';
  return'Updated '+Math.floor(m/60)+'h ago';
}

// ── WHATSAPP SHARE ───────────────────────────────────────
function shareWhatsApp(){
  var lb=computeLeaderboard();
  var top3=lb.slice(0,3).map(function(e,i){
    var m=['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i];
    return m+' '+e.name+' - '+e.total+' pts ('+e.team+' & '+e.team2+')';
  }).join('\n');
  var msg='\u26bd WC2026 Sweepstake:\n\n'+top3+'\n\nhttps://k1ran555.github.io/wc2026-sweepstake/';
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');
}

// ── GROUP STAGE CHECK ────────────────────────────────────
function isGroupStageComplete(){
  var gm=matches.filter(function(m){return m.stage==='GROUP_STAGE';});
  if(gm.length<72)return false;
  return gm.every(function(m){return getMatchPhase(m)==='finished';});
}

// ── ENHANCED LEADERBOARD ─────────────────────────────────
function renderLeaderboard2(){
  renderLeaderboard();
  var el=document.getElementById('tab-leaderboard');
  var p=pot();
  var topBar='<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">'
    +'<button class="btn-whatsapp" onclick="shareWhatsApp()">'
    +'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px;margin-right:5px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.556 4.122 1.528 5.856L.057 23.882l6.188-1.448A11.934 11.934 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.86 0-3.604-.504-5.102-1.382l-.366-.217-3.793.888.904-3.7-.238-.38A9.946 9.946 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>'
    +'Share standings</button>'
    +'<span id="last-updated-display" style="font-size:12px;color:var(--text-muted)">'+getLastUpdatedText()+'</span>'
    +'</div>';
  var banner='';
  if(isGroupStageComplete()){
    var wgd=computeWorstGD();
    banner='<div class="stage-banner">\ud83c\udfc1 Group stage complete! Worst GD prize locked in'
      +(wgd?' — '+esc(wgd.name)+' wins '+fmt(p*0.07)+' GD '+(wgd.gd>0?'+':'')+wgd.gd:'')+'</div>';
  }
  el.innerHTML=topBar+banner+el.innerHTML;
}

// ── ENHANCED SCORES WITH COUNTDOWN ───────────────────────
function renderScores2(){
  renderScores();
  var el=document.getElementById('tab-scores');
  var next=getNextFixture();
  if(next){
    var timeStr=next.match_date+(next.match_time?' '+next.match_time+' BST':'');
    var bar='<div class="countdown-bar">'
      +'<span class="countdown-label">\u23f1 Next: '+esc(next.home)+' vs '+esc(next.away)+'</span>'
      +'<span id="countdown-display" class="countdown-time">'+getCountdownText()+'</span>'
      +'<span class="countdown-when">'+timeStr+'</span>'
      +'</div>';
    el.innerHTML=bar+el.innerHTML;
  }
}

// ── PATCH saveScoreDirect for error toast ────────────────
var _orig_saveScoreDirect=saveScoreDirect;
saveScoreDirect=function(id){
  var m=matches.find(function(x){return x.id===id;});
  if(!m)return;
  sbPatch('matches',{id:id},{home_goals:m.home_goals,away_goals:m.away_goals}).then(function(){
    flashIndicator('score-ind-'+id);
    refreshCurrent();
  }).catch(function(e){
    console.error('Score save failed:',e);
    showToast('Score failed to save \u2014 check connection','error');
  });
};

// ── OVERRIDE refreshCurrent ───────────────────────────────
refreshCurrent=function(){
  if(currentTab==='leaderboard')renderLeaderboard2();
  else if(currentTab==='scores')renderScores2();
  else if(currentTab==='groups')renderGroups();
  else if(currentTab==='prizes')renderPrizes();
  else if(currentTab==='admin')renderAdmin();
};

// ── OVERRIDE showTab ─────────────────────────────────────
showTab=function(tab,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active');});
  document.getElementById('tab-'+tab).classList.add('active');
  currentTab=tab;refreshCurrent();
};

// ── TRACK lastUpdated on each loadAll ────────────────────
var _orig_loadAll=loadAll;
loadAll=function(){
  return _orig_loadAll().then(function(){lastUpdated=new Date();});
};

// ── 1-SECOND TICK ────────────────────────────────────────
setInterval(function(){
  if(currentTab==='scores'){
    var el=document.getElementById('countdown-display');
    if(el)el.textContent=getCountdownText();
  }
  if(currentTab==='leaderboard'){
    var tu=document.getElementById('last-updated-display');
    if(tu)tu.textContent=getLastUpdatedText();
  }
},1000);

// ── INIT: show spinner then load ─────────────────────────
showSpinner();
loadAll().then(function(){
  lastUpdated=new Date();
  hideSpinner();
  updateStatusBadge();
  renderLeaderboard2();
}).catch(function(e){
  hideSpinner();
  console.error('Init failed:',e);
  document.getElementById('api-badge').textContent='DB error';
  document.getElementById('api-badge').className='badge err';
});
