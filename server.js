const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const dbPath = process.env.DATABASE_URL ? process.env.DATABASE_URL.replace('file:', '') : './sparki.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, open_id TEXT NOT NULL, name TEXT, gold INTEGER DEFAULT 0, streak_days INTEGER DEFAULT 0, last_checkin_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'todo', source TEXT DEFAULT 'sparki', feishu_guid TEXT, feishu_tasklist_guid TEXT, difficulty TEXT DEFAULT 'easy', gold_reward INTEGER DEFAULT 5, due_date TEXT, completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, category_name TEXT, note TEXT, date TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS gold_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, task_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, icon TEXT, name TEXT NOT NULL, description TEXT, unlocked_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS rewards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL, category TEXT DEFAULT 'general', icon TEXT, purchased INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL, task_id TEXT, feishu_guid TEXT, action TEXT NOT NULL, status TEXT DEFAULT 'success', error_message TEXT, synced_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  db.prepare('INSERT OR IGNORE INTO users (id, open_id, name, gold, streak_days) VALUES (?, ?, ?, ?, ?)').run('user_001', 'ou_c5419939397cea2e5a8037e55b1d830e', 'Sparki User', 2847, 7);
}

initDatabase();

function generateId() {
  return 'sparki_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

// User
app.get('/api/user', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user_001');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/user', (req, res) => {
  const { gold, streak_days, last_checkin_date } = req.body;
  db.prepare('UPDATE users SET gold = ?, streak_days = ?, last_checkin_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(gold, streak_days, last_checkin_date, 'user_001');
  res.json({ success: true });
});

// Tasks
app.get('/api/tasks', (req, res) => {
  const { status, source } = req.query;
  let sql = 'SELECT * FROM tasks WHERE user_id = ?';
  const params = ['user_001'];
  if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
  if (source && source !== 'all') { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY created_at DESC';
  const tasks = db.prepare(sql).all(...params);
  res.json({ tasks });
});

app.post('/api/tasks', (req, res) => {
  const id = generateId();
  const { title, description, difficulty = 'easy', gold_reward = 5, due_date, source = 'sparki', feishu_guid } = req.body;
  db.prepare(`INSERT INTO tasks (id, user_id, title, description, difficulty, gold_reward, due_date, source, feishu_guid, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo')`)
    .run(id, 'user_001', title, description, difficulty, gold_reward, due_date, source, feishu_guid);
  res.json({ id, success: true });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { title, description, status, difficulty, gold_reward, due_date } = req.body;
  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, difficulty = ?, gold_reward = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(title, description, status, difficulty, gold_reward, due_date, req.params.id);
  res.json({ success: true });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'done') return res.status(400).json({ error: 'Task already completed' });
  const completedAt = new Date().toISOString();
  const goldReward = task.gold_reward || 5;
  db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('done', completedAt, req.params.id);
  db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, 'user_001');
  const historyId = generateId();
  db.prepare('INSERT INTO gold_history (id, user_id, amount, reason, task_id) VALUES (?, ?, ?, ?, ?)')
    .run(historyId, 'user_001', goldReward, `完成任务: ${task.title}`, req.params.id);
  res.json({ success: true, gold_earned: goldReward });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Transactions
app.get('/api/transactions', (req, res) => {
  const { type, limit = 50 } = req.query;
  let sql = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = ['user_001'];
  if (type && type !== 'all') { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY date DESC LIMIT ?';
  params.push(parseInt(limit));
  const transactions = db.prepare(sql).all(...params);
  const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  res.json({ transactions, total_expense: expenses, total_income: income });
});

app.post('/api/transactions', (req, res) => {
  const id = generateId();
  const { title, amount, type, category, category_name, note, date } = req.body;
  db.prepare('INSERT INTO transactions (id, user_id, title, amount, type, category, category_name, note, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'user_001', title, amount, type, category, category_name || category, note, date);
  res.json({ id, success: true });
});

// Gold
app.get('/api/gold/history', (req, res) => {
  const history = db.prepare('SELECT * FROM gold_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all('user_001');
  const user = db.prepare('SELECT gold FROM users WHERE id = ?').get('user_001');
  res.json({ history, current_gold: user?.gold || 0 });
});

app.post('/api/gold/checkin', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get('user_001');
  const today = new Date().toISOString().split('T')[0];
  if (user?.last_checkin_date === today) return res.status(400).json({ error: 'Already checked in today' });
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const newStreak = user?.last_checkin_date === yesterday ? (user?.streak_days || 0) + 1 : 1;
  const streakBonus = Math.min(newStreak * 2, 50);
  const goldEarned = 10 + streakBonus;
  db.prepare('UPDATE users SET gold = gold + ?, streak_days = ?, last_checkin_date = ? WHERE id = ?').run(goldEarned, newStreak, today, 'user_001');
  const historyId = generateId();
  db.prepare('INSERT INTO gold_history (id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(historyId, 'user_001', goldEarned, `每日打卡 (连续${newStreak}天)`);
  res.json({ success: true, gold_earned: goldEarned, streak: newStreak });
});

// Achievements
app.get('/api/achievements', (req, res) => {
  const achievements = db.prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY created_at DESC').all('user_001');
  res.json({ achievements });
});

app.post('/api/achievements', (req, res) => {
  const id = generateId();
  const { icon, name, description } = req.body;
  db.prepare('INSERT INTO achievements (id, user_id, icon, name, description) VALUES (?, ?, ?, ?, ?)').run(id, 'user_001', icon, name, description);
  res.json({ id, success: true });
});

// Rewards
app.get('/api/rewards', (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards WHERE user_id = ? ORDER BY created_at DESC').all('user_001');
  res.json({ rewards });
});

app.post('/api/rewards', (req, res) => {
  const id = generateId();
  const { name, description, cost, category, icon } = req.body;
  db.prepare('INSERT INTO rewards (id, user_id, name, description, cost, category, icon) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'user_001', name, description, cost, category || 'general', icon);
  res.json({ id, success: true });
});

app.post('/api/rewards/:id/purchase', (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Reward not found' });
  const user = db.prepare('SELECT gold FROM users WHERE id = ?').get('user_001');
  if (user.gold < reward.cost) return res.status(400).json({ error: 'Not enough gold' });
  db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(reward.cost, 'user_001');
  db.prepare('UPDATE rewards SET purchased = purchased + 1 WHERE id = ?').run(req.params.id);
  const historyId = generateId();
  db.prepare('INSERT INTO gold_history (id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(historyId, 'user_001', -reward.cost, `兑换奖励: ${reward.name}`);
  res.json({ success: true });
});

// Feishu Sync
app.post('/api/sync/feishu/tasks', (req, res) => {
  const { tasks: feishuTasks } = req.body;
  if (!Array.isArray(feishuTasks)) return res.status(400).json({ error: 'Invalid tasks array' });
  const synced = [];
  for (const ft of feishuTasks) {
    const existing = db.prepare('SELECT * FROM tasks WHERE feishu_guid = ?').get(ft.guid);
    const status = ft.completed_at !== '0' && ft.completed_at ? 'done' : 'todo';
    const completedAt = ft.completed_at !== '0' && ft.completed_at ? new Date(parseInt(ft.completed_at)).toISOString() : null;
    if (existing) {
      if (existing.status !== status || existing.title !== ft.summary) {
        db.prepare('UPDATE tasks SET title = ?, status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ft.summary, status, completedAt, existing.id);
        if (status === 'done' && existing.status !== 'done') {
          const goldReward = existing.gold_reward || 5;
          db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, 'user_001');
          const historyId = generateId();
          db.prepare('INSERT INTO gold_history (id, user_id, amount, reason, task_id) VALUES (?, ?, ?, ?, ?)').run(historyId, 'user_001', goldReward, `完成飞书任务: ${ft.summary}`, existing.id);
        }
        synced.push({ id: existing.id, action: 'updated' });
      }
    } else {
      const id = generateId();
      db.prepare('INSERT INTO tasks (id, user_id, title, status, source, feishu_guid, feishu_tasklist_guid, gold_reward, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'user_001', ft.summary, status, 'feishu', ft.guid, ft.tasklists?.[0]?.tasklist_guid || '', 5, completedAt);
      if (status === 'done') {
        db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(5, 'user_001');
        const historyId = generateId();
        db.prepare('INSERT INTO gold_history (id, user_id, amount, reason, task_id) VALUES (?, ?, ?, ?, ?)').run(historyId, 'user_001', 5, `完成飞书任务: ${ft.summary}`, id);
      }
      synced.push({ id, action: 'created' });
    }
  }
  res.json({ success: true, synced_count: synced.length, tasks: synced });
});

app.post('/api/sync/feishu/complete', (req, res) => {
  const { feishu_guid, title } = req.body;
  const existing = db.prepare('SELECT * FROM tasks WHERE feishu_guid = ?').get(feishu_guid);
  if (existing) {
    if (existing.status !== 'done') {
      db.prepare('UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('done', existing.id);
      const goldReward = existing.gold_reward || 5;
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, 'user_001');
      const historyId = generateId();
      db.prepare('INSERT INTO gold_history (id, user_id, amount, reason, task_id) VALUES (?, ?, ?, ?, ?)').run(historyId, 'user_001', goldReward, `完成飞书任务: ${existing.title || title}`, existing.id);
    }
  } else {
    const id = generateId();
    db.prepare('INSERT INTO tasks (id, user_id, title, status, source, feishu_guid, gold_reward, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run(id, 'user_001', title || '飞书任务', 'done', 'feishu', feishu_guid, 5);
    db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(5, 'user_001');
    const historyId = generateId();
    db.prepare('INSERT INTO gold_history (id, user_id, amount, reason, task_id) VALUES (?, ?, ?, ?, ?)').run(historyId, 'user_001', 5, `完成飞书任务: ${title || '飞书任务'}`, id);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Sparki backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
