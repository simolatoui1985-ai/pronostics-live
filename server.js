// Live predictions server. Needs only Node.js (no installation of packages).
const http = require('http'), fs = require('fs'), path = require('path'), readline = require('readline');
const BASE = process.env.API_BASE || 'https://v3.football.api-sports.io';
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data.json');
let KEY = process.env.API_FOOTBALL_KEY || '';
let st = { preds: [], pid: 0 };
try { st = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
const save = () => fs.writeFileSync(DATA, JSON.stringify(st));
const clock = () => new Date().toLocaleTimeString('en-GB');
const MATCHES = new Map();
let quota = null, lastLive = 0;

async function api(p) {
  const r = await fetch(BASE + p, { headers: { 'x-apisports-key': KEY } });
  const rem = r.headers.get('x-ratelimit-requests-remaining');
  if (rem !== null) quota = rem;
  const d = await r.json(), er = d.errors;
  if (er && (Array.isArray(er) ? er.length : Object.keys(er).length)) throw new Error(JSON.stringify(er));
  return d.response || [];
}
function evMap(list, m) {
  return list.filter(e => (e.type === 'Goal' && e.detail !== 'Missed Penalty') || e.type === 'Card')
    .map(e => ({ min: Math.min(90, e.time.elapsed || 0), type: e.type === 'Goal' ? 'goal' : 'card', t: e.team.id === m.hid ? 0 : 1 }));
}
function upsert(f) {
  const id = f.fixture.id;
  const m = MATCHES.get(id) || { id, ev: [], s: { corner: [0, 0], foul: [0, 0], shots: [0, 0], tgt: [0, 0], poss: [0, 0] } };
  m.league = f.league.name; m.h = f.teams.home.name; m.a = f.teams.away.name; m.hid = f.teams.home.id;
  m.g = [f.goals.home || 0, f.goals.away || 0];
  const sh = f.fixture.status.short;
  m.status = sh; m.fin = ['FT', 'AET', 'PEN'].includes(sh);
  m.min = m.fin ? 90 : sh === 'HT' ? 45 : Math.min(90, f.fixture.status.elapsed || 0);
  if (Array.isArray(f.events)) m.ev = evMap(f.events, m);
  MATCHES.set(id, m); return m;
}
async function loadEvents(m) {
  if (Date.now() - (m.eat || 0) < 60000) return; m.eat = Date.now();
  m.ev = evMap(await api('/fixtures/events?fixture=' + m.id), m);
}
const SK = { 'Corner Kicks': 'corner', 'Fouls': 'foul', 'Total Shots': 'shots', 'Shots on Goal': 'tgt', 'Ball Possession': 'poss' };
async function loadStats(m) {
  if (Date.now() - (m.sat || 0) < 60000) return; m.sat = Date.now();
  (await api('/fixtures/statistics?fixture=' + m.id)).forEach(x => {
    const t = x.team.id === m.hid ? 0 : 1;
    x.statistics.forEach(s => { const k = SK[s.type]; if (k) m.s[k][t] = parseInt(String(s.value || 0), 10) || 0; });
  });
}
async function refreshLive() {
  if (Date.now() - lastLive < 60000) return; lastLive = Date.now();
  const ids = new Set((await api('/fixtures?live=all')).map(f => upsert(f).id));
  MATCHES.forEach(m => { m.live = ids.has(m.id); });
}

const MK = { goals: { ty: 'goal', per: 'full', ou: 1 }, goals1: { ty: 'goal', per: 'h1', ou: 1 }, goals2: { ty: 'goal', per: 'h2', ou: 1 }, tgoals: { ty: 'goal', per: 'full', ou: 1 }, g1: { ty: 'goal', per: 'h1' }, g2: { ty: 'goal', per: 'h2' }, btts: {}, res: {}, dc: {}, next: {}, before: {}, corner: { ty: 'corner', per: 'full', ou: 1 }, card: { ty: 'card', per: 'full', ou: 1 }, foul: { ty: 'foul', per: 'full', ou: 1 } };
const inPer = (min, per) => per === 'full' || (per === 'h1' ? min <= 45 : min > 45);
const ended = (m, per) => per === 'h1' ? m.status !== '1H' : m.fin;
function evalP(p, m) {
  const s = MK[p.k]; if (!s) return null;
  const cnt = (ty, team, per) => {
    if (ty === 'corner' || ty === 'foul') { const a = m.s[ty]; return team < 0 ? a[0] + a[1] : a[team]; }
    if (ty === 'goal' && per === 'full') return team < 0 ? m.g[0] + m.g[1] : m.g[team];
    return m.ev.filter(e => e.type === ty && (team < 0 || e.t === team) && inPer(e.min, per)).length;
  };
  if (s.ou) {
    const c = cnt(s.ty, p.team, s.per), en = ended(m, s.per);
    if (p.side === 'over') return c > p.line ? 'won' : (en ? 'lost' : null);
    return c > p.line ? 'lost' : (en ? 'won' : null);
  }
  if (p.k === 'g1' || p.k === 'g2') {
    const c = cnt('goal', -1, s.per), en = ended(m, s.per);
    if (p.side === 'yes') return c > 0 ? 'won' : (en ? 'lost' : null);
    return c > 0 ? 'lost' : (en ? 'won' : null);
  }
  if (p.k === 'btts') {
    const both = m.g[0] > 0 && m.g[1] > 0;
    if (p.side === 'yes') return both ? 'won' : (m.fin ? 'lost' : null);
    return both ? 'lost' : (m.fin ? 'won' : null);
  }
  if (p.k === 'res' || p.k === 'dc') {
    if (!m.fin) return null;
    const o = m.g[0] > m.g[1] ? '1' : m.g[0] < m.g[1] ? '2' : 'X';
    return p.side.includes(o) ? 'won' : 'lost';
  }
  if (p.k === 'next') {
    const e = m.ev.slice(p.from).find(x => x.type === 'goal');
    if (e) return p.side === (e.t ? 'away' : 'home') ? 'won' : 'lost';
    return m.fin ? (p.side === 'none' ? 'won' : 'lost') : null;
  }
  const c = m.ev.slice(p.from).filter(e => e.type === 'goal' && e.min <= p.end && (p.team < 0 || e.t === p.team)).length;
  const en = m.fin || m.min >= p.end;
  if (p.side === 'yes') return c > 0 ? 'won' : (en ? 'lost' : null);
  return c > 0 ? 'lost' : (en ? 'won' : null);
}
function resolveAll() {
  let ch = false;
  st.preds.forEach(p => {
    if (p.st !== 'live') return;
    const m = MATCHES.get(p.mid); if (!m) return;
    const r = evalP(p, m);
    if (r) { p.st = r; p.hist.push(clock() + ' - ' + (r === 'won' ? 'تحقق' : 'لم يتحقق')); ch = true; }
  });
  if (ch) save();
}
async function trackAll() {
  try {
    await refreshLive();
    const ids = [...new Set(st.preds.filter(p => p.st === 'live').map(p => p.mid))];
    for (const id of ids) {
      const m = MATCHES.get(id); if (!m) continue;
      if (!m.live && !m.fin) { const r = await api('/fixtures?id=' + id); if (r[0]) upsert(r[0]); }
      await loadEvents(m); await loadStats(m);
    }
    resolveAll();
  } catch (e) { console.log('API error:', e.message); }
}

const send = (res, obj, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(ok => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } }); });

