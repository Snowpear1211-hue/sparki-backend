const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const DATA_FILE = './data.json';

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {
      users: [{ id: 'user_001', name: 'Sparki', gold: 100, streak_days: 0, max_streak: 0, today_gold: 0, last_checkin_date: null }],
      tasks: [],
      tasklists: [],
      expenses: [],
      shopItems: []
    };
  }
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

let db = loadData();
let userTokenCache = { token: null, expireAt: 0 };
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true, version: '5.0', tasks: db.tasks.length, tasklists: db.tasklists.length });
});

// User
app.get('/api/user', (req, res) => {
  const u = db.users[0];
  res.json({ id: u.id, name: u.name, gold: u.gold, streak_days: u.streak_days || 0, max_streak: u.max_streak || 0, today_gold: u.today_gold || 0, last_checkin_date: u.last_checkin_date, feishu_connected: !!APP_ID });
});

app.post('/api/user/update-gold', (req, res) => {
  db.users[0].gold += req.body.gold_delta;
  saveData(db);
  res.json({ gold: db.users[0].gold });
});

// Tasks
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: db.tasks });
});

app.post('/api/tasks', (req, res) => {
  const id = 'sparki_' + Date.now();
  db.tasks.push({
    id: id,
    title: req.body.title,
    description: req.body.description || '',
    due_date: req.body.due_date || null,
    gold_reward: req.body.gold_reward || 5,
    difficulty: req.body.difficulty || 'low',
    status: 'todo',
    source: 'local',
    feishu_guid: null,
    feishu_tasklist_guid: req.body.tasklist_id || null,
    user_id: 'user_001',
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  saveData(db);
  res.json({ id: id, title: req.body.title, status: 'todo', gold_reward: req.body.gold_reward || 5 });
});

app.patch('/api/tasks/:id', (req, res) => {
  const t = db.tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (req.body.status !== undefined) {
    t.status = req.body.status;
    t.completed_at = req.body.status === 'done' ? new Date().toISOString() : null;
  }
  if (req.body.title !== undefined) t.title = req.body.title;
  if (req.body.description !== undefined) t.description = req.body.description;
  t.updated_at = new Date().toISOString();
  saveData(db);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.tasks = db.tasks.filter(x => x.id !== req.params.id);
  saveData(db);
  res.json({ ok: true });
});

// Tasklists
app.get('/api/tasklists', (req, res) => {
  res.json({ tasklists: db.tasklists });
});

app.post('/api/tasklists', (req, res) => {
  const id = 'list_' + Date.now();
  db.tasklists.push({ id: id, name: req.body.name, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  saveData(db);
  res.json({ id: id, name: req.body.name });
});

// Expenses
app.get('/api/expenses', (req, res) => {
  res.json({ expenses: db.expenses });
});

app.post('/api/expenses', (req, res) => {
  const id = 'exp_' + Date.now();
  db.expenses.push({ id: id, description: req.body.description, amount: req.body.amount, type: req.body.type, category: req.body.category, date: req.body.date, user_id: 'user_001', created_at: new Date().toISOString() });
  saveData(db);
  res.json({ id: id });
});

// Shop
app.get('/api/shopitems', (req, res) => {
  res.json({ items: db.shopItems });
});

app.post('/api/shopitems/:id/purchase', (req, res) => {
  const item = db.shopItems.find(x => x.id === req.params.id);
  if (item) { item.purchased = true; item.purchased_at = new Date().toISOString(); saveData(db); }
  res.json({ ok: true });
});

// Webhook
app.post('/api/webhook/feishu', (req, res) => {
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  const eventType = req.body.header ? req.body.header.event_type : (req.body.event ? req.body.event.type : null);
  const event = req.body.event;
  if (!eventType || !event) return res.json({ ok: true });
  console.log('[Webhook] Event:', eventType);
  try {
    if (eventType === 'task.task.created' || eventType === 'task.created') {
      const task = event.task;
      if (task && task.guid && !db.tasks.find(t => t.feishu_guid === task.guid)) {
        db.tasks.push({ id: 'feishu_' + Date.now(), title: task.summary || 'Untitled', description: task.description || '', status: task.completed ? 'done' : 'todo', source: 'feishu', feishu_guid: task.guid, feishu_tasklist_guid: task.tasklist ? task.tasklist.guid : null, user_id: 'user_001', gold_reward: 5, difficulty: 'medium', due_date: task.due && task.due.timestamp ? new Date(parseInt(task.due.timestamp)).toISOString().split('T')[0] : null, completed_at: task.completed ? new Date().toISOString() : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        saveData(db);
      }
    } else if (eventType === 'task.task.completed' || eventType === 'task.completed') {
      const task = event.task;
      if (task && task.guid) {
        const t = db.tasks.find(x => x.feishu_guid === task.guid);
        if (t) { t.status = 'done'; t.completed_at = new Date().toISOString(); t.updated_at = new Date().toISOString(); saveData(db); }
      }
    } else if (eventType === 'task.task.updated' || eventType === 'task.updated') {
      const task = event.task;
      if (task && task.guid) {
        const t = db.tasks.find(x => x.feishu_guid === task.guid);
        if (t) { if (task.summary !== undefined) t.title = task.summary; if (task.description !== undefined) t.description = task.description; t.updated_at = new Date().toISOString(); saveData(db); }
      }
    } else if (eventType === 'task.task.deleted' || eventType === 'task.deleted') {
      const guid = event.task ? (event.task.guid || event.task_guid) : null;
      if (guid) { db.tasks = db.tasks.filter(x => x.feishu_guid !== guid); saveData(db); }
    }
  } catch (err) { console.error('[Webhook] Error:', err.message); }
  res.json({ ok: true });
});

// OAuth
app.get('/api/feishu/oauth/url', (req, res) => {
  if (!APP_ID) return res.status(500).json({ error: 'Not configured' });
  const redirect = encodeURIComponent(process.env.FEISHU_REDIRECT_URI || 'https://sparki-backend-osgd.onrender.com/api/feishu/oauth/callback');
  const url = FEISHU_API + '/authen/v1/index?redirect_uri=' + redirect + '&app_id=' + APP_ID + '&scope=task:tasklist:read%20task:task:read&state=s' + Date.now();
  res.json({ url: url });
});

app.get('/api/feishu/oauth/callback', async (req, res) => {
  if (!req.query.code) return res.status(400).json({ error: 'Missing code' });
  try {
    const r = await fetch(FEISHU_API + '/authen/v1/oidc/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code: req.query.code, app_id: APP_ID, app_secret: APP_SECRET }) });
    const d = await r.json();
    if (d.code !== 0 || !d.data || !d.data.access_token) return res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(d.msg || 'fail'));
    userTokenCache = { token: d.data.access_token, expireAt: Date.now() + (d.data.expire || 7200) * 1000 };
    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=success');
  } catch (e) { res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(e.message)); }
});

app.get('/api/feishu/oauth/status', (req, res) => {
  res.json({ authorized: !!(userTokenCache.token && Date.now() < userTokenCache.expireAt) });
});

// Sync
app.post('/api/feishu/sync', async (req, res) => {
  try {
    if (!userTokenCache.token || Date.now() >= userTokenCache.expireAt) return res.status(401).json({ error: 'Need auth first' });
    const lr = await fetch(FEISHU_API + '/task/v2/tasklists?page_size=500', { headers: { Authorization: 'Bearer ' + userTokenCache.token } });
    const ld = await lr.json();
    if (ld.code !== 0) return res.status(500).json({ error: ld.msg || 'tasklists fail' });
    const lists = (ld.data && ld.data.items) ? ld.data.items : [];
    db.tasklists = lists.map(l => ({ id: l.guid, name: l.name || 'Untitled', feishu_guid: l.guid, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    let count = 0;
    for (const list of lists) {
      const tr = await fetch(FEISHU_API + '/task/v2/tasklists/' + list.guid + '/tasks?page_size=500', { headers: { Authorization: 'Bearer ' + userTokenCache.token } });
      const td = await tr.json();
      if (td.code !== 0 || !td.data || !td.data.items) continue;
      for (const item of td.data.items) {
        const task = item.task || item;
        const guid = task.guid || item.guid;
        if (!guid || db.tasks.find(t => t.feishu_guid === guid)) continue;
        db.tasks.push({ id: 'feishu_' + Date.now() + '_' + count, title: task.summary || 'Untitled', description: task.description || '', status: task.completed ? 'done' : 'todo', source: 'feishu', feishu_guid: guid, feishu_tasklist_guid: list.guid, user_id: 'user_001', gold_reward: 5, difficulty: 'medium', due_date: task.due && task.due.timestamp ? new Date(parseInt(task.due.timestamp)).toISOString().split('T')[0] : null, completed_at: task.completed ? new Date().toISOString() : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        count++;
      }
    }
    saveData(db);
    res.json({ ok: true, tasklists: lists.length, newTasks: count, total: db.tasks.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sparki v5 on port ' + PORT));
