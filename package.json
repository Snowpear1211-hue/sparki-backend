const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const DATA_FILE = './data.json';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: [{ id: 'user_001', name: 'Sparki', gold: 100, streak_days: 0, max_streak: 0, today_gold: 0, last_checkin_date: null }], tasks: [], tasklists: [], expenses: [], shopItems: [] }; }
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
  res.json({ ok: true, version: '4.0.0', tasks: db.tasks.length, tasklists: db.tasklists.length });
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

app.get('/api/tasks', (req, res) => {
  res.json({ tasks: db.tasks });
});

app.post('/api/tasks', (req, res) => {
  const id = 'sparki_' + Date.now();
  const task = { id, title: req.body.title, description: req.body.description || '', due_date: req.body.due_date || null, gold_reward: req.body.gold_reward || 5, difficulty: req.body.difficulty || 'low', status: 'todo', source: 'local', user_id: 'user_001', feishu_guid: null, feishu_tasklist_guid: req.body.tasklist_id || null, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  db.tasks.push(task);
  saveData(db);
  res.json({ id, title: task.title, status: 'todo', gold_reward: task.gold_reward });
});

app.patch('/api/tasks/:id', (req, res) => {
  const t = db.tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (req.body.status !== undefined) { t.status = req.body.status; t.completed_at = req.body.status === 'done' ? new Date().toISOString() : null; }
  if (req.body.title !== undefined) t.title = req.body.title;
  if (req.body.description !== undefined) t.description = req.body.description;
  if (req.body.due_date !== undefined) t.due_date = req.body.due_date;
  t.updated_at = new Date().toISOString();
  saveData(db);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.tasks = db.tasks.filter(x => x.id !== req.params.id);
  saveData(db);
  res.json({ ok: true });
});

app.get('/api/tasklists', (req, res) => {
  res.json({ tasklists: db.tasklists });
});

app.post('/api/tasklists', (req, res) => {
  const id = 'list_' + Date.now();
  db.tasklists.push({ id, name: req.body.name, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  saveData(db);
  res.json({ id, name: req.body.name });
});

app.get('/api/expenses', (req, res) => {
  res.json({ expenses: db.expenses });
});

app.post('/api/expenses', (req, res) => {
  const id = 'exp_' + Date.now();
  db.expenses.push({ id, description: req.body.description, amount: req.body.amount, type: req.body.type, category: req.body.category, date: req.body.date, user_id: 'user_001', created_at: new Date().toISOString() });
  saveData(db);
  res.json({ id });
});

app.get('/api/shopitems', (req, res) => {
  res.json({ items: db.shopItems });
});

app.post('/api/shopitems/:id/purchase', (req, res) => {
  const item = db.shopItems.find(x => x.id === req.params.id);
  if (item) { item.purchased = true; item.purchased_at = new Date().toISOString(); saveData(db); }
n  res.json({ ok: true });
});

app.post('/api/webhook/feishu', (req, res) => {
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  res.json({ ok: true });
});

app.get('/api/feishu/oauth/url', (req, res) => {
  if (!FEISHU_APP_ID) return res.status(500).json({ error: 'FEISHU_APP_ID not configured' });
  const url = FEISHU_API + '/authen/v1/index?redirect_uri=' + encodeURIComponent(FEISHU_REDIRECT_URI) + '&app_id=' + FEISHU_APP_ID + '&scope=task:tasklist:read%20task:task:read&state=sparki_' + Date.now();
  res.json({ url });
});

app.get('/api/feishu/oauth/callback', async (req, res) => {
  if (!req.query.code) return res.status(400).json({ error: 'Missing code' });
  try {
    const r = await fetch(FEISHU_API + '/authen/v1/oidc/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: req.query.code, app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
    });
    const d = await r.json();
    if (d.code !== 0 || !d.data || !d.data.access_token) {
      return res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(d.msg || 'Token failed'));
    }
    userAccessTokenCache = { token: d.data.access_token, expireAt: Date.now() + (d.data.expire || 7200) * 1000 };
    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=success');
  } catch (e) {
    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(e.message));
  }
});

app.get('/api/feishu/oauth/status', (req, res) => {
  res.json({ authorized: !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) });
});

app.post('/api/feishu/sync', async (req, res) => {
  const debug = { steps: [] };
  try {
    const hasToken = !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt);
    debug.steps.push('hasToken=' + hasToken);
    if (!hasToken) return res.status(500).json({ error: 'No user token. Authorize Feishu first.', debug });

    debug.steps.push('Fetching tasklists...');
    const d = await fetch(FEISHU_API + '/task/v2/tasklists?page_size=500', {
      headers: { Authorization: 'Bearer ' + userAccessTokenCache.token },
    }).then(r => r.json());
    debug.feishuResponse = d;

    if (d.code !== 0) {
      debug.steps.push('API error: code=' + d.code + ' msg=' + (d.msg || 'unknown'));
      return res.status(500).json({ error: 'Feishu API: ' + (d.msg || 'code ' + d.code), debug });
    }

    const lists = (d.data && d.data.items) ? d.data.items.map(item => ({ guid: item.guid, name: item.name || '未命名' })) : [];
    debug.steps.push('Got ' + lists.length + ' tasklists');

    db.tasklists = lists.map(l => ({ id: l.guid, name: l.name, feishu_guid: l.guid, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));

    let totalTasks = 0;
    for (const list of lists) {
      const tr = await fetch(FEISHU_API + '/task/v2/tasklists/' + list.guid + '/tasks?page_size=500', {
        headers: { Authorization: 'Bearer ' + userAccessTokenCache.token },
      }).then(r => r.json());

      if (tr.code === 0 && tr.data && tr.data.items) {
        for (const item of tr.data.items) {
          const guid = item.task ? (item.task.guid || item.guid) : item.guid;
          const existing = db.tasks.find(t => t.feishu_guid === guid);
          const taskData = {
            title: item.task ? (item.task.summary || '未命名') : '未命名',
            description: item.task ? (item.task.description || '') : '',
            status: item.task && item.task.completed ? 'done' : 'todo',
            due_date: item.task && item.task.due && item.task.due.timestamp ? new Date(parseInt(item.task.due.timestamp)).toISOString().split('T')[0] : null,
            completed_at: item.task && item.task.completed ? new Date().toISOString() : null,
            tasklist_guid: list.guid,
            updated_at: new Date().toISOString(),
          };
          if (existing) {
            Object.assign(existing, taskData);
          } else {
            db.tasks.push({ id: 'feishu_' + Date.now() + '_' + Math.random().toString(36).substr(2,6), ...taskData, feishu_guid: guid, feishu_tasklist_guid: list.guid, source: 'feishu', user_id: 'user_001', gold_reward: 5, difficulty: 'medium', created_at: new Date().toISOString() });
            totalTasks++;
          }
        }
        debug.steps.push(list.name + ': ' + tr.data.items.length + ' tasks');
      }
    }

    saveData(db);
    res.json({ ok: true, tasklists: lists.length, tasks: totalTasks, total: db.tasks.length, debug });
  } catch (err) {
    debug.steps.push('Exception: ' + err.message);
    res.status(500).json({ error: err.message, debug });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Sparki v4.0 on port ' + PORT));
