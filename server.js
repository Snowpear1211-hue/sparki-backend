const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { pool, initDB } = require('./db');
const {
  createFeishuTask,
  completeFeishuTask,
  uncompleteFeishuTask,
  deleteFeishuTask,
  updateFeishuTask,
  fetchFeishuTasklists,
  fetchFeishuTasks,
  fetchTasklistsWithUserToken,
  fetchTasksWithUserToken,
} = require('./feishu');

const app = express();
app.use(cors());
app.use(express.json());

// OAuth user_access_token cache
let userAccessTokenCache = { token: null, expireAt: 0 };
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || 'https://sparki-backend-osgd.onrender.com/api/feishu/oauth/callback';

// Health Check
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'sparki-backend', version: '2.1.0' });
});

// GET /api/user
app.get('/api/user', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', ['user_001']);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = rows[0];
    res.json({
      id: user.id,
      open_id: user.open_id,
      name: user.name,
      gold: user.gold,
      streak_days: user.streak_days,
      max_streak: user.max_streak,
      today_gold: user.today_gold,
      last_checkin_date: user.last_checkin_date,
      feishu_connected: !!(user.feishu_app_id && user.feishu_app_secret),
    });
  } catch (err) {
    console.error('GET /api/user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/update-gold
app.post('/api/user/update-gold', async (req, res) => {
  const { gold_delta } = req.body;
  if (typeof gold_delta !== 'number') {
    return res.status(400).json({ error: 'gold_delta must be a number' });
  }
  try {
    await pool.query('UPDATE users SET gold = gold + $1, updated_at = NOW() WHERE id = $2', [gold_delta, 'user_001']);
n    const { rows } = await pool.query('SELECT gold FROM users WHERE id = $1', ['user_001']);
    res.json({ gold: rows[0].gold });
  } catch (err) {
    console.error('POST /api/user/update-gold error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/feishu-config
app.post('/api/user/feishu-config', async (req, res) => {
  const { app_id, app_secret } = req.body;
  try {
    await pool.query('UPDATE users SET feishu_app_id = $1, feishu_app_secret = $2, updated_at = NOW() WHERE id = $3', [app_id, app_secret, 'user_001']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', ['user_001']);
    res.json({ tasks: rows });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
app.post('/api/tasks', async (req, res) => {
  const { title, description, due_date, gold_reward = 5, difficulty = 'low', tasklist_id } = req.body;
  const id = 'sparki_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  try {
    await pool.query(
      'INSERT INTO tasks (id, title, description, due_date, gold_reward, difficulty, feishu_tasklist_guid, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, title, description || '', due_date || null, gold_reward, difficulty, tasklist_id || null, 'user_001']
    );
    const db = { pool };
    const feishuResult = await createFeishuTask(db, title, description, due_date);
    if (feishuResult) {
      await pool.query('UPDATE tasks SET source = $1, feishu_guid = $2 WHERE id = $3', ['feishu', feishuResult.feishuGuid, id]);
    }
    res.json({ id, title, status: 'todo', gold_reward, feishu_synced: !!feishuResult });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id
app.patch('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { status, title, description, due_date } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];

    const updates = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) {
      updates.push('status = $' + idx++);
      values.push(status);
      if (status === 'done') {
        updates.push('completed_at = $' + idx++);
        values.push(new Date().toISOString());
      } else {
        updates.push('completed_at = NULL');
      }
    }
    if (title !== undefined) { updates.push('title = $' + idx++); values.push(title); }
    if (description !== undefined) { updates.push('description = $' + idx++); values.push(description); }
    if (due_date !== undefined) { updates.push('due_date = $' + idx++); values.push(due_date); }
    updates.push('updated_at = NOW()');
    values.push(id);

    await pool.query('UPDATE tasks SET ' + updates.join(', ') + ' WHERE id = $' + idx, values);

    if (task.source === 'feishu' && task.feishu_guid) {
      const db = { pool };
      if (status === 'done') await completeFeishuTask(db, task.feishu_guid);
      else if (status === 'todo') await uncompleteFeishuTask(db, task.feishu_guid);
      if (title !== undefined || description !== undefined) {
        await updateFeishuTask(db, task.feishu_guid, { title, description });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/tasks/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    if (task.source === 'feishu' && task.feishu_guid) {
      const db = { pool };
      await deleteFeishuTask(db, task.feishu_guid);
    }
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/tasks/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasklists
app.get('/api/tasklists', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasklists WHERE user_id = $1 ORDER BY created_at ASC', ['user_001']);
    res.json({ tasklists: rows });
  } catch (err) {
    console.error('GET /api/tasklists error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasklists
app.post('/api/tasklists', async (req, res) => {
  const { name } = req.body;
  const id = 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  try {
    await pool.query('INSERT INTO tasklists (id, name, user_id) VALUES ($1, $2, $3)', [id, name, 'user_001']);
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenses WHERE user_id = $1 ORDER BY created_at DESC', ['user_001']);
    res.json({ expenses: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses
app.post('/api/expenses', async (req, res) => {
  const { description, amount, type, category, date } = req.body;
  const id = 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  try {
    await pool.query(
      'INSERT INTO expenses (id, description, amount, type, category, date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, description, amount, type, category, date, 'user_001']
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shopitems
app.get('/api/shopitems', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shop_items WHERE user_id = $1 ORDER BY cost ASC', ['user_001']);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shopitems/:id/purchase
app.post('/api/shopitems/:id/purchase', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE shop_items SET purchased = true, purchased_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhook/feishu
app.post('/api/webhook/feishu', async (req, res) => {
  const body = req.body;
  if (body.challenge) {
    return res.json({ challenge: body.challenge });
  }
  const event = body.event;
  const eventType = body.header ? body.header.event_type : (event ? event.type : null);
  if (eventType && event) {
    try {
      await pool.query('INSERT INTO feishu_events (event_type, event_data) VALUES ($1, $2)', [eventType, JSON.stringify(body)]);
      await processFeishuEvent(eventType, event);
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }
  res.json({ ok: true });
});

async function processFeishuEvent(eventType, event) {
  console.log('Processing Feishu event:', eventType);
  switch (eventType) {
    case 'task.task.created':
    case 'task.created': {
      const task = event.task;
      if (!task) return;
      const { rows } = await pool.query('SELECT id FROM tasks WHERE feishu_guid = $1', [task.guid]);
      if (rows.length > 0) return;
      const id = 'feishu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      await pool.query(
        'INSERT INTO tasks (id, title, description, status, source, feishu_guid, feishu_tasklist_guid, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
        [id, task.summary || '未命名任务', task.description || '', 'todo', 'feishu', task.guid, task.tasklist ? task.tasklist.guid : null, 'user_001']
      );
      console.log('Feishu task imported:', task.summary);
      break;
    }
    case 'task.task.completed':
    case 'task.completed': {
      const task = event.task;
      if (!task || !task.guid) return;
      await pool.query("UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE feishu_guid = $1", [task.guid]);
      console.log('Feishu task completed:', task.guid);
      break;
    }
    case 'task.task.updated':
    case 'task.updated': {
      const task = event.task;
      if (!task || !task.guid) return;
      await pool.query('UPDATE tasks SET title = $1, description = $2, updated_at = NOW() WHERE feishu_guid = $3', [task.summary, task.description || '', task.guid]);
      break;
    }
    case 'task.task.deleted':
    case 'task.deleted': {
      const guid = event.task ? (event.task.guid || event.task_guid) : null;
      if (!guid) return;
      await pool.query('DELETE FROM tasks WHERE feishu_guid = $1', [guid]);
      console.log('Feishu task deleted:', guid);
      break;
    }
  }
}

// ============================================
// FEISHU OAUTH 2.0
// ============================================

// Step 1: Get OAuth URL
app.get('/api/feishu/oauth/url', (req, res) => {
  if (!FEISHU_APP_ID) {
    return res.status(500).json({ error: 'FEISHU_APP_ID not configured' });
  }
  const redirectUri = encodeURIComponent(FEISHU_REDIRECT_URI);
  const scope = 'task:tasklist:read%20task:task:read';
  const state = 'sparki_' + Date.now();
  const url = 'https://open.feishu.cn/open-apis/authen/v1/index?redirect_uri=' + redirectUri + '&app_id=' + FEISHU_APP_ID + '&scope=' + scope + '&state=' + state;
  console.log('[OAuth] URL generated');
  res.json({ url });
});

// Step 2: OAuth Callback
app.get('/api/feishu/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }
  console.log('[OAuth] Callback received, code:', code.toString().slice(0, 10) + '...');
  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    console.log('[OAuth] Token exchange code:', tokenData.code);

    if (tokenData.code !== 0 || !tokenData.data || !tokenData.data.access_token) {
      console.error('[OAuth] Token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(tokenData.msg || 'Token exchange failed'));
    }

    const userToken = tokenData.data.access_token;
    const expireIn = tokenData.data.expire || 7200;
    userAccessTokenCache = { token: userToken, expireAt: Date.now() + expireIn * 1000 };
    console.log('[OAuth] User token obtained, expires in', expireIn, 's');

    const userRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { Authorization: 'Bearer ' + userToken },
    });
    const userData = await userRes.json();
    if (userData.code === 0 && userData.data) {
      console.log('[OAuth] User:', userData.data.name);
    }

    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=success');
  } catch (err) {
    console.error('[OAuth] Callback error:', err);
    res.redirect('https://aqjsoa7d7jhfm.ok.kimi.link/#/?oauth=error&message=' + encodeURIComponent(err.message));
  }
});

// Step 3: Check OAuth status
app.get('/api/feishu/oauth/status', (req, res) => {
  const authorized = !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt);
  const expiresIn = authorized ? Math.floor((userAccessTokenCache.expireAt - Date.now()) / 1000) : 0;
  res.json({ authorized, expiresIn });
});

// ============================================
// FEISHU MANUAL SYNC (with detailed debug)
// ============================================

app.post('/api/feishu/sync', async (req, res) => {
  try {
    const debug = {
      steps: [],
      tokenStatus: { hasToken: false, expired: true },
      tasklistAttempt: null,
      tasklistError: null,
      tasklistsFetched: null,
    };

    debug.tokenStatus.hasToken = !!userAccessTokenCache.token;
    debug.tokenStatus.expired = Date.now() >= userAccessTokenCache.expireAt;
    debug.tokenStatus.hasValidToken = !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt);
    debug.steps.push('Token status checked: hasValid=' + debug.tokenStatus.hasValidToken);

    let feishuLists = null;

    if (userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) {
      debug.steps.push('Trying user_access_token...');
      try {
        feishuLists = await fetchTasklistsWithUserToken(userAccessTokenCache.token);
        debug.tasklistAttempt = 'user_token';
        if (feishuLists) {
          debug.steps.push('User token success: ' + feishuLists.length + ' lists');
        } else {
          debug.steps.push('User token returned null (API error)');
        }
      } catch (e) {
        debug.steps.push('User token threw: ' + e.message);
        debug.tasklistError = e.message;
      }
    } else {
      debug.steps.push('Skipping user token (missing or expired)');
    }

    if (!feishuLists) {
      debug.steps.push('Trying tenant_access_token...');
      debug.tasklistAttempt = 'tenant_token';
      try {
        const db = { pool };
        feishuLists = await fetchFeishuTasklists(db);
        if (feishuLists) {
          debug.steps.push('Tenant token success: ' + feishuLists.length + ' lists');
        } else {
          debug.steps.push('Tenant token returned null (API error)');
        }
      } catch (e) {
        debug.steps.push('Tenant token threw: ' + e.message);
        debug.tasklistError = (debug.tasklistError ? debug.tasklistError + '; ' : '') + e.message;
      }
    }

    if (!feishuLists) {
      debug.steps.push('Both tokens failed');
      return res.status(500).json({
        error: 'Failed to fetch tasklists',
        debug: debug,
      });
    }

    debug.tasklistsFetched = feishuLists.map(l => ({ guid: l.guid, name: l.name }));
    debug.steps.push('Saving ' + feishuLists.length + ' tasklists to DB...');

    const savedLists = [];
    for (const list of feishuLists) {
      await pool.query(
        'INSERT INTO tasklists (id, name, feishu_guid, user_id, updated_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (id) DO UPDATE SET name = $2, feishu_guid = $3, updated_at = NOW()',
        [list.guid, list.name, list.guid, 'user_001']
      );
      savedLists.push({ id: list.guid, name: list.name });
    }

    let totalTasks = 0;
    const savedTasks = [];
    debug.steps.push('Fetching tasks from ' + feishuLists.length + ' lists...');

    for (const list of feishuLists) {
      let tasks = null;
      if (userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt) {
        tasks = await fetchTasksWithUserToken(userAccessTokenCache.token, list.guid);
      }
      if (!tasks) {
        const db = { pool };
        tasks = await fetchFeishuTasks(db, list.guid);
      }
      if (!tasks) {
        debug.steps.push('No tasks for list: ' + list.name);
        continue;
      }
      debug.steps.push('List "' + list.name + '": ' + tasks.length + ' tasks');

      for (const task of tasks) {
        const { rows: existing } = await pool.query('SELECT id FROM tasks WHERE feishu_guid = $1', [task.guid]);
        if (existing.length > 0) {
          await pool.query(
            'UPDATE tasks SET title = $1, description = $2, status = $3, due_date = $4, completed_at = $5, feishu_tasklist_guid = $6, updated_at = NOW() WHERE feishu_guid = $7',
            [task.title, task.description, task.status, task.due_date, task.completed_at, task.tasklist_guid, task.guid]
          );
        } else {
          await pool.query(
            'INSERT INTO tasks (id, title, description, status, source, feishu_guid, feishu_tasklist_guid, user_id, due_date, completed_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())',
            [task.id, task.title, task.description, task.status, 'feishu', task.guid, task.tasklist_guid, 'user_001', task.due_date, task.completed_at]
          );
        }
        totalTasks++;
        savedTasks.push({ id: task.id, title: task.title, list: list.name, status: task.status });
      }
    }

    debug.steps.push('Done. ' + savedLists.length + ' lists, ' + totalTasks + ' tasks');
    res.json({ ok: true, tasklists: savedLists.length, tasks: totalTasks, detail: { lists: savedLists, tasks: savedTasks.slice(0, 20) }, debug: debug });
  } catch (err) {
    console.error('POST /api/feishu/sync error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log('Sparki backend running on port ' + PORT);
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
