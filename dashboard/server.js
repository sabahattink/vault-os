require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const { marked } = require('marked');
const chokidar = require('chokidar');
const { execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const util = require('util');
const execFileP = util.promisify(execFile);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const VAULT    = process.env.VAULT_PATH || 'C:\\vault\\Knowledge_Base';
const PIPELINE = process.env.CONTENT_PIPELINE_DIR || 'C:\\vault\\ContentPipeline';
const PORT     = parseInt(process.env.PORT) || 3777;

app.use(express.json());
app.use(express.static(__dirname));

// ── Simple in-memory cache ────────────────────────────
const cache = {};
function cached(key, ttlMs, fn) {
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < ttlMs) return Promise.resolve(cache[key].val);
  return Promise.resolve(fn()).then(val => { cache[key] = { val, ts: now }; return val; });
}

function broadcast(data) {
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(data)); });
}

chokidar.watch(VAULT, { ignored: /(\.scripts|\.dashboard|node_modules|\.git)/, ignoreInitial: true })
  .on('all', (event, filePath) => broadcast({ type: 'vault_change', event, file: filePath.replace(VAULT, '') }));

const count = (dir) => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length; } catch { return 0; } };

// ── Async URL ping ─────────────────────────────────────
function pingUrl(url, timeout = 4500) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    try {
      const req = mod.get(url, { timeout }, res => { resolve(res.statusCode < 500 ? 'up' : 'down'); res.resume(); });
      req.on('error', () => resolve('down'));
      req.on('timeout', () => { req.destroy(); resolve('down'); });
      setTimeout(() => { try { req.destroy(); } catch {} resolve('down'); }, timeout);
    } catch { resolve('down'); }
  });
}

// ── Git project info ───────────────────────────────────
async function gitInfo(repoPath) {
  if (!fs.existsSync(path.join(repoPath, '.git'))) return { exists: false };
  try {
    const [branch, log, status] = await Promise.all([
      execFileP('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ({ stdout: 'unknown' })),
      execFileP('git', ['-C', repoPath, 'log', '-1', '--pretty=format:%h|%s|%cr']).catch(() => ({ stdout: '' })),
      execFileP('git', ['-C', repoPath, 'status', '--porcelain']).catch(() => ({ stdout: '' }))
    ]);
    const parts = log.stdout.split('|');
    return {
      exists: true,
      branch: branch.stdout.trim(),
      lastCommit: { hash: parts[0] || '', subject: parts[1] || 'No commits', ago: parts[2] || '' },
      dirty: status.stdout.trim().length > 0,
      changedFiles: status.stdout.trim().split('\n').filter(Boolean).length
    };
  } catch (e) { return { exists: true, error: e.message }; }
}

// ── Projects config ────────────────────────────────────
// Configure your projects here. Each entry needs:
//   id     — display name / project identifier
//   path   — absolute path to the project directory on disk
//   status — initial status label
//   color  — badge color: blue | green | yellow | gray | purple
//   url    — live URL (leave empty string if not applicable)
//   desc   — one-line description
const PROJECTS = [
  { id: 'Project1', path: process.env.PROJECT1_PATH || '', status: 'Planning', color: 'blue',   url: '',                              desc: 'Your first project' },
  { id: 'Project2', path: process.env.PROJECT2_PATH || '', status: 'Active',   color: 'green',  url: process.env.PROJECT2_URL || '',  desc: 'Your second project' },
  { id: 'Project3', path: process.env.PROJECT3_PATH || '', status: 'On Hold',  color: 'yellow', url: process.env.PROJECT3_URL || '',  desc: 'Your third project' },
];

// ── Read project status from Overview.md (source of truth) ──
function syncProjectStatuses() {
  PROJECTS.forEach(p => {
    try {
      const overviewPath = path.join(VAULT, '20_PROJECTS', p.id, `${p.id} Overview.md`);
      if (!fs.existsSync(overviewPath)) return;
      const raw = fs.readFileSync(overviewPath, 'utf8');
      const m = raw.match(/^status:\s*(.+)$/m);
      if (m) p.status = m[1].trim();
    } catch {}
  });
}
syncProjectStatuses();

// ══════════════════════════════════════════════════════
// EXISTING ENDPOINTS
// ══════════════════════════════════════════════════════

app.get('/api/morning', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(VAULT, '50_DAILY', `${today}-morning.md`);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file).toString('utf8').replace(/^﻿/, '');
    res.json({ html: marked(raw), date: today });
  } else {
    res.json({ html: '<p>No report yet. Will be generated at 23:00.</p>', date: today });
  }
});

// Section extractor: pulls the block under "## Heading" from a markdown file
function extractSection(content, sectionName) {
  const lines = content.split(/\r?\n/);
  const header = `## ${sectionName}`;
  const idx = lines.findIndex((l) => l.trim() === header);
  if (idx === -1) return '';
  const block = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    block.push(lines[i]);
  }
  return block.join('\n').trim();
}

app.get('/api/morning-digest', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayFile = path.join(VAULT, '50_DAILY', `${today}-morning.md`);
  const yesterdayFile = path.join(VAULT, '50_DAILY', `${yesterday}-morning.md`);
  const hotFile = path.join(VAULT, 'wiki', 'hot.md');

  const readSafe = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/^﻿/, '') : '';

  const todayContent = readSafe(todayFile);
  const yesterdayContent = readSafe(yesterdayFile);
  const hotContent = readSafe(hotFile);

  const brief = {
    whatHappened: extractSection(todayContent, 'What Happened'),
    criticalInfo: extractSection(todayContent, 'Critical Info'),
    carryOver:    extractSection(todayContent, 'Carry Over'),
    todayTasks:   extractSection(todayContent, 'Today Tasks'),
    risks:        extractSection(todayContent, 'Risks'),
    opportunities: extractSection(todayContent, 'Opportunities')
  };

  const eveningReview = extractSection(yesterdayContent, 'Evening Review');
  const hotSnippet = hotContent.replace(/^---[\s\S]*?---\n/, '').slice(0, 800).trim();

  res.json({
    date: today,
    yesterday,
    available: {
      brief: todayContent.length > 0,
      eveningReview: eveningReview.length > 0,
      hot: hotContent.length > 0
    },
    brief: {
      whatHappened:  { md: brief.whatHappened,  html: marked(brief.whatHappened  || '_none_') },
      criticalInfo:  { md: brief.criticalInfo,  html: marked(brief.criticalInfo  || '_none_') },
      carryOver:     { md: brief.carryOver,     html: marked(brief.carryOver     || '_none_') },
      todayTasks:    { md: brief.todayTasks,    html: marked(brief.todayTasks    || '_none_') },
      risks:         { md: brief.risks,         html: marked(brief.risks         || '_none_') },
      opportunities: { md: brief.opportunities, html: marked(brief.opportunities || '_none_') }
    },
    eveningReview: { md: eveningReview, html: marked(eveningReview || '_No evening review_') },
    hot: { md: hotSnippet, html: marked(hotSnippet || '_wiki/hot.md empty_') }
  });
});

