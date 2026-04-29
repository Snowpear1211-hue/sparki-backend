const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const store = {
  users: {
    'user_001': {
      id: 'user_001',
      open_id: 'ou_c5419939397cea2e5a8037e55b1d830e',
      name: 'Sparki User',
      gold: 2847,
      streak_days: 7,
      last_checkin_date: '2026-04-28',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  },
  tasks: {},
  transactions: {},
  gold_history: {},
  achievements: {},
  rewards: {}
};

function generateId() {
  return 'sparki_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getUser() {
  return store.users['user_001'];
}

function saveUser(user) {
  store.users['user_001'] = user;
}

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

// User
app.get('/api/user', (req, res) => {
  const user = getUser();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/user', (req, res) => {
  const { gold, streak_days, last_checkin_date } = req.body;
  const user = getUser();
  if (gold !== undefined) user.gold = gold;
  if (streak_days !== undefined) user.streak_days = streak_days;
  if (last_checkin_date !== undefined) user.last_checkin_date = last_checkin_date;
  user.updated_at = new Date().toISOString();
  saveUser(user);
  res.json({ success: true });
});

// Tasks
app.get('/api/tasks', (req, res) => {
  const { status, source } = req.query;
  let tasks = Object.values(store.tasks).filter(t => t.user_id === 'user_001');
  if (status && status !== 'all') tasks = tasks.filter(t => t.status === status);
  if (source && source !== 'all') tasks = tasks.filter(t => t.source === source);
  tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ tasks });
});

app.post('/api/tasks', (req, res) => {
  const id = generateId();
  const { title, description, difficulty = 'easy', gold_reward = 5, due_date, source = 'sparki', feishu_guid } = req.body;
  store.tasks[id] = {
    id, user_id: 'user_001', title, description, difficulty, gold_reward, due_date, source, feishu_guid,
    status: 'todo', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  res.json({ id, success: true });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { title, description, status, difficulty, gold_reward, due_date } = req.body;
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (status !== undefined) task.status = status;
  if (difficulty !== undefined) task.difficulty = difficulty;
  if (gold_reward !== undefined) task.gold_reward = gold_reward;
  if (due_date !== undefined) task.due_date = due_date;
  task.updated_at = new Date().toISOString();
  res.json({ success: true });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'done') return res.status(400).json({ error: 'Task already completed' });
  
  const completedAt = new Date().toISOString();
  const goldReward = task.gold_reward || 5;
  task.status = 'done';
  task.completed_at = completedAt;
  task.updated_at = completedAt;
  
  const user = getUser();
  user.gold += goldReward;
  user.updated_at = completedAt;
  saveUser(user);
  
  const historyId = generateId();
  store.gold_history[historyId] = {
    id: historyId, user_id: 'user_001', amount: goldReward,
    reason: `完成任务: ${task.title}`, task_id: req.params.id,
    created_at: completedAt
  };
  
  res.json({ success: true, gold_earned: goldReward });
});

app.delete('/api/tasks/:id', (req, res) => {
  delete store.tasks[req.params.id];
  res.json({ success: true });
});

// Transactions
app.get('/api/transactions', (req, res) => {
  const { type, limit = 50 } = req.query;
  let transactions = Object.values(store.transactions).filter(t => t.user_id === 'user_001');
  if (type && type !== 'all') transactions = transactions.filter(t => t.type === type);
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  transactions = transactions.slice(0, parseInt(limit));
  const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  res.json({ transactions, total_expense: expenses, total_income: income });
});

app.post('/api/transactions', (req, res) => {
  const id = generateId();
  const { title, amount, type, category, category_name, note, date } = req.body;
  store.transactions[id] = {
    id, user_id: 'user_001', title, amount, type, category,
    category_name: category_name || category, note, date,
    created_at: new Date().toISOString()
  };
  res.json({ id, success: true });
});

// Gold
app.get('/api/gold/history', (req, res) => {
  const history = Object.values(store.gold_history)
    .filter(h => h.user_id === 'user_001')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);
  const user = getUser();
  res.json({ history, current_gold: user?.gold || 0 });
});

app.post('/api/gold/checkin', (req, res) => {
  const user = getUser();
  const today = new Date().toISOString().split('T')[0];
  if (user?.last_checkin_date === today) {
    return res.status(400).json({ error: 'Already checked in today' });
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const newStreak = user?.last_checkin_date === yesterday ? (user?.streak_days || 0) + 1 : 1;
  const streakBonus = Math.min(newStreak * 2, 50);
  const goldEarned = 10 + streakBonus;
  
  user.gold += goldEarned;
  user.streak_days = newStreak;
  user.last_checkin_date = today;
  user.updated_at = new Date().toISOString();
  saveUser(user);
  
  const historyId = generateId();
  store.gold_history[historyId] = {
    id: historyId, user_id: 'user_001', amount: goldEarned,
    reason: `每日打卡 (连续${newStreak}天)`, created_at: new Date().toISOString()
  };
  
  res.json({ success: true, gold_earned: goldEarned, streak: newStreak });
});

// Achievements
app.get('/api/achievements', (req, res) => {
  const achievements = Object.values(store.achievements)
    .filter(a => a.user_id === 'user_001')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ achievements });
});

app.post('/api/achievements', (req, res) => {
  const id = generateId();
  const { icon, name, description } = req.body;
  store.achievements[id] = {
    id, user_id: 'user_001', icon, name, description,
    created_at: new Date().toISOString()
  };
  res.json({ id, success: true });
});

// Rewards
app.get('/api/rewards', (req, res) => {
  const rewards = Object.values(store.rewards)
    .filter(r => r.user_id === 'user_001')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ rewards });
});

