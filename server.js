const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const store = {
  tasks: {}, expenses: {}, shopItems: {}, tasklists: {}, calendarEvents: {},
  users: { 'user_001': { id: 'user_001', name: 'Player', gold: 500, today_gold: 0, streak_days: 0, max_streak: 0 } }
};

const oauthState = new Map();
let userAccessToken = null;
let userRefreshToken = null;

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

async function getTenantToken() {
  try {
    const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID || '', app_secret: process.env.FEISHU_APP_SECRET || '' })
    });
    const data = await res.json();
    if (data.code === 0) return data.tenant_access_token;
    return null;
  } catch (err) { return null; }
}

async function exchangeCodeForToken(code) {
  const tenantToken = await getTenantToken();
  if (!tenantToken) return null;
  try {
    const res = await fetch(`${FEISHU_API_BASE}/authen/v1/access_token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code })
    });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      return { access_token: data.data.access_token, refresh_token: data.data.refresh_token, expire: data.data.expires_in || 7200 };
    }
    return null;
  } catch (err) { return null; }
}

async function getUserToken() {
  if (!userAccessToken) return null;
  if (Date.now() < userAccessToken.expireAt - 60000) return userAccessToken.token;
  if (!userRefreshToken) return null;
  const tenantToken = await getTenantToken();
  if (!tenantToken) return null;
  try {
    const res = await fetch(`${FEISHU_API_BASE}/authen/v1/refresh_access_token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: userRefreshToken })
    });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      userAccessToken = { token: data.data.access_token, expireAt: Date.now() + (data.data.expires_in || 7200) * 1000 };
      userRefreshToken = data.data.refresh_token;
      return userAccessToken.token;
    }
    return null;
  } catch (err) { return null; }
}

async function fetchTasklistsUser(token) {
  try {
    const res = await fetch(`${FEISHU_API_BASE}/task/v2/tasklists`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.code === 0 && data.data?.items) return data.data.items.map(item => ({ guid: item.guid, name: item.name || '未命名' }));
    if (data.code === 0 && (!data.data || !data.data.items)) return [];
    return null;
  } catch (err) { return null; }
}

async function fetchTasksUser(token, tasklistGuid) {
  try {
    const res = await fetch(`${FEISHU_API_BASE}/task/v2/tasklists/${tasklistGuid}/tasks?page_size=500`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.code === 0 && data.data?.items) {
      return data.data.items.map(item => ({
        id: item.task?.guid || item.guid || `sparki_${Date.now()}_${Math.random()}`,
        title: item.task?.summary || '未命名任务',
        description: item.task?.description || '',
        status: item.task?.completed ? 'done' : 'todo',
        due_date: item.task?.due?.timestamp ? new Date(parseInt(item.task.due.timestamp)).toISOString().split('T')[0] : null,
        completed_at: item.task?.completed ? new Date().toISOString() : null,
        source: 'feishu',
        feishu_guid: item.task?.guid || item.guid,
        feishu_tasklist_guid: tasklistGuid,
        user_id: 'user_001',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
    }
    if (data.code === 0 && (!data.data || !data.data.items)) return [];
    return null;
  } catch (err) { return null; }
}

function pushTasklist(list) {
  const id = list.id || list.guid || `list_${Date.now()}`;
  store.tasklists[id] = { id, name: list.name || '未命名清单', feishu_guid: list.guid || list.id, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...list };
  return store.tasklists[id];
}

function pushTask(task) {
  const id = task.id || task.guid || `task_${Date.now()}_${Math.random()}`;
  store.tasks[id] = { id, title: task.title || task.summary || '未命名任务', description: task.description || '', status: task.status || 'todo', source: 'feishu', feishu_guid: task.guid || task.id, feishu_tasklist_guid: task.tasklist_id || task.list_id || null, user_id: 'user_001', due_date: task.due_date || null, completed_at: task.completed_at || null, gold_reward: task.gold_reward || 5, created_at: task.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), ...task };
  return store.tasks[id];
}

function updateTask(id, updates) { if (!store.tasks[id]) return null; store.tasks[id] = { ...store.tasks[id], ...updates, updated_at: new Date().toISOString() }; return store.tasks[id]; }
function deleteTask(id) { const t = store.tasks[id]; if (t) { delete store.tasks[id]; return t; } return null; }

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => { res.json({ ok: true, service: 'sparki-backend', stats: { tasks: Object.keys(store.tasks).length, tasklists: Object.keys(store.tasklists).length, expenses: Object.keys(store.expenses).length, shopItems: Object.keys(store.shopItems).length } }); });

app.get('/api/feishu/oauth/url', async (req, res) => {
  const appId = process.env.FEISHU_APP_ID;
  if (!appId) return res.status(500).json({ error: 'FEISHU_APP_ID not configured' });
  const state = `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  oauthState.set(state, { createdAt: Date.now() });
  const redirectUri = encodeURIComponent('https://sparki-backend-osgd.onrender.com/api/feishu/oauth/callback');
  const scope = encodeURIComponent('task:task:read task:tasklist:read');
  const url = `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
  res.json({ url, state });
});

app.get('/api/feishu/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('<h1>授权失败</h1><p>缺少参数</p>');
  if (!oauthState.has(state)) return res.status(400).send('<h1>授权失败</h1><p>state已过期</p>');
  oauthState.delete(state);
  const tokenInfo = await exchangeCodeForToken(code);
  if (!tokenInfo) return res.status(500).send('<h1>授权失败</h1><p>无法换取token</p>');
  userAccessToken = { token: tokenInfo.access_token, expireAt: Date.now() + tokenInfo.expire * 1000 };
  userRefreshToken = tokenInfo.refresh_token;
  res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/quests?oauth=success');
});