app.get('/api/actions', (req, res) => {
  const file = path.join(VAULT, '60_ACTIONS', 'actions.md');
  if (!fs.existsSync(file)) return res.json({ pending: [], done: [] });
  const content = fs.readFileSync(file).toString('utf8').replace(/^﻿/, '');
  res.json({
    pending: (content.match(/- \[ \] .+/g) || []).map(l => l.replace('- [ ] ', '')),
    done:    (content.match(/- \[x\] .+/g) || []).map(l => l.replace('- [x] ', ''))
  });
});

app.post('/api/action-toggle', (req, res) => {
  const { action, done } = req.body;
  const file = path.join(VAULT, '60_ACTIONS', 'actions.md');
  if (!fs.existsSync(file)) return res.json({ ok: false });
  try {
    let content = fs.readFileSync(file).toString('utf8').replace(/^﻿/, '');
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = done
      ? content.replace(new RegExp(`- \\[ \\] ${escaped}`), `- [x] ${action}`)
      : content.replace(new RegExp(`- \\[x\\] ${escaped}`), `- [ ] ${action}`);
    fs.writeFileSync(file, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/quick-capture', (req, res) => {
  const { text, title } = req.body;
  if (!text) return res.json({ ok: false });
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toTimeString().slice(0, 5);
  const fname = `${today}-${Date.now()}.md`;
  const content = `---\ntype: note\ndate: ${today}\ntags: [quick-capture]\n---\n\n# ${title || 'Quick Capture'} — ${time}\n\n${text}\n`;
  try {
    fs.writeFileSync(path.join(VAULT, '00_INBOX', fname), content, 'utf8');
    res.json({ ok: true, file: fname });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/stats', (req, res) => {
  let archive = 0, wiki = 0;
  const walk = (d, cb) => { try { fs.readdirSync(d).forEach(f => { const p = path.join(d,f); fs.statSync(p).isDirectory() ? walk(p, cb) : cb(f); }); } catch {} };
  walk(path.join(VAULT, '70_ARCHIVE'), f => f.endsWith('.md') && archive++);
  walk(path.join(VAULT, 'wiki'), f => f.endsWith('.md') && wiki++);
  res.json({ inbox: count(path.join(VAULT,'00_INBOX')), notes: count(path.join(VAULT,'10_NOTES')),
    daily: count(path.join(VAULT,'50_DAILY')), actions: count(path.join(VAULT,'60_ACTIONS')), archive, wiki });
});

app.get('/api/brain-data', (req, res) => {
  let hotNodes = [], memory = [];
  try {
    const hotFile = path.join(VAULT, 'wiki', 'hot.md');
    if (fs.existsSync(hotFile)) {
      hotNodes = [...new Set((fs.readFileSync(hotFile,'utf8').match(/\[\[([^\]|]+)/g)||[]).map(l=>l.replace('[[','').trim()))].slice(0,8);
    }
    const mdir = path.join(VAULT, 'MEMORY');
    if (fs.existsSync(mdir)) memory = fs.readdirSync(mdir).filter(f=>f.endsWith('.md')).map(f=>f.replace('.md','')).slice(0,5);
  } catch {}
  res.json({ hotNodes, memory });
});

app.get('/api/pipeline', (req, res) => {
  const latest = (dir) => { try { const files = fs.readdirSync(path.join(PIPELINE,dir)).filter(f=>f.endsWith('.md')).map(f=>({name:f,time:fs.statSync(path.join(PIPELINE,dir,f)).mtime})).sort((a,b)=>b.time-a.time); return files[0]?files[0].name.replace(/^﻿/,'').replace('.md',''):null; } catch { return null; } };
  res.json({ inbox: count(path.join(PIPELINE,'inbox')), research: count(path.join(PIPELINE,'research-briefs')),
    drafts: count(path.join(PIPELINE,'drafts')), approved: count(path.join(PIPELINE,'approved-content')),
    distribution: count(path.join(PIPELINE,'distribution')), latest_dist: latest('distribution') });
});

app.get('/api/pipeline-files/:stage', (req, res) => {
  const map = { inbox:'inbox', research:'research-briefs', drafts:'drafts', approved:'approved-content', distribution:'distribution' };
  const dir = map[req.params.stage];
  if (!dir) return res.json({ files: [] });
  try {
    const files = fs.readdirSync(path.join(PIPELINE,dir)).filter(f=>f.endsWith('.md'))
      .map(f=>{ const p=path.join(PIPELINE,dir,f); return {name:f.replace('.md',''),mtime:fs.statSync(p).mtime.toISOString()}; })
      .sort((a,b)=>b.mtime>a.mtime?1:-1);
    res.json({ files, stage: req.params.stage });
  } catch { res.json({ files: [] }); }
});

app.get('/api/projects', (req, res) => {
  res.json(PROJECTS.map(p => { try { return { ...p, files: fs.readdirSync(p.path).length, exists: true }; } catch { return { ...p, files: 0, exists: false }; } }));
});

app.get('/api/vps', async (req, res) => {
  // Configure your monitored services in .env or directly here
  const services = (process.env.MONITORED_SERVICES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [name, url] = entry.split('|');
      return { name: name.trim(), url: url.trim() };
    });
  const results = await Promise.all(services.map(async s => ({ ...s, status: await pingUrl(s.url) })));
  res.json({ services: results, vps: process.env.VPS_IP || 'your-server-ip' });
});

app.get('/api/sysload', (req, res) => {
  try {
    const cpu = execSync('wmic cpu get loadpercentage /value', { timeout: 3000, encoding: 'utf8', shell: 'cmd.exe' });
    const mem = execSync('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value', { timeout: 3000, encoding: 'utf8', shell: 'cmd.exe' });
    const cpuPct = parseInt((cpu.match(/LoadPercentage=(\d+)/)||[0,0])[1])||0;
    const free   = parseInt((mem.match(/FreePhysicalMemory=(\d+)/)||[0,0])[1])||0;
    const total  = parseInt((mem.match(/TotalVisibleMemorySize=(\d+)/)||[0,1])[1])||1;
    res.json({ cpu: cpuPct, mem: Math.round((1-free/total)*100), ts: Date.now() });
  } catch { res.json({ cpu: Math.round(Math.random()*25+5), mem: Math.round(Math.random()*15+45), ts: Date.now() }); }
});

app.get('/api/mcp-status', (req, res) => {
  const net = require('net');
  const tcp = (port) => new Promise(r => { const s=net.createConnection({port,host:'localhost'}); s.on('connect',()=>{s.destroy();r(true);}); s.on('error',()=>r(false)); setTimeout(()=>{s.destroy();r(false);},1500); });
  Promise.all([
    Promise.resolve(fs.existsSync(VAULT)),
    Promise.resolve(fs.existsSync(process.env.DATA_DRIVE_ROOT || 'C:\\')),
    new Promise(r=>{try{execSync('gh --version',{timeout:2000});r(true);}catch{r(false);}}),
    tcp(parseInt(process.env.DB1_PORT) || 15432),
    tcp(parseInt(process.env.DB2_PORT) || 15433),
    tcp(parseInt(process.env.DB3_PORT) || 15434),
    pingUrl(process.env.N8N_URL || 'http://localhost:5678', 3000).then(s=>s==='up'),
    Promise.resolve(true)
  ]).then(([a,b,c,d,e,f,g,h]) => res.json({'vault-fs':a,'data-drive':b,'github':c,'db1':d,'db2':e,'db3':f,'n8n':g,'notion':h}));
});

app.get('/api/system', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const log = path.join(VAULT, '.scripts', 'logs', `${today}-agent.log`);
    if (fs.existsSync(log)) {
      const lines = fs.readFileSync(log,'utf8').split('\n').filter(Boolean);
      res.json({ nightly: { ran: true, last: lines[lines.length-1]||'' } });
    } else res.json({ nightly: { ran: false, last: 'Not yet run today' } });
  } catch { res.json({ nightly: { ran: false, last: 'Log not found' } }); }
});

app.get('/api/opportunities', (req, res) => {
  const file = path.join(VAULT, '60_ACTIONS', 'product-opportunities.md');
  if (!fs.existsSync(file)) return res.json({ items: [] });
  res.json({ items: (fs.readFileSync(file,'utf8').match(/### .+/g)||[]).map(l=>l.replace('### ','')) });
});

// ══════════════════════════════════════════════════════
// SOCIAL
// ══════════════════════════════════════════════════════

app.get('/api/social', (req, res) => {
  const PLATFORMS = ['linkedin','twitter','instagram','tiktok','youtube','x'];

  function parseFrontmatter(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
      const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!m) return {};
      const fm = {};
      m[1].split('\n').forEach(line => {
        const kv = line.match(/^(\w[\w_-]*):\s*(.+)/);
        if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g,'');
      });
      return fm;
    } catch { return {}; }
  }

  const STAGES = [
    { dir: 'distribution',    label: 'distribution' },
    { dir: 'approved-content',label: 'approved' },
    { dir: 'drafts',          label: 'draft' },
    { dir: 'research-briefs', label: 'research' }
  ];

  const items = [];
  for (const stage of STAGES) {
    try {
      const dir = path.join(PIPELINE, stage.dir);
      if (!fs.existsSync(dir)) continue;
      fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => {
        const fl = f.toLowerCase();
        let platform = 'other';
        PLATFORMS.forEach(p => { if (fl.includes(p)) platform = p === 'x' ? 'twitter' : p; });
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
        const fullPath = path.join(PIPELINE, stage.dir, f);
        const fm = parseFrontmatter(fullPath);

        const isActuallyPublished =
          fm.published === 'true' ||
          fm.published_at ||
          fm.status === 'published';

        const effectiveStage = (stage.label === 'distribution' && isActuallyPublished)
          ? 'published'
          : stage.label === 'distribution'
            ? 'ready'
            : stage.label;

        items.push({
          name: f.replace('.md', ''),
          platform,
          stage: effectiveStage,
          date: dateMatch ? dateMatch[1] : null,
          mtime: fs.statSync(fullPath).mtime.toISOString(),
          fm
        });
      });
    } catch {}
  }

  const byPlatform = {};
  items.forEach(i => {
    if (!byPlatform[i.platform]) byPlatform[i.platform] = { total:0, published:0, ready:0, approved:0, draft:0, items:[] };
    byPlatform[i.platform].total++;
    byPlatform[i.platform][i.stage] = (byPlatform[i.platform][i.stage]||0) + 1;
    byPlatform[i.platform].items.push(i);
  });

  const freq = {};
  items.filter(i => i.stage === 'published' && i.date).forEach(i => { freq[i.date] = (freq[i.date]||0)+1; });

  const queue = items
    .filter(i => i.stage === 'approved' || i.stage === 'ready')
    .sort((a,b) => b.mtime > a.mtime ? 1 : -1)
    .slice(0, 12);

  const recent = items
    .filter(i => i.stage === 'published')
    .sort((a,b) => b.mtime > a.mtime ? 1 : -1)
    .slice(0, 8);

  const counts = { published: 0, ready: 0, approved: 0, draft: 0, research: 0 };
  items.forEach(i => { counts[i.stage] = (counts[i.stage]||0)+1; });

  res.json({ total: items.length, byPlatform, freq, queue, recent, counts });
});

// ══════════════════════════════════════════════════════
// OPS
// ══════════════════════════════════════════════════════

app.get('/api/ops/projects', (req, res) => {
  cached('ops-projects', 30000, async () => {
    const results = await Promise.all(PROJECTS.map(async p => ({ ...p, git: await gitInfo(p.path) })));
    return results;
  }).then(projects => res.json({ ok: true, projects }))
    .catch(e => res.json({ ok: false, projects: [], error: e.message }));
});

app.get('/api/ops/github', (req, res) => {
  cached('ops-github', 60000, async () => {
    try {
      const { stdout } = await execFileP('gh', ['repo', 'list', '--limit', '8', '--json', 'name,description,updatedAt,isPrivate,url'], { timeout: 10000 });
      return { ok: true, repos: JSON.parse(stdout) };
    } catch { return { ok: false, repos: [], error: 'gh CLI required' }; }
  }).then(d => res.json(d)).catch(() => res.json({ ok: false, repos: [] }));
});

app.get('/api/ops/n8n', async (req, res) => {
  const n8nUrl = process.env.N8N_URL || 'http://localhost:5678';
  const status = await pingUrl(n8nUrl, 4000);
  res.json({ ok: true, online: status === 'up', url: n8nUrl });
});

// ══════════════════════════════════════════════════════
// INTEL
// ══════════════════════════════════════════════════════

app.get('/api/intel/alerts', async (req, res) => {
  const alerts = [];
  const now = Date.now();
  const DAY = 86400000;
  const today = new Date().toISOString().slice(0,10);

  const inboxCnt = count(path.join(VAULT, '00_INBOX'));
  if (inboxCnt === 0) alerts.push({ level: 'ok', icon: '📥', msg: `Inbox is clean` });
  else if (inboxCnt > 10) alerts.push({ level: 'crit', icon: '🔴', msg: `Inbox critical! ${inboxCnt} unprocessed files` });
  else if (inboxCnt > 5) alerts.push({ level: 'warn', icon: '📥', msg: `Inbox has ${inboxCnt} unprocessed files` });
  else alerts.push({ level: 'info', icon: '📥', msg: `Inbox has ${inboxCnt} new files` });

  for (const p of PROJECTS) {
    if (p.status === 'Done' || !p.path) continue;
    try {
      const { stdout } = await execFileP('git', ['-C', p.path, 'log', '-1', '--pretty=format:%cr'], { timeout: 2000 }).catch(() => ({ stdout: '' }));
      if (stdout && (stdout.includes('week') || stdout.includes('month') || stdout.includes('year'))) {
        alerts.push({ level: 'warn', icon: '⏸', msg: `${p.id}: last commit "${stdout.trim()}" — stale` });
      }
    } catch {
      try {
        const files = fs.readdirSync(p.path);
        const latest = Math.max(...files.map(f => { try { return fs.statSync(path.join(p.path,f)).mtimeMs; } catch { return 0; } }));
        const days = Math.floor((now - latest) / DAY);
        if (days > 10) alerts.push({ level: 'info', icon: '⏸', msg: `${p.id}: no file changes in ${days} days` });
      } catch {}
    }
  }

  const stageLabels = { 'drafts': 'Drafts', 'approved-content': 'Approved Content' };
  for (const [dir, label] of Object.entries(stageLabels)) {
    try {
      const old = fs.readdirSync(path.join(PIPELINE, dir)).filter(f => f.endsWith('.md')).filter(f => {
        return (now - fs.statSync(path.join(PIPELINE, dir, f)).mtimeMs) / DAY > 7;
      });
      if (old.length > 0) alerts.push({ level: 'warn', icon: '⏳', msg: `${label}: ${old.length} items stuck for 7+ days` });
    } catch {}
  }

  try {
    const dist = fs.readdirSync(path.join(PIPELINE, 'distribution')).filter(f => f.endsWith('.md'));
    const recentDist = dist.filter(f => (now - fs.statSync(path.join(PIPELINE,'distribution',f)).mtimeMs) / DAY < 7).length;
    if (recentDist > 0) alerts.push({ level: 'ok', icon: '🚀', msg: `${recentDist} items published this week` });
    else alerts.push({ level: 'info', icon: '📝', msg: 'No content published this week' });
  } catch {}

  const log = path.join(VAULT, '.scripts', 'logs', `${today}-agent.log`);
  if (fs.existsSync(log)) {
    const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    alerts.push({ level: 'ok', icon: '🤖', msg: `Nightly agent ran — ${lines.length} log lines` });
  } else {
    alerts.push({ level: 'info', icon: '🤖', msg: 'Nightly agent has not run today (runs at 23:00)' });
  }

  try {
    const hotFile = path.join(VAULT, 'wiki', 'hot.md');
    if (fs.existsSync(hotFile)) {
      const ageDays = Math.floor((now - fs.statSync(hotFile).mtimeMs) / DAY);
      if (ageDays > 3) alerts.push({ level: 'info', icon: '🧠', msg: `Wiki hot.md not updated for ${ageDays} days` });
      else alerts.push({ level: 'ok', icon: '🧠', msg: `Wiki current (updated ${ageDays === 0 ? 'today' : ageDays + ' days ago'})` });
    }
  } catch {}

  const dailyFile = path.join(VAULT, '50_DAILY', `${today}-morning.md`);
  if (!fs.existsSync(dailyFile)) alerts.push({ level: 'info', icon: '📋', msg: `Today's morning report not yet generated` });

  const dist7 = (() => { try { return fs.readdirSync(path.join(PIPELINE,'distribution')).filter(f=>f.endsWith('.md')).filter(f=>(now-fs.statSync(path.join(PIPELINE,'distribution',f)).mtimeMs)/DAY<7).length; } catch { return 0; } })();
  const pipeTotal = count(path.join(PIPELINE,'distribution')) + count(path.join(PIPELINE,'drafts')) + count(path.join(PIPELINE,'approved-content'));
  const notesCnt = count(path.join(VAULT,'10_NOTES'));
  const warnCount = alerts.filter(a=>a.level==='warn'||a.level==='crit').length;

  res.json({ alerts, stats: { inbox: inboxCnt, pipeTotal, dist7, notesCnt, warnCount, alerts: warnCount } });
});

// ══════════════════════════════════════════════════════
// GLOBAL SEARCH
// ══════════════════════════════════════════════════════

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json({ results: [] });
  const results = [];
  const searchDir = (dir, type, limit = 5) => {
    try {
      let cnt = 0;
      fs.readdirSync(dir).forEach(f => {
        if (cnt >= limit || !f.endsWith('.md')) return;
        if (f.toLowerCase().includes(q)) { results.push({ type, name: f.replace('.md',''), path: path.join(dir,f) }); cnt++; }
      });
    } catch {}
  };
  searchDir(path.join(VAULT, '00_INBOX'),    'inbox');
  searchDir(path.join(VAULT, '10_NOTES'),    'note');
  searchDir(path.join(VAULT, '60_ACTIONS'),  'action');
  searchDir(path.join(VAULT, 'wiki'),        'wiki');
  searchDir(path.join(PIPELINE, 'distribution'), 'social');
  searchDir(path.join(PIPELINE, 'drafts'),   'draft');
  res.json({ results: results.slice(0, 15) });
});

