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
} = require('./feishu');

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const app = express();
app.use(cors());
app.use(express.json());

let userAccessTokenCache = { token: null, expireAt: 0 };
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || 'https://sparki-backend-osgd.onrender.com/api/feishu/oauth/callback';

app.get('/', (req, res) => {
  res.json({ ok: true, version: '2.2.0' });
});

app.get('/api/user', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', ['user_001']);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    res.json({ id: u.id, name: u.name, gold: u.gold, streak_days: u.streak_days, max_streak: u.max_streak, today_gold: u.today_gold, last_checkin_date: u.last_checkin_date, feishu_connected: !!(u.feishu_app_id && u.feishu_app_secret) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/update-gold', async (req, res) => {
  try {
    await pool.query('UPDATE users SET gold = gold + $1 WHERE id = $2', [req.body.gold_delta, 'user_001']);
    const { rows } = await pool.query('SELECT gold FROM users WHERE id = $1', ['user_001']);
    res.json({ gold: rows[0].gold });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/feishu-config', async (req, res) => {
  try {
    await pool.query('UPDATE users SET feishu_app_id = $1, feishu_app_secret = $2 WHERE id = $3', [req.body.app_id, req.body.app_secret, 'user_001']);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', ['user_001']); res.json({ tasks: rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
  const { title, description, due_date, gold_reward = 5, difficulty = 'low', tasklist_id } = req.body;
  const id = 'sparki_' + Date.now();
  try {
    await pool.query('INSERT INTO tasks (id, title, description, due_date, gold_reward, difficulty, feishu_tasklist_guid, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, title, description || '', due_date || null, gold_reward, difficulty, tasklist_id || null, 'user_001']);
    const db = { pool };
    const fr = await createFeishuTask(db, title, description, due_date);
    if (fr) await pool.query('UPDATE tasks SET source=$1, feishu_guid=$2 WHERE id=$3', ['feishu', fr.feishuGuid, id]);
    res.json({ id, title, status: 'todo', gold_reward });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const t = rows[0];
    const { status, title, description, due_date } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (status !== undefined) { sets.push('status=$' + i++); vals.push(status); sets.push(status === 'done' ? "completed_at=NOW()" : "completed_at=NULL"); }
    if (title !== undefined) { sets.push('title=$' + i++); vals.push(title); }
    if (description !== undefined) { sets.push('description=$' + i++); vals.push(description || ''); }
    if (due_date !== undefined) { sets.push('due_date=$' + i++); vals.push(due_date); }
    sets.push('updated_at=NOW()');
    vals.push(req.params.id);
    await pool.query('UPDATE tasks SET ' + sets.join(',') + ' WHERE id=$' + i, vals);
    if (t.source === 'feishu' && t.feishu_guid) {
      const db = { pool };
      if (status === 'done') await completeFeishuTask(db, t.feishu_guid);
      else if (status === 'todo') await uncompleteFeishuTask(db, t.feishu_guid);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (rows[0] && rows[0].source === 'feishu' && rows[0].feishu_guid) {
      await deleteFeishuTask({ pool }, rows[0].feishu_guid);
    }
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasklists', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM tasklists WHERE user_id = $1', ['user_001']); res.json({ tasklists: rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasklists', async (req, res) => {
  const id = 'list_' + Date.now();
  await pool.query('INSERT INTO tasklists (id, name, user_id) VALUES ($1,$2,$3)', [id, req.body.name, 'user_001']);
  res.json({ id, name: req.body.name });
});

app.get('/api/expenses', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM expenses WHERE user_id = $1 ORDER BY created_at DESC', ['user_001']); res.json({ expenses: rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expenses', async (req, res) => {
  const id = 'exp_' + Date.now();
  await pool.query('INSERT INTO expenses (id, description, amount, type, category, date, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, req.body.description, req.body.amount, req.body.type, req.body.category, req.body.date, 'user_001']);
  res.json({ id });
});

app.get('/api/shopitems', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM shop_items WHERE user_id = $1', ['user_001']); res.json({ items: rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shopitems/:id/purchase', async (req, res) => {
  await pool.query('UPDATE shop_items SET purchased=true, purchased_at=NOW() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/webhook/feishu', async (req, res) => {
  const b = req.body;
  if (b.challenge) return res.json({ challenge: b.challenge });
  res.json({ ok: true });
});

// ========== OAUTH ==========

app.get('/api/feishu/oauth/url', (req, res) => {
  if (!FEISHU_APP_ID) return res.status(500).json({ error: 'FEISHU_APP_ID not configured' });
  const url = 'https://open.feishu.cn/open-apis/authen/v1/index?redirect_uri=' + encodeURIComponent(FEISHU_REDIRECT_URI) + '&app_id=' + FEISHU_APP_ID + '&scope=task:tasklist:read%20task:task:read&state=sparki_' + Date.now();
  res.json({ url });
});

app.get('/api/feishu/oauth/callback', async (req, res) => {
  if (!req.query.code) return res.status(400).json({ error: 'Missing code' });
  try {
    const r = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
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

// ========== SYNC (inline user token calls) ==========

app.post('/api/feishu/sync', async (req, res) => {
  const debug = { steps: [], feishuResponse: null };
  try {
    const hasToken = !!(userAccessTokenCache.token && Date.now() < userAccessTokenCache.expireAt);
    debug.steps.push('hasUserToken=' + hasToken);

    let lists = null;

    if (hasToken) {
      debug.steps.push('Calling user_token /task/v2/tasklists...');
      const apiRes = await fetch(FEISHU_API_BASE + '/task/v2/tasklists?page_size=500', {
        headers: { Authorization: 'Bearer ' + userAccessTokenCache.token },
      }).then(r => r.json());
      debug.feishuResponse = apiRes;
      if (apiRes.code === 0 && apiRes.data && apiRes.data.items) {
        lists = apiRes.data.items.map(item => ({ guid: item.guid, name: item.name || '未命名' }));
        debug.steps.push('User token OK, got ' + lists.length + ' lists');
      } else {
        debug.steps.push('User token API error: code=' + apiRes.code + ' msg=' + (apiRes.msg || 'none'));
      }
    }

    if (!lists) {
      debug.steps.push('Trying tenant token...');
      const db = { pool };
      lists = await fetchFeishuTasklists(db);
      if (lists) debug.steps.push('Tenant token OK, got ' + lists.length + ' lists');
    }

    if (!lists) {
      debug.steps.push('All methods failed');
      return res.status(500).json({ error: 'Failed to fetch tasklists', debug });
    }

    for (const list of lists) {
      await pool.query('INSERT INTO tasklists (id, name, feishu_guid, user_id, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET name=$2, updated_at=NOW()', [list.guid, list.name, list.guid, 'user_001']);
    }

    let totalTasks = 0;
    for (const list of lists) {
      let tasks = null;
      if (hasToken) {
        const tr = await fetch(FEISHU_API_BASE + '/task/v2/tasklists/' + list.guid + '/tasks?page_size=500', {
          headers: { Authorization: 'Bearer ' + userAccessTokenCache.token },
        }).then(r => r.json());
        if (tr.code === 0 && tr.data && tr.data.items) {
          tasks = tr.data.items.map(item => ({
            id: item.task ? (item.task.id || item.guid) : item.guid,
            guid: item.task ? (item.task.guid || item.guid) : item.guid,
            title: item.task ? (item.task.summary || '未命名') : '未命名',
            description: item.task ? (item.task.description || '') : '',
            status: item.task && item.task.completed ? 'done' : 'todo',
            due_date: item.task && item.task.due && item.task.due.timestamp ? new Date(parseInt(item.task.due.timestamp)).toISOString().split('T')[0] : null,
            completed_at: item.task && item.task.completed ? new Date().toISOString() : null,
            tasklist_guid: list.guid,
          }));
        }
      }
      if (!tasks) {
        const db = { pool };
        tasks = await fetchFeishuTasks(db, list.guid);
      }
      if (!tasks) continue;
      for (const task of tasks) {
        const { rows: ex } = await pool.query('SELECT id FROM tasks WHERE feishu_guid=$1', [task.guid]);
        if (ex.length > 0) {
          await pool.query('UPDATE tasks SET title=$1, description=$2, status=$3, due_date=$4, completed_at=$5, feishu_tasklist_guid=$6, updated_at=NOW() WHERE feishu_guid=$7', [task.title, task.description, task.status, task.due_date, task.completed_at, task.tasklist_guid, task.guid]);
        } else {
          await pool.query('INSERT INTO tasks (id, title, description, status, source, feishu_guid, feishu_tasklist_guid, user_id, due_date, completed_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())', [task.id, task.title, task.description, task.status, 'feishu', task.guid, task.tasklist_guid, 'user_001', task.due_date, task.completed_at]);
        }
        totalTasks++;
      }
    }

    res.json({ ok: true, tasklists: lists.length, tasks: totalTasks, debug });
  } catch (err) {
    debug.steps.push('Exception: ' + err.message);
    res.status(500).json({ error: err.message, debug });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log('Running on', PORT))).catch(e => { console.error(e); process.exit(1); });
