const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const DATA_FILE = './data.json';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: [{ id: 'user_001', name: 'Sparki', gold: 100, streak_days: 0, max_streak: 0, today_gold: 0, last_checkin_date: null }], tasks: [], tasklists: [], expenses: [], shopItems: [], events: [] }; }
}

function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

let db = loadData();
let userAccessTokenCache = { token: null, expireAt: 0 };
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || 'https://sparki-backend-osgd.onrender.com/api/feishu/oauth/callback';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, version: '5.0.0', features: ['oauth', 'sync', 'webhook'], data: { tasks: db.tasks.length, tasklists: db.tasklists.length } });
});

app.get('/api/user', (req, res) => {
  const u = db.users[0];
  res.json({ id: u.id, name: u.name, gold: u.gold, streak_days: u.streak_days, max_streak: u.max_streak, today_gold: u.today_gold, last_checkin_date: u.last_checkin_date, feishu_connected: !!FEISHU_APP_ID });
});

app.post('/api/user/update-gold', (req, res) => {
  db.users[0].gold += req.body.gold_delta;
  saveData(db);
  res.json({ gold: db.users[0].gold });
});

app.get('/api/tasks', (req, res) => { res.json({ tasks: db.tasks }); });

app.post('/api/tasks', async (req, res) => {
  const { title, description, due_date, gold_reward = 5, difficulty = 'low', tasklist_id } = req.body;
  const id = 'sparki_' + Date.now();
  let feishuGuid = null;
  if (userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) {
    try {
      const body = { task: { summary: title, description: description || '' } };
      if (due_date) body.task.due = { timestamp: new Date(due_date).getTime().toString(), timezone: 'Asia/Shanghai' };
      const r = await fetch(FEISHU_API + '/task/v2/tasks', { method: 'POST', headers: { 'Authorization': 'Bearer ' + userAccessTokenCache.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.code === 0 && d.data && d.data.task) feishuGuid = d.data.task.guid;
    } catch (e) { console.error('Create Feishu task failed:', e.message); }
  }
  db.tasks.push({ id, title, description: description || '', due_date: due_date || null, gold_reward, difficulty, status: 'todo', source: feishuGuid ? 'feishu' : 'local', feishu_guid: feishuGuid, feishu_tasklist_guid: tasklist_id || null, user_id: 'user_001', completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  saveData(db);
  res.json({ id, title, status: 'todo', gold_reward, feishu_synced: !!feishuGuid });
});

app.patch('/api/tasks/:id', async (req, res) => {
  const t = db.tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const { status, title, description, due_date } = req.body;
  if (t.source === 'feishu' && t.feishu_guid && userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) {
    try {
      const body = { task: {} };
      if (title !== undefined) body.task.summary = title;
      if (description !== undefined) body.task.description = description;
      if (status !== undefined) body.task.completed = status === 'done';
      if (due_date) body.task.due = { timestamp: new Date(due_date).getTime().toString(), timezone: 'Asia/Shanghai' };
      await fetch(FEISHU_API + '/task/v2/tasks/' + t.feishu_guid, { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + userAccessTokenCache.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { console.error('Update Feishu task failed:', e.message); }
  }
  if (status !== undefined) { t.status = status; t.completed_at = status === 'done' ? new Date().toISOString() : null; }
  if (title !== undefined) t.title = title;
  if (description !== undefined) t.description = description;
  if (due_date !== undefined) t.due_date = due_date;
  t.updated_at = new Date().toISOString();
  saveData(db);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
  const t = db.tasks.find(x => x.id === req.params.id);
  if (t && t.source === 'feishu' && t.feishu_guid && userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) {
    try { await fetch(FEISHU_API + '/task/v2/tasks/' + t.feishu_guid, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + userAccessTokenCache.token } }); }
    catch (e) { console.error('Delete Feishu task failed:', e.message); }
  }
  db.tasks = db.tasks.filter(x => x.id !== req.params.id);
  saveData(db);
  res.json({ ok: true });
});

app.get('/api/tasklists', (req, res) => { res.json({ tasklists: db.tasklists }); });
app.post('/api/tasklists', (req, res) => { const id = 'list_' + Date.now(); db.tasklists.push({ id, name: req.body.name, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); saveData(db); res.json({ id, name: req.body.name }); });
app.get('/api/expenses', (req, res) => { res.json({ expenses: db.expenses }); });
app.post('/api/expenses', (req, res) => { const id = 'exp_' + Date.now(); db.expenses.push({ id, description: req.body.description, amount: req.body.amount, type: req.body.type, category: req.body.category, date: req.body.date, user_id: 'user_001', created_at: new Date().toISOString() }); saveData(db); res.json({ id }); });
app.get('/api/shopitems', (req, res) => { res.json({ items: db.shopItems }); });
app.post('/api/shopitems/:id/purchase', (req, res) => { const item = db.shopItems.find(x => x.id === req.params.id); if (item) { item.purchased = true; item.purchased_at = new Date().toISOString(); saveData(db); } res.json({ ok: true }); });

app.post('/api/webhook/feishu', async (req, res) => {
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  const eventType = req.body.header ? req.body.header.event_type : (req.body.event ? req.body.event.type : null);
  const event = req.body.event;
  if (!eventType || !event) return res.json({ ok: true });
  console.log('[Webhook] Event:', eventType);
  try {
    switch (eventType) {
      case 'task.task.created': case 'task.created': {
        const task = event.task; if (!task || !task.guid) break;
        if (!db.tasks.find(t => t.feishu_guid === task.guid)) {
          db.tasks.push({ id: 'feishu_' + Date.now(), title: task.summary || '未命名任务', description: task.description || '', status: task.completed ? 'done' : 'todo', source: 'feishu', feishu_guid: task.guid, feishu_tasklist_guid: task.tasklist ? task.tasklist.guid : null, user_id: 'user_001', gold_reward: 5, difficulty: 'medium', due_date: task.due && task.due.timestamp ? new Date(parseInt(task.due.timestamp)).toISOString().split('T')[0] : null, completed_at: task.completed ? new Date().toISOString() : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          saveData(db); console.log('[Webhook] Created:', task.summary);
        }
        break;
      }
      case 'task.task.completed': case 'task.completed': {
        const task = event.task; if (!task || !task.guid) break;
        const t = db.tasks.find(x => x.feishu_guid === task.guid);
        if (t) { t.status = 'done'; t.completed_at = new Date().toISOString(); t.updated_at = new Date().toISOString(); saveData(db); }
        break;
      }
      case 'task.task.updated': case 'task.updated': {
        const task = event.task; if (!task || !task.guid) break;
        const t = db.tasks.find(x => x.feishu_guid === task.guid);
        if (t) { if (task.summary !== undefined) t.title = task.summary; if (task.description !== undefined) t.description = task.description; t.updated_at = new Date().toISOString(); saveData(db); }
        break;
      }
      case 'task.task.deleted': case 'task.deleted': {
        const guid = event.task ? (event.task.guid || event.task_guid) : null; if (!guid) break;
        db.tasks = db.tasks.filter(x => x.feishu_guid !== guid); saveData(db); console.log('[Webhook] Deleted:', guid);
        break;
      }
    }
  } catch (err) { console.error('[Webhook] Error:', err.message); }
  res.json({ ok: true });
});

app.get('/api/feishu/oauth/url', (req, res) => {
  if (!FEISHU_APP_ID) return res.status(500).json({ error: 'FEISHU_APP_ID not configured' });
  const url = FEISHU_API + '/authen/v1/index?redirect_uri=' + encodeURIComponent(FEISHU_REDIRECT_URI) + '&app_id=' + FEISHU_APP_ID + '&scope=task:tasklist:read%20task:task:read%20task:tasklist:write%20task:task:write&state=sparki_' + Date.now();
  res.json({ url });
});

app.get('/api/feishu/oauth/callback', async (req, res) => {
  if (!req.query.code) return res.status(400).json({ error: 'Missing code' });
  try {
    const r = await fetch(FEISHU_API + '/authen/v1/oidc/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code: req.query.code, app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }) });
    const d = await r.json();
    if (d.code !== 0 || !d.data || !d.data.access_token) return res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(d.msg || 'Token failed'));
    userAccessTokenCache = { token: d.data.access_token, expireAt: Date.now() + (d.data.expire || 7200) * 1000 };
    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=success');
  } catch (e) { res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(e.message)); }
});

app.get('/api/feishu/oauth/status', (req, res) => { res.json({ authorized: !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) }); });

app.post('/api/feishu/sync', async (req, res) => {
  const debug = { steps: [] };
  try {
    const hasToken = !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt);
    if (!hasToken) return res.status(401).json({ error: 'Please authorize Feishu first', debug });
    const listsRes = await fetch(FEISHU_API + '/task/v2/tasklists?page_size=500', { headers: { 'Authorization': 'Bearer ' + userAccessTokenCache.token } });
n    const listsData = await listsRes.json();
    if (listsData.code !== 0) return res.status(500).json({ error: 'Failed: ' + (listsData.msg || 'code ' + listsData.code), debug });
    const lists = (listsData.data && listsData.data.items) ? listsData.data.items : [];
    db.tasklists = lists.map(l => ({ id: l.guid, name: l.name || '未命名清单', feishu_guid: l.guid, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    let totalNew = 0;
    for (const list of lists) {
      const tasksRes = await fetch(FEISHU_API + '/task/v2/tasklists/' + list.guid + '/tasks?page_size=500', { headers: { 'Authorization': 'Bearer ' + userAccessTokenCache.token } });
      const tasksData = await tasksRes.json();
      if (tasksData.code !== 0 || !tasksData.data || !tasksData.data.items) continue;
      for (const item of tasksData.data.items) {
        const task = item.task || item; const guid = task.guid || item.guid; if (!guid) continue;
        const existing = db.tasks.find(t => t.feishu_guid === guid);
        const taskData = { title: task.summary || '未命名任务', description: task.description || '', status: task.completed ? 'done' : 'todo', due_date: task.due && task.due.timestamp ? new Date(parseInt(task.due.timestamp)).toISOString().split('T')[0] : null, completed_at: task.completed ? new Date().toISOString() : null, feishu_tasklist_guid: list.guid, updated_at: new Date().toISOString() };
        if (existing) { Object.assign(existing, taskData); } else { db.tasks.push({ id: 'feishu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), ...taskData, feishu_guid: guid, source: 'feishu', user_id: 'user_001', gold_reward: 5, difficulty: 'medium', created_at: new Date().toISOString() }); totalNew++; }
      }
    }
    saveData(db);
    res.json({ ok: true, tasklists: lists.length, newTasks: totalNew, total: db.tasks.length, debug });
  } catch (err) { debug.steps.push('Exception: ' + err.message); res.status(500).json({ error: err.message, debug }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sparki v5.0 on port ' + PORT));