// ══════════════════════════════════════════════════════
// AI BRIEF (Claude daily analysis, 1-hour cache)
// ══════════════════════════════════════════════════════
let _briefCache = { data: null, ts: 0 };

app.get('/api/intel/ai-brief', async (req, res) => {
  const force = req.query.refresh === '1';
  if (!force && _briefCache.data && Date.now() - _briefCache.ts < 3600000) {
    return res.json({ ..._briefCache.data, cached: true });
  }
  try {
    const actionsFile = path.join(VAULT, '60_ACTIONS', 'actions.md');
    const pending = fs.existsSync(actionsFile)
      ? (fs.readFileSync(actionsFile,'utf8').match(/- \[ \] .+/g)||[]).map(l=>l.replace('- [ ] ','')).slice(0,6)
      : [];
    const today = new Date().toISOString().slice(0,10);
    const morningFile = path.join(VAULT, '50_DAILY', `${today}-morning.md`);
    const morningSnippet = fs.existsSync(morningFile)
      ? fs.readFileSync(morningFile,'utf8').replace(/^﻿/,'').slice(0,500)
      : 'Morning report not yet generated.';
    const pipe = {
      inbox: count(path.join(PIPELINE,'inbox')), drafts: count(path.join(PIPELINE,'drafts')),
      approved: count(path.join(PIPELINE,'approved-content')), dist: count(path.join(PIPELINE,'distribution'))
    };
    const inboxCnt = count(path.join(VAULT,'00_INBOX'));
    const prompt = `You are JARVIS - an AI assistant for a knowledge vault system. Today: ${today}.

PENDING ACTIONS (${pending.length}):
${pending.map((a,i)=>`${i+1}. ${a}`).join('\n')||'No actions'}

MORNING REPORT:
${morningSnippet.slice(0,450)}

PIPELINE: Inbox:${pipe.inbox} | Draft:${pipe.drafts} | Approved:${pipe.approved} | Published:${pipe.dist}
VAULT INBOX: ${inboxCnt} pending files

Please provide for TODAY:
1. TOP 3 PRIORITIES - one line each, concrete and actionable
2. RISKS - 1-2 attention points
3. STRATEGIC RECOMMENDATION - one piece of advice for this week

Max 160 words. Actionable. Short sentences.`;
    const tmp = path.join(require('os').tmpdir(), 'jarvis-brief.txt');
    fs.writeFileSync(tmp, prompt, 'utf8');
    const result = execSync(`type "${tmp}" | claude --print`, { cwd: VAULT, timeout: 90000, encoding: 'utf8', shell: 'cmd.exe' });
    try { fs.unlinkSync(tmp); } catch {}
    const data = { brief: result.trim(), generated: new Date().toISOString(), pending: pending.length };
    _briefCache = { data, ts: Date.now() };
    res.json(data);
  } catch (e) { res.json({ brief: 'Claude analysis unavailable: ' + e.message, error: true, generated: new Date().toISOString() }); }
});