app.get('/api/feishu/oauth/status', (req, res) => {
  const hasToken = !!userAccessToken && Date.now() < userAccessToken.expireAt - 60000;
  res.json({ authorized: hasToken, expiresIn: userAccessToken ? Math.floor((userAccessToken.expireAt - Date.now()) / 1000) : 0 });
});

app.post('/api/feishu/sync', async (req, res) => {
  try {
    const token = await getUserToken();
    if (!token) return res.status(401).json({ error: 'No user authorization', needAuth: true });
    const lists = await fetchTasklistsUser(token);
    if (lists === null) return res.status(500).json({ error: 'Failed to fetch tasklists' });
    let totalTasks = 0; const imported = [];
    for (const list of lists) {
      store.tasklists[list.guid] = { id: list.guid, name: list.name, feishu_guid: list.guid, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const tasks = await fetchTasksUser(token, list.guid); if (!tasks) continue;
      for (const t of tasks) { store.tasks[t.id] = t; totalTasks++; }
      imported.push({ list: list.name, count: tasks.length });
    }
    res.json({ ok: true, tasklists: lists.length, tasks: totalTasks, detail: imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/webhook', (req, res) => {
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  const eventType = req.body.header?.event_type || req.body.event?.type;
  if (eventType?.includes('tasklist')) { const list = req.body.event?.tasklist || req.body.event; if (list) pushTasklist(list); }
  else if (eventType?.includes('task')) { const task = req.body.event?.task || req.body.event; if (task) pushTask(task); }
  res.json({ code: 0 });
});

app.get('/api/tasks', (req, res) => { res.json({ tasks: Object.values(store.tasks).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)) }); });
app.get('/api/tasklists', (req, res) => { res.json({ tasklists: Object.values(store.tasklists) }); });
app.post('/api/tasks', (req, res) => { res.status(201).json(pushTask(req.body)); });
app.patch('/api/tasks/:id', (req, res) => { const task = updateTask(req.params.id, req.body); if (!task) return res.status(404).json({ error: 'Not found' }); res.json(task); });
app.delete('/api/tasks/:id', (req, res) => { if (!deleteTask(req.params.id)) return res.status(404).json({ error: 'Not found' }); res.json({ ok: true }); });
app.get('/api/expenses', (req, res) => { res.json(Object.values(store.expenses).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))); });
app.post('/api/expenses', (req, res) => { const id = `exp_${Date.now()}`; store.expenses[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.expenses[id]); });
app.get('/api/shopitems', (req, res) => { res.json(Object.values(store.shopItems)); });
app.post('/api/shopitems', (req, res) => { const id = `shop_${Date.now()}`; store.shopItems[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.shopItems[id]); });
app.get('/api/calendar', (req, res) => { res.json({ events: Object.values(store.calendarEvents).sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)) }); });
app.post('/api/calendar', (req, res) => { const id = `cal_${Date.now()}`; store.calendarEvents[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.calendarEvents[id]); });
app.get('/api/user', (req, res) => { const user = store.users['user_001']; if (!user) return res.status(404).json({ error: 'Not found' }); res.json(user); });
app.post('/api/user/gold', (req, res) => { const { gold, today_gold } = req.body; const user = store.users['user_001']; if (user) { if (gold !== undefined) user.gold = gold; if (today_gold !== undefined) user.today_gold = today_gold; user.updated_at = new Date().toISOString(); } res.json(user); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`Sparki backend on port ${PORT}`); });
