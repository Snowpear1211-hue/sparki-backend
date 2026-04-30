const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      open_id TEXT,
      name TEXT,
      gold INTEGER DEFAULT 0,
      streak_days INTEGER DEFAULT 0,
      max_streak INTEGER DEFAULT 0,
      today_gold INTEGER DEFAULT 0,
      last_checkin_date TEXT,
      feishu_app_id TEXT,
      feishu_app_secret TEXT,
      feishu_tenant_token TEXT,
      feishu_token_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo',
      source TEXT DEFAULT 'local',
      feishu_guid TEXT,
      feishu_tasklist_guid TEXT,
      user_id TEXT DEFAULT 'user_001',
      gold_reward INTEGER DEFAULT 5,
      difficulty TEXT DEFAULT 'low',
      due_date TEXT,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasklists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      feishu_guid TEXT,
      user_id TEXT DEFAULT 'user_001',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      description TEXT,
      amount REAL,
      type TEXT,
      category TEXT,
      date TEXT,
      user_id TEXT DEFAULT 'user_001',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      cost INTEGER,
      category TEXT,
      icon TEXT,
      purchased BOOLEAN DEFAULT false,
      purchased_at TIMESTAMP,
      user_id TEXT DEFAULT 'user_001',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feishu_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT,
      event_data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query("SELECT * FROM users WHERE id = 'user_001'");
  if (rows.length === 0) {
    await pool.query(`
      INSERT INTO users (id, name, gold, streak_days, max_streak) 
      VALUES ('user_001', 'Sparki User', 0, 0, 0)
    `);
  }
}

module.exports = { pool, initDB };