async function handler(req, res) {
  try {
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && (u === '/' || u === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (u === '/api/live') {
      try { await refreshLive(); } catch (e) { return send(res, { error: e.message }); }
      const matches = [...MATCHES.values()].filter(m => m.live).map(m => ({ id: m.id, league: m.league, h: m.h, a: m.a, g: m.g, min: m.min, status: m.status }));
      return send(res, { matches, quota });
    }
    let x = u.match(/^\/api\/match\/(\d+)$/);
    if (x) {
      const m = MATCHES.get(+x[1]); if (!m) return send(res, { error: 'مباراة غير معروفة' });
      try { await loadEvents(m); await loadStats(m); } catch (e) { return send(res, { error: e.message }); }
      return send(res, { id: m.id, ev: m.ev, s: m.s, g: m.g, min: m.min, status: m.status });
    }
    if (u === '/api/preds' && req.method === 'GET') return send(res, st.preds);
    if (u === '/api/preds' && req.method === 'POST') {
      const b = await body(req), m = MATCHES.get(b.mid), s = MK[b.k];
      if (!m || !s) return send(res, { error: 'مباراة أو سوق غير صالح.' });
      if (m.fin) return send(res, { error: 'المباراة انتهت.' });
      if (s.per && ended(m, s.per)) return send(res, { error: 'هذا السوق مغلق: الفترة انتهت.' });
      try { await loadEvents(m); } catch (e) {}
      const p = { id: ++st.pid, mid: m.id, hn: m.h, an: m.a, k: b.k, team: +b.team, side: String(b.side), line: +b.line || 0, end: b.k === 'before' ? +b.end : 90, from: m.ev.length, at: m.min, st: 'live', hist: [], note: '' };
      if (b.k === 'before' && !(p.end > m.min && p.end <= 90)) return send(res, { error: 'الدقيقة غير صالحة.' });
      if (evalP(p, m)) return send(res, { error: 'السوق محسوم بالفعل، اختر خيارا آخر.' });
      p.hist.push(clock() + ' - نُشر عند الدقيقة ' + m.min);
      st.preds.unshift(p); save();
      return send(res, p);
    }
    x = u.match(/^\/api\/preds\/(\d+)\/(cancel|ext|note)$/);
    if (x && req.method === 'POST') {
      const p = st.preds.find(q => q.id === +x[1]), b = await body(req);
      if (!p || p.st !== 'live') return send(res, { error: 'لا يمكن تعديل هذا التوقع.' });
      if (x[2] === 'cancel') { p.st = 'cancel'; p.hist.push(clock() + ' - أُلغي بقرار المحلل'); }
      else if (x[2] === 'ext') { if (p.k !== 'before' || p.end + 5 > 90) return send(res, { error: 'لا يمكن التمديد.' }); p.end += 5; p.hist.push(clock() + ' - تمديد الفترة إلى الدقيقة ' + p.end); }
      else { p.note = String(b.note || '').slice(0, 200); p.hist.push(clock() + ' - ملاحظة: ' + p.note); }
      save(); return send(res, p);
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { send(res, { error: e.message }, 500); }
}

function start() {
  http.createServer(handler).listen(PORT, () => console.log('Server is running. Open this in Chrome:  http://localhost:' + PORT));
  setInterval(trackAll, 120000);
}
if (KEY) start();
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste your API-Football key, then press Enter: ', a => { KEY = a.trim(); rl.close(); console.clear(); start(); });
}
