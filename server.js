const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const store = {
  tasks: {}, expenses: {}, shopItems: {}, tasklists: {}, calendarEvents: {},
  users: { 'user_001': { id: 'user_001', name: 'Player', gold: 500, today_gold: 0, streak_days: 0, max_streak: 0 } }
};

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// ═══════════════════════════════════════════════
// TOKEN HELPERS
// ═══════════════════════════════════════════════

// Get tenant_access_token (app-level)
async function getTenantToken() {
  try {
    const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID || '', app_secret: process.env.FEISHU_APP_SECRET || '' })
    });
    const data = await res.json();
    if (data.code === 0) return data.tenant_access_token;
    console.error('Tenant token error:', data); return null;
  } catch (err) { console.error('Tenant token fetch error:', err); return null; }
}

// ═══════════════════════════════════════════════
// FEISHU FETCH (using tenant token)
// ═══════════════════════════════════════════════

async function fetchTasklists(token) {
  try {
    const res = await fetch(`${FEISHU_API_BASE}/task/v2/tasklists`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    console.log('Fetch tasklists response:', JSON.stringify(data).slice(0, 200));
    if (data.code === 0 && data.data?.items) {
      return data.data.items.map(item => ({ guid: item.guid, name: item.name || '未命名' }));
    }
    // If no items field, might be empty or error
    if (data.code === 0 && (!data.data || !data.data.items)) {
      console.log('No tasklists found - app may need user authorization');
      return [];
    }
    console.error('Fetch tasklists failed:', data); return null;
  } catch (err) { console.error('Fetch tasklists error:', err); return null; }
}

async function fetchTasks(token, tasklistGuid) {
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
    console.error(`Fetch tasks for ${tasklistGuid} failed:`, data); return null;
  } catch (err) { console.error('Fetch tasks error:', err); return null; }
}

// ═══════════════════════════════════════════════
// IN-MEMORY STORE HELPERS
// ═══════════════════════════════════════════════

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

// ═══════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => { res.json({ ok: true, service: 'sparki-backend', stats: { tasks: Object.keys(store.tasks).length, tasklists: Object.keys(store.tasklists).length, expenses: Object.keys(store.expenses).length, shopItems: Object.keys(store.shopItems).length } }); });

// ── Feishu Webhook (handle challenge + events) ──
app.post('/api/webhook', (req, res) => {
  const body = req.body;
  console.log('Webhook received:', JSON.stringify(body).slice(0, 200));

  // 1. URL verification - MUST return challenge
  if (body.challenge) {
    console.log('Challenge received:', body.challenge);
    return res.json({ challenge: body.challenge });
  }

  // 2. Event push
  const eventType = body.header?.event_type || body.event?.type;
  if (eventType?.includes('tasklist')) {
    const list = body.event?.tasklist || body.event;
    if (list) pushTasklist(list);
  } else if (eventType?.includes('task')) {
    const task = body.event?.task || body.event;
    if (task) pushTask(task);
  }
  res.json({ code: 0 });
});

// ── Feishu Manual Sync ──
app.post('/api/feishu/sync', async (req, res) => {
  try {
    console.log('Starting Feishu sync...');
    const token = await getTenantToken();
    if (!token) return res.status(500).json({ error: 'Failed to get Feishu token. Check FEISHU_APP_ID and FEISHU_APP_SECRET.' });
    console.log('Got tenant token');

    const lists = await fetchTasklists(token);
    if (lists === null) return res.status(500).json({ error: 'Failed to fetch tasklists from Feishu' });
    console.log(`Fetched ${lists.length} tasklists`);

    let totalTasks = 0;
    const imported = [];

    // Don't clear - merge instead
    for (const list of lists) {
      store.tasklists[list.guid] = { id: list.guid, name: list.name, feishu_guid: list.guid, user_id: 'user_001', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const tasks = await fetchTasks(token, list.guid);
      if (!tasks) continue;
      for (const t of tasks) { store.tasks[t.id] = t; totalTasks++; }
      imported.push({ list: list.name, count: tasks.length });
    }

    console.log(`Sync complete: ${lists.length} lists, ${totalTasks} tasks`);
    res.json({ ok: true, tasklists: lists.length, tasks: totalTasks, detail: imported });
  } catch (err) { console.error('/api/feishu/sync error:', err); res.status(500).json({ error: err.message }); }
});

// ── Tasks ──
app.get('/api/tasks', (req, res) => { const tasks = Object.values(store.tasks).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)); res.json({ tasks }); });
app.get('/api/tasklists', (req, res) => { res.json({ tasklists: Object.values(store.tasklists) }); });
app.post('/api/tasks', (req, res) => { const task = pushTask(req.body); res.status(201).json(task); });
app.patch('/api/tasks/:id', (req, res) => { const task = updateTask(req.params.id, req.body); if (!task) return res.status(404).json({ error: 'Task not found' }); res.json(task); });
app.delete('/api/tasks/:id', (req, res) => { const task = deleteTask(req.params.id); if (!task) return res.status(404).json({ error: 'Task not found' }); res.json({ ok: true }); });

// ── Expenses ──
app.get('/api/expenses', (req, res) => { const items = Object.values(store.expenses).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); res.json(items); });
app.post('/api/expenses', (req, res) => { const id = `exp_${Date.now()}`; store.expenses[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.expenses[id]); });

// ── Shop ──
app.get('/api/shopitems', (req, res) => { res.json(Object.values(store.shopItems)); });
app.post('/api/shopitems', (req, res) => { const id = `shop_${Date.now()}`; store.shopItems[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.shopItems[id]); });
app.post('/api/shopitems/:id/purchase', (req, res) => { const item = store.shopItems[req.params.id]; if (!item) return res.status(404).json({ error: 'Item not found' }); item.purchased = true; item.purchased_at = new Date().toISOString(); res.json(item); });

// ── Calendar ──
app.get('/api/calendar', (req, res) => { const events = Object.values(store.calendarEvents).sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)); res.json({ events }); });
app.post('/api/calendar', (req, res) => { const id = `cal_${Date.now()}`; store.calendarEvents[id] = { id, ...req.body, created_at: new Date().toISOString() }; res.status(201).json(store.calendarEvents[id]); });

// ── User ──
app.get('/api/user', (req, res) => { const user = store.users['user_001']; if (!user) return res.status(404).json({ error: 'User not found' }); res.json(user); });
app.post('/api/user/gold', (req, res) => { const { gold, today_gold } = req.body; const user = store.users['user_001']; if (user) { if (gold !== undefined) user.gold = gold; if (today_gold !== undefined) user.today_gold = today_gold; user.updated_at = new Date().toISOString(); } res.json(user); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`Sparki backend running on port ${PORT}`); });