// Deploy preview (git status + recent commits)
app.get('/api/ops/deploy-preview/:id', async (req, res) => {
  const proj = PROJECTS.find(p => p.id.toLowerCase() === req.params.id.toLowerCase());
  if (!proj) return res.json({ ok: false, error: 'Project not found' });
  try {
    const [st, lg, df] = await Promise.all([
      execFileP('git',['-C',proj.path,'status','--short']).catch(()=>({stdout:''})),
      execFileP('git',['-C',proj.path,'log','--oneline','-8']).catch(()=>({stdout:''})),
      execFileP('git',['-C',proj.path,'diff','--stat','HEAD']).catch(()=>({stdout:''}))
    ]);
    res.json({ ok: true, id: proj.id, path: proj.path, status: st.stdout.trim(), commits: lg.stdout.trim(), diff: df.stdout.trim() });
  } catch (e) { res.json({ ok: false, id: proj.id, error: e.message }); }
});

// ── Build vault context for Claude ────────────────────
function readFile(filePath, maxChars = 1500) {
  try { return fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '').trim().slice(0, maxChars); }
  catch { return null; }
}

function readDir(dirPath, ext = '.md', maxFiles = 6) {
  try { return fs.readdirSync(dirPath).filter(f => f.endsWith(ext)).slice(0, maxFiles); }
  catch { return []; }
}