app.post('/api/rewards', (req, res) => {
  const id = generateId();
  const { name, description, cost, category, icon } = req.body;
  store.rewards[id] = {
    id, user_id: 'user_001', name, description, cost,
    category: category || 'general', icon, purchased: 0,
    created_at: new Date().toISOString()
  };
  res.json({ id, success: true });
});

app.post('/api/rewards/:id/purchase', (req, res) => {
  const reward = store.rewards[req.params.id];
  if (!reward) return res.status(404).json({ error: 'Reward not found' });
  const user = getUser();
  if (user.gold < reward.cost) return res.status(400).json({ error: 'Not enough gold' });
  
  user.gold -= reward.cost;
  user.updated_at = new Date().toISOString();
  saveUser(user);
  reward.purchased += 1;
  
  const historyId = generateId();
  store.gold_history[historyId] = {
    id: historyId, user_id: 'user_001', amount: -reward.cost,
    reason: `兑换奖励: ${reward.name}`, created_at: new Date().toISOString()
  };
  
  res.json({ success: true });
});

// Tasklists
app.get('/api/tasklists', (req, res) => {
  const tasklists = Object.values(store.tasklists || {});
  res.json({ tasklists });
});

app.post('/api/tasklists', (req, res) => {
  const id = generateId();
  const { guid, name } = req.body;
  if (!store.tasklists) store.tasklists = {};
  store.tasklists[id] = { id, guid, name, created_at: new Date().toISOString() };
  res.json({ id, success: true });
});

// Sections
app.get('/api/sections', (req, res) => {
  const sections = Object.values(store.sections || {});
  res.json({ sections });
});

app.post('/api/sections', (req, res) => {
  const id = generateId();
  const { name, tasklist_id } = req.body;
  if (!store.sections) store.sections = {};
  store.sections[id] = { id, name, tasklist_id, created_at: new Date().toISOString() };
  res.json({ id, success: true });
});

// Feishu Sync
app.post('/api/sync/feishu/tasks', (req, res) => {
  const { tasks: feishuTasks } = req.body;
  if (!Array.isArray(feishuTasks)) return res.status(400).json({ error: 'Invalid tasks array' });
  
  const synced = [];
  for (const ft of feishuTasks) {
    const existing = Object.values(store.tasks).find(t => t.feishu_guid === ft.guid);
    const status = ft.completed_at !== '0' && ft.completed_at ? 'done' : 'todo';
    const completedAt = ft.completed_at !== '0' && ft.completed_at ? new Date(parseInt(ft.completed_at)).toISOString() : null;
    
    if (existing) {
      if (existing.status !== status || existing.title !== ft.summary) {
        existing.title = ft.summary;
        existing.status = status;
        existing.completed_at = completedAt;
        existing.updated_at = new Date().toISOString();
        
        if (status === 'done' && existing.status !== 'done') {
          const goldReward = existing.gold_reward || 5;
          const user = getUser();
          user.gold += goldReward;
          user.updated_at = new Date().toISOString();
          saveUser(user);
          const historyId = generateId();
          store.gold_history[historyId] = {
            id: historyId, user_id: 'user_001', amount: goldReward,
            reason: `完成飞书任务: ${ft.summary}`, task_id: existing.id,
            created_at: new Date().toISOString()
          };
        }
        synced.push({ id: existing.id, action: 'updated' });
      }
    } else {
      const id = generateId();
      store.tasks[id] = {
        id, user_id: 'user_001', title: ft.summary, status, source: 'feishu',
        feishu_guid: ft.guid, feishu_tasklist_guid: ft.tasklists?.[0]?.tasklist_guid || '',
        gold_reward: 5, completed_at: completedAt,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      if (status === 'done') {
        const user = getUser();
        user.gold += 5;
        user.updated_at = new Date().toISOString();
        saveUser(user);
        const historyId = generateId();
        store.gold_history[historyId] = {
          id: historyId, user_id: 'user_001', amount: 5,
          reason: `完成飞书任务: ${ft.summary}`, task_id: id,
          created_at: new Date().toISOString()
        };
      }
      synced.push({ id, action: 'created' });
    }
  }
  res.json({ success: true, synced_count: synced.length, tasks: synced });
});

app.post('/api/sync/feishu/complete', (req, res) => {
  const { feishu_guid, title } = req.body;
  const existing = Object.values(store.tasks).find(t => t.feishu_guid === feishu_guid);
  if (existing) {
    if (existing.status !== 'done') {
      existing.status = 'done';
      existing.completed_at = new Date().toISOString();
      existing.updated_at = new Date().toISOString();
      const goldReward = existing.gold_reward || 5;
      const user = getUser();
      user.gold += goldReward;
      user.updated_at = new Date().toISOString();
      saveUser(user);
      const historyId = generateId();
      store.gold_history[historyId] = {
        id: historyId, user_id: 'user_001', amount: goldReward,
        reason: `完成飞书任务: ${existing.title || title}`, task_id: existing.id,
        created_at: new Date().toISOString()
      };
    }
  } else {
    const id = generateId();
    store.tasks[id] = {
      id, user_id: 'user_001', title: title || '飞书任务', status: 'done', source: 'feishu',
      feishu_guid, gold_reward: 5, completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    const user = getUser();
    user.gold += 5;
    user.updated_at = new Date().toISOString();
    saveUser(user);
    const historyId = generateId();
    store.gold_history[historyId] = {
      id: historyId, user_id: 'user_001', amount: 5,
      reason: `完成飞书任务: ${title || '飞书任务'}`, task_id: id,
      created_at: new Date().toISOString()
    };
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Sparki backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