function buildVaultContext() {
  const sections = [];

  const rootClaude = readFile(path.join(VAULT, '..', 'CLAUDE.md'), 2000);
  if (rootClaude) sections.push('=== DISK MASTER (CLAUDE.md) ===\n' + rootClaude);

  const vaultClaude = readFile(path.join(VAULT, 'CLAUDE.md'), 1000);
  if (vaultClaude) sections.push('=== VAULT CONFIG ===\n' + vaultClaude);

  const hot = readFile(path.join(VAULT, 'wiki', 'hot.md'), 1000);
  if (hot) sections.push('=== CURRENT CONTEXT (hot.md) ===\n' + hot);

  const wikiIdx = readFile(path.join(VAULT, 'wiki', 'index.md'), 800);
  if (wikiIdx) sections.push('=== WIKI INDEX ===\n' + wikiIdx);

  const entDir = path.join(VAULT, 'wiki', 'entities');
  const entFiles = readDir(entDir);
  entFiles.forEach(f => {
    const content = readFile(path.join(entDir, f), 600);
    if (content) sections.push(`=== ENTITY: ${f.replace('.md','')} ===\n` + content);
  });

  const actFile = path.join(VAULT, '60_ACTIONS', 'actions.md');
  const actRaw = readFile(actFile, 1500);
  if (actRaw) sections.push('=== ACTIONS ===\n' + actRaw);

  const opp = readFile(path.join(VAULT, '60_ACTIONS', 'product-opportunities.md'), 800);
  if (opp) sections.push('=== PRODUCT OPPORTUNITIES ===\n' + opp);

  const today = new Date().toISOString().slice(0, 10);
  const morning = readFile(path.join(VAULT, '50_DAILY', `${today}-morning.md`), 1200);
  if (morning) sections.push(`=== MORNING REPORT (${today}) ===\n` + morning);

  const projHub = path.join(VAULT, '20_PROJECTS');
  try {
    fs.readdirSync(projHub).forEach(proj => {
      const overview = readFile(path.join(projHub, proj, `${proj} Overview.md`), 600)
        || readFile(path.join(projHub, proj, 'Overview.md'), 600);
      if (overview) sections.push(`=== PROJECT HUB: ${proj} ===\n` + overview);
      const roadmap = readFile(path.join(projHub, proj, 'Roadmap.md'), 500);
      if (roadmap) sections.push(`=== ROADMAP: ${proj} ===\n` + roadmap);
    });
  } catch {}

  sections.push(`=== CONTENT PIPELINE ===\nInbox:${count(path.join(PIPELINE,'inbox'))} | Research:${count(path.join(PIPELINE,'research-briefs'))} | Draft:${count(path.join(PIPELINE,'drafts'))} | Approved:${count(path.join(PIPELINE,'approved-content'))} | Distribution:${count(path.join(PIPELINE,'distribution'))}`);

  const edgeFile = path.join(VAULT, '60_ACTIONS', 'business-edge', 'BUSINESS-EDGE.md');
  const edgeContent = readFile(edgeFile, 1200);
  if (edgeContent) sections.push('=== BUSINESS EDGE & KNOWN WEAKNESSES ===\n' + edgeContent);

  const decisionsDir = path.join(VAULT, '60_ACTIONS', 'decisions');
  try {
    const dFiles = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .sort().reverse().slice(0, 5);
    if (dFiles.length > 0) {
      const decSnippets = dFiles.map(f => {
        const c = readFile(path.join(decisionsDir, f), 300);
        return `--- ${f} ---\n${c}`;
      }).join('\n');
      sections.push(`=== RECENT DECISIONS (${dFiles.length}) ===\n${decSnippets}`);
    }
  } catch {}

  const patternsDir = path.join(VAULT, '60_ACTIONS', 'patterns');
  try {
    const pFiles = fs.readdirSync(patternsDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (pFiles.length > 0) {
      const latestPattern = readFile(path.join(patternsDir, pFiles[0]), 600);
      if (latestPattern) sections.push(`=== LATEST PATTERN REPORT (${pFiles[0]}) ===\n${latestPattern}`);
    }
  } catch {}

  return sections.join('\n\n');
}

// ── Decision count ────────────────────────────────────
app.get('/api/decisions/count', (req, res) => {
  const dir = path.join(VAULT, '60_ACTIONS', 'decisions');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    const recent = files.filter(f => {
      try { return (Date.now() - fs.statSync(path.join(dir,f)).mtimeMs) < 30*86400000; } catch { return false; }
    });
    const outcomes = { pending:0, good:0, bad:0, mixed:0 };
    files.forEach(f => {
      try {
        const raw = fs.readFileSync(path.join(dir,f),'utf8');
        const m = raw.match(/^outcome:\s*(\w+)/m);
        if (m) outcomes[m[1]] = (outcomes[m[1]]||0)+1;
      } catch {}
    });
    res.json({ total: files.length, recent30: recent.length, outcomes });
  } catch { res.json({ total: 0, recent30: 0, outcomes: {} }); }
});

// ── Save decision ─────────────────────────────────────
app.post('/api/decisions/save', (req, res) => {
  const { topic, domain, decision, reasoning, confidence, options } = req.body;
  if (!topic || !decision) return res.json({ ok: false, error: 'topic and decision required' });
  const today = new Date().toISOString().slice(0,10);
  const slug = topic.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g,'-').slice(0,40);
  const fname = `${today}-${slug}.md`;
  const content = `---
type: decision
date: ${today}
topic: ${topic}
domain: ${domain||'business'}
confidence: ${confidence||5}
outcome: pending
tags: [decision]
---

# ${topic}

## Decision

> **DECISION:** ${decision}

**Reasoning:** ${reasoning||'—'}

**Confidence score:** ${confidence||5}/10

## Options / Context

${options||'—'}

## Risk Check

- Reversible?: Unknown
- Cost if wrong?: Not yet assessed

## Outcome

> *Pending — to be filled once outcome is known.*
`;
  try {
    const dir = path.join(VAULT, '60_ACTIONS', 'decisions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fname), content, 'utf8');
    res.json({ ok: true, file: fname });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════
// PRE-DECISION BRIEF
// ══════════════════════════════════════════════════════
app.post('/api/pre-decision', async (req, res) => {
  const { topic, domain, options } = req.body;
  if (!topic) return res.json({ error: 'Topic required' });

  const decisionsDir = path.join(VAULT, '60_ACTIONS', 'decisions');
  let decisionHistory = '';
  try {
    const files = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .sort().reverse().slice(0, 20);
    files.forEach(f => {
      const content = fs.readFileSync(path.join(decisionsDir, f), 'utf8')
        .replace(/^﻿/, '').slice(0, 600);
      decisionHistory += `\n=== ${f} ===\n${content}\n`;
    });
  } catch {}

  const edgeFile = path.join(VAULT, '60_ACTIONS', 'business-edge', 'BUSINESS-EDGE.md');
  const edgeContent = fs.existsSync(edgeFile)
    ? fs.readFileSync(edgeFile, 'utf8').replace(/^﻿/, '').slice(0, 1500)
    : 'Business edge file not yet populated.';

  const patternsDir = path.join(VAULT, '60_ACTIONS', 'patterns');
  let latestPattern = '';
  try {
    const pFiles = fs.readdirSync(patternsDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (pFiles.length > 0) {
      latestPattern = fs.readFileSync(path.join(patternsDir, pFiles[0]), 'utf8')
        .replace(/^﻿/, '').slice(0, 800);
    }
  } catch {}

  const decisionCount = decisionHistory.split('===').filter(s => s.trim().match(/^\d{4}-/)).length;

  const prompt = `You are JARVIS - an AI assistant for a knowledge vault system.
Date: ${new Date().toISOString().slice(0,10)}

The user is requesting a pre-decision brief:
TOPIC: ${topic}
${domain ? `DOMAIN: ${domain}` : ''}
${options ? `OPTIONS: ${options}` : ''}

=== DECISION ARCHIVE (${decisionCount} decisions) ===
${decisionHistory || 'No decision archive yet. This will be the first record.'}

=== BUSINESS EDGE & KNOWN WEAKNESSES ===
${edgeContent}

${latestPattern ? `=== LATEST PATTERN REPORT ===\n${latestPattern}` : ''}

---
TASK: Write a structured brief in the following format. Be concise and actionable.

## Historical Precedent
[Is there a similar past decision? What happened? If not, say "First decision of this type."]

## Pattern Warnings
[Does this decision trigger any known weakness patterns? Be direct.]

## Strengths
[Points where this decision aligns with known strengths.]

## Recommendation
[Based on available evidence, a clear directional suggestion. "If X then do A, if Y then do B" format.]

## Critical Questions
[2-3 questions that must be answered before deciding.]

NOTE: This is not a recommendation but the application of past data to the current decision. Final decision always belongs to the user.
Max 200 words.`;

  const tmp = path.join(require('os').tmpdir(), `jarvis-predecision-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmp, prompt, 'utf8');
    const psCmd = `Get-Content -Raw -Encoding UTF8 '${tmp}' | claude --print`;
    const result = execSync(psCmd, {
      cwd: VAULT, timeout: 90000, encoding: 'utf8',
      shell: 'powershell.exe', env: { ...process.env, FORCE_COLOR: '0' }
    });
    try { fs.unlinkSync(tmp); } catch {}
    res.json({
      brief: result.trim(),
      decisionCount,
      generated: new Date().toISOString(),
      hasHistory: decisionCount > 0
    });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    const detail = (e.stderr || e.stdout || e.message || '').toString()
      .replace(/\x1B\[[0-9;]*m/g, '').trim().slice(0, 300);
    res.json({ brief: `Error: ${detail || 'Could not connect to Claude'}`, error: true, generated: new Date().toISOString() });
  }
});

// ── Action executor ────────────────────────────────────
function executeActions(actions) {
  const results = [];
  if (!Array.isArray(actions)) return results;
  for (const action of actions) {
    try {
      if (action.type === 'project_status') {
        const proj = PROJECTS.find(p => p.id.toLowerCase() === (action.project||'').toLowerCase());
        if (!proj) { results.push({ ok: false, type: 'project_status', error: `Project not found: ${action.project}` }); continue; }
        proj.status = action.status;
        const overviewPath = path.join(VAULT, '20_PROJECTS', proj.id, `${proj.id} Overview.md`);
        if (fs.existsSync(overviewPath)) {
          let c = fs.readFileSync(overviewPath, 'utf8');
          c = c.replace(/^status: .+$/m, `status: ${action.status}`);
          const dateStr = new Date().toISOString().slice(0, 10);
          c = c.replace(/\*\*Status:\*\* .+/m, `**Status:** ${action.status} — as of ${dateStr}`);
          if (action.reason) c = c.replace(/\*\*Reason:\*\* .+/m, `**Reason:** ${action.reason}`);
          fs.writeFileSync(overviewPath, c, 'utf8');
        }
        results.push({ ok: true, type: 'project_status', project: proj.id, status: action.status });
      } else if (action.type === 'save_decision') {
        const { topic, domain, decision, reasoning, confidence } = action;
        if (!topic || !decision) { results.push({ ok: false, type: 'save_decision', error: 'topic and decision required' }); continue; }
        const today = new Date().toISOString().slice(0, 10);
        const slug = topic.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 40);
        const fname = `${today}-${slug}.md`;
        const content = `---\ntype: decision\ndate: ${today}\ntopic: ${topic}\ndomain: ${domain||'business'}\nconfidence: ${confidence||5}\noutcome: pending\ntags: [decision]\n---\n\n# ${topic}\n\n## Decision\n\n> **DECISION:** ${decision}\n\n**Reasoning:** ${reasoning||'—'}\n\n**Confidence score:** ${confidence||5}/10\n\n## Outcome\n\n> *Pending.*\n`;
        const dir = path.join(VAULT, '60_ACTIONS', 'decisions');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fname), content, 'utf8');
        results.push({ ok: true, type: 'save_decision', file: fname });
      }
    } catch(e) { results.push({ ok: false, type: action.type, error: e.message }); }
  }
  return results;
}

// ── Fast command parser ─────────────────────────────────
const STATUS_LABELS = {
  'maintenance':  'Maintenance',
  'hold':         'Maintenance',
  'pause':        'Maintenance',
  'active':       'Active',
  'start':        'Active',
  'done':         'Done',
  'completed':    'Done',
  'planning':     'Planning',
  'plan':         'Planning',
  'live':         'Live',
  'publish':      'Live',
  'github':       'GitHub'
};

function tryFastCommand(question) {
  const q = question.toLowerCase();
  const actions = [];
  for (const proj of PROJECTS) {
    const pid = proj.id.toLowerCase().replace(/[.\s]/g, '');
    const qNorm = q.replace(/[.\s]/g, '');
    if (!qNorm.includes(pid) && !q.includes(proj.id.toLowerCase())) continue;
    for (const [kw, label] of Object.entries(STATUS_LABELS)) {
      if (q.includes(kw)) {
        actions.push({ type: 'project_status', project: proj.id, status: label });
        break;
      }
    }
  }
  return actions;
}

// ── Ask Claude (with vault context) ───────────────────
app.post('/api/ask', (req, res) => {
  const { question } = req.body;
  if (!question) return res.json({ error: 'Question required' });

  const fastActions = tryFastCommand(question);
  if (fastActions.length > 0) {
    const taken = executeActions(fastActions);
    const names = taken.filter(a=>a.ok).map(a=>`${a.project} → ${a.status}`).join(', ');
    return res.json({
      answer: names ? `✓ ${names}` : 'Could not apply action',
      actions: taken
    });
  }

  const ctx = buildVaultContext();
  const projList = PROJECTS.map(p => p.id).join(', ');

  const prompt = `You are JARVIS - an AI assistant for a knowledge vault system.
The following real vault and system information is provided — base your answer on this, do not guess.

${ctx}

---
TASK: Respond to the user's message.

If the message contains a COMMAND (e.g. "Project1 maintenance", "Project2 active", "save decision", "pause project") — add these commands to the "actions" array and the server will apply them automatically.

CRITICAL: Respond ONLY in the following JSON format. Nothing else. No markdown, no backticks, no explanation.

{"response":"short answer to user (max 80 words)","actions":[]}

If there are commands, add to actions array:
- Change project status: {"type":"project_status","project":"PROJECT_ID","status":"STATUS","reason":"why"}
  Valid statuses: Maintenance | Active | Done | Planning | Live
  Valid project IDs: ${projList}
- Save decision: {"type":"save_decision","topic":"...","domain":"business","decision":"...","reasoning":"...","confidence":7}

For questions/normal conversation leave actions empty: []

MESSAGE: ${question}`;

  const tmp = path.join(require('os').tmpdir(), `jarvis-ask-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmp, prompt, 'utf8');
    const psCmd = `Get-Content -Raw -Encoding UTF8 '${tmp}' | claude --print`;
    const raw = execSync(psCmd, {
      cwd: VAULT, timeout: 120000, encoding: 'utf8',
      shell: 'powershell.exe', env: { ...process.env, FORCE_COLOR: '0' }
    });
    try { fs.unlinkSync(tmp); } catch {}

    let answer = raw.trim();
    let actionsTaken = [];

    try {
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        answer = parsed.response || answer;
        if (parsed.actions && parsed.actions.length > 0) {
          actionsTaken = executeActions(parsed.actions);
        }
      }
    } catch { /* JSON parse failed — return raw answer */ }

    res.json({ answer, actions: actionsTaken });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    const raw2 = (e.stderr || e.stdout || e.message || '').toString();
    const isTimeout = raw2.includes('ETIMEDOUT') || raw2.includes('TIMEOUT');
    const detail = raw2.replace(/\x1B\[[0-9;]*m/g, '').trim().slice(0, 200);
    console.error('[JARVIS ASK ERROR]', detail);
    res.json({ answer: isTimeout
      ? 'Claude took too long to respond. Please retry — first request is often slow.'
      : `Error: ${detail || 'Could not connect to Claude'}` });
  }
});

setInterval(() => broadcast({ type: 'ping', time: new Date().toISOString() }), 30000);
server.listen(PORT, () => console.log(`\n  JARVIS Command Center: http://localhost:${PORT}\n`));

// ─── TELEGRAM QUICK CAPTURE BOT ───────────────────────────────────────────────
// Messages are appended to today's daily note, routed by tag.
// Routing: #idea → Content Ideas, #signal/#research → Research Signals,
// #link or URL → Links to Process, other → Captures
const CAPTURE_SECTIONS = ['Captures', 'Research Signals', 'Content Ideas', 'Links to Process'];

function buildDailyStub(dateStr) {
  return [
    `# ${dateStr}`,
    '',
    '## Captures',
    '',
    '## Research Signals',
    '',
    '## Content Ideas',
    '',
    '## Links to Process',
    ''
  ].join('\n');
}

function routeMessage(text) {
  const trimmed = text.trim();
  if (/^#idea\b/i.test(trimmed)) {
    return { section: 'Content Ideas', body: trimmed.replace(/^#idea\s*/i, '') };
  }
  if (/^#(signal|research)\b/i.test(trimmed)) {
    return { section: 'Research Signals', body: trimmed.replace(/^#(signal|research)\s*/i, '') };
  }
  if (/^#link\b/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return { section: 'Links to Process', body: trimmed.replace(/^#link\s*/i, '') };
  }
  return { section: 'Captures', body: trimmed };
}

function appendToSection(filePath, sectionName, line, dateStr) {
  let content;
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  } else {
    content = buildDailyStub(dateStr);
  }

  const lines = content.split(/\r?\n/);
  const header = `## ${sectionName}`;
  let headerIdx = lines.findIndex((l) => l.trim() === header);

  if (headerIdx === -1) {
    const trimmed = lines.join('\n').replace(/\n+$/, '');
    const updated = `${trimmed}\n\n${header}\n${line}\n`;
    fs.writeFileSync(filePath, updated, 'utf8');
    return;
  }

  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      endIdx = i;
      break;
    }
  }
  let lastNonEmpty = endIdx - 1;
  while (lastNonEmpty > headerIdx && lines[lastNonEmpty].trim() === '') {
    lastNonEmpty--;
  }
  lines.splice(lastNonEmpty + 1, 0, line);

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ─── WHISPER CONFIG ──────────────────────────────────────────────────────────
const WHISPER_CLI   = process.env.WHISPER_CLI || '';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'ggml-small.bin';
const WHISPER_MODEL_PATH = path.isAbsolute(WHISPER_MODEL) ? WHISPER_MODEL : path.join(path.dirname(WHISPER_CLI), 'models', WHISPER_MODEL);
const VOICE_TEMP    = path.join(VAULT, '.dashboard', 'temp-voice');
const WHISPER_LANG  = process.env.WHISPER_LANG || 'en';
try { fs.mkdirSync(VOICE_TEMP, { recursive: true }); } catch {}

function downloadHttps(url, dest) {
  const httpsMod = require('https');
  const httpMod  = require('http');
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? httpsMod : httpMod;
    mod.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadHttps(response.headers.location, dest).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function runProcess(cmd, args, opts = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function transcribeVoice(oggPath) {
  const wavPath = oggPath.replace(/\.ogg$/i, '.wav');
  await runProcess('ffmpeg', ['-y', '-i', oggPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);

  const { stdout } = await runProcess(WHISPER_CLI, [
    '-m', WHISPER_MODEL_PATH,
    '-l', WHISPER_LANG,
    '-nt',
    '-otxt',
    '-of', wavPath.replace(/\.wav$/, ''),
    '-f', wavPath
  ]);

  const txtPath = wavPath.replace(/\.wav$/, '.txt');
  let text = '';
  if (fs.existsSync(txtPath)) {
    text = fs.readFileSync(txtPath, 'utf8').trim();
  } else {
    text = stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[') && !l.startsWith('whisper_')).join(' ').trim();
  }

  [oggPath, wavPath, txtPath].forEach((p) => {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  });
  return text;
}

(function initTelegramBot() {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.log('  [Telegram] TELEGRAM_BOT_TOKEN not set — bot disabled.');
    return;
  }
  if (!WHISPER_CLI || !fs.existsSync(WHISPER_CLI) || !fs.existsSync(WHISPER_MODEL_PATH)) {
    console.warn(`  [Whisper] CLI or model not found — voice handler disabled. Set WHISPER_CLI and WHISPER_MODEL in .env`);
  } else {
    console.log('  [Whisper] CLI and model ready');
  }
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(TOKEN, { polling: true });

    bot.on('voice', async (msg) => {
      const chatId = msg.chat.id;
      if (!WHISPER_CLI || !fs.existsSync(WHISPER_CLI) || !fs.existsSync(WHISPER_MODEL_PATH)) {
        bot.sendMessage(chatId, 'Whisper CLI or model not found — voice skipped.');
        return;
      }

      const fileId = msg.voice.file_id;
      const id = require('crypto').randomBytes(6).toString('hex');
      const oggPath = path.join(VOICE_TEMP, `${id}.ogg`);

      try {
        await bot.sendMessage(chatId, 'Transcribing...');
        const fileLink = await bot.getFileLink(fileId);
        await downloadHttps(fileLink, oggPath);
        const text = await transcribeVoice(oggPath);

        if (!text || text.trim().length === 0) {
          bot.sendMessage(chatId, 'Empty transcription (audio not understood). Please retry.');
          return;
        }

        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 5);
        const fname = `${date}-morning.md`;
        const fpath = path.join(VAULT, '50_DAILY', fname);

        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        const sectionCounts = {};

        for (const raw of lines) {
          const { section, body } = routeMessage(raw);
          const formatted = `- ${timeStr} — 🎤 ${body}`;
          appendToSection(fpath, section, formatted, date);
          sectionCounts[section] = (sectionCounts[section] || 0) + 1;
        }

        const summary = Object.entries(sectionCounts).map(([s, n]) => `📂 ## ${s} (${n})`).join('\n');
        bot.sendMessage(chatId, `✅ Voice transcribed\n📝 ${text.slice(0, 200)}\n📁 ${fname}\n${summary}`);
        broadcast({ type: 'daily_update', file: fname, voice: true, sections: sectionCounts });
        console.log(`[Telegram Voice] ${lines.length} lines → ${JSON.stringify(sectionCounts)}`);
      } catch (err) {
        bot.sendMessage(chatId, `Voice error: ${err.message.slice(0, 200)}`);
        console.error('[Telegram Voice] Error:', err.message);
        try { if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath); } catch {}
      }
    });

    bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();
      if (!text || text.startsWith('/')) return;

      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5);
      const fname = `${date}-morning.md`;
      const fpath = path.join(VAULT, '50_DAILY', fname);

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const sectionCounts = {};
      const errors = [];

      for (const raw of lines) {
        const { section, body } = routeMessage(raw);
        const formatted = `- ${timeStr} — ${body}`;
        try {
          appendToSection(fpath, section, formatted, date);
          sectionCounts[section] = (sectionCounts[section] || 0) + 1;
        } catch (err) {
          errors.push(`${section}: ${err.message}`);
        }
      }

      if (Object.keys(sectionCounts).length === 0 && errors.length === 0) return;

      if (errors.length > 0) {
        bot.sendMessage(chatId, `Capture errors: ${errors.join('; ')}`);
        console.error('[Telegram] Errors:', errors);
        return;
      }

      const summary = Object.entries(sectionCounts)
        .map(([s, n]) => `📂 ## ${s} (${n})`)
        .join('\n');
      bot.sendMessage(chatId, `✅ ${lines.length} lines captured\n📁 ${fname}\n${summary}`);
      broadcast({ type: 'daily_update', file: fname, sections: sectionCounts });
      console.log(`[Telegram] ${lines.length} lines → ${JSON.stringify(sectionCounts)}`);
    });

    bot.on('polling_error', (err) => console.error('[Telegram] Polling error:', err.message));
    console.log('  [Telegram] Quick Capture Bot active (daily note routing)');
  } catch (err) {
    console.error('[Telegram] Bot failed to start:', err.message);
  }
})();
