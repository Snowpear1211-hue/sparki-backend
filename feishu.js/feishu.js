const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

async function getTenantToken(appId, appSecret) {
  try {
    const res = await fetch(FEISHU_API_BASE + '/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json();
    if (data.code === 0 && data.tenant_access_token) {
      return { token: data.tenant_access_token, expires: Date.now() + (data.expire - 120) * 1000 };
    }
    console.error('Tenant token failed:', data);
    return null;
  } catch (err) {
    console.error('Tenant token error:', err);
    return null;
  }
}

let tokenCache = { token: null, expires: 0 };

async function getValidToken(db) {
  const { pool } = db;
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const { rows } = await pool.query(
    'SELECT feishu_app_id, feishu_app_secret, feishu_tenant_token, feishu_token_expires FROM users WHERE id = $1',
    ['user_001']
  );
  if (!rows[0] || !rows[0].feishu_app_id || !rows[0].feishu_app_secret) return null;
  const user = rows[0];
  if (user.feishu_tenant_token && new Date(user.feishu_token_expires) > new Date()) {
    tokenCache = { token: user.feishu_tenant_token, expires: new Date(user.feishu_token_expires).getTime() };
    return tokenCache.token;
  }
  const result = await getTenantToken(user.feishu_app_id, user.feishu_app_secret);
  if (!result) return null;
  await pool.query(
    'UPDATE users SET feishu_tenant_token = $1, feishu_token_expires = $2 WHERE id = $3',
    [result.token, new Date(result.expires).toISOString(), 'user_001']
  );
  tokenCache = result;
  return result.token;
}

async function createFeishuTask(db, title, description, dueDate) {
  const token = await getValidToken(db);
  if (!token) return null;
  try {
    const body = { task: { summary: title, description: description || '' } };
    if (dueDate) body.task.due = { timestamp: new Date(dueDate).getTime().toString(), timezone: 'Asia/Shanghai' };
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasks', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.code === 0 && data.data && data.data.task) {
      return { feishuGuid: data.data.task.guid, feishuTaskId: data.data.task.id };
    }
    console.error('Create task failed:', data);
    return null;
  } catch (err) {
    console.error('Create task error:', err);
    return null;
  }
}

async function completeFeishuTask(db, feishuGuid) {
  const token = await getValidToken(db);
  if (!token) return false;
  try {
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasks/' + feishuGuid, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { completed: true } }),
    });
    return (await res.json()).code === 0;
  } catch (err) {
    console.error('Complete task error:', err);
    return false;
  }
}

async function uncompleteFeishuTask(db, feishuGuid) {
  const token = await getValidToken(db);
  if (!token) return false;
  try {
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasks/' + feishuGuid, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { completed: false } }),
    });
    return (await res.json()).code === 0;
  } catch (err) {
    console.error('Uncomplete task error:', err);
    return false;
  }
}

async function deleteFeishuTask(db, feishuGuid) {
  const token = await getValidToken(db);
  if (!token) return false;
  try {
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasks/' + feishuGuid, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    return (await res.json()).code === 0;
  } catch (err) {
    console.error('Delete task error:', err);
    return false;
  }
}

async function updateFeishuTask(db, feishuGuid, updates) {
  const token = await getValidToken(db);
  if (!token) return false;
  try {
    const body = { task: {} };
    if (updates.title !== undefined) body.task.summary = updates.title;
    if (updates.description !== undefined) body.task.description = updates.description;
    if (updates.completed !== undefined) body.task.completed = updates.completed;
    if (updates.dueDate) body.task.due = { timestamp: new Date(updates.dueDate).getTime().toString(), timezone: 'Asia/Shanghai' };
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasks/' + feishuGuid, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()).code === 0;
  } catch (err) {
    console.error('Update task error:', err);
    return false;
  }
}

async function fetchFeishuTasklists(db) {
  const token = await getValidToken(db);
  if (!token) return null;
  try {
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasklists', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (data.code === 0 && data.data && data.data.items) {
      return data.data.items.map((item) => ({ guid: item.guid, name: item.name || '未命名清单' }));
    }
    console.error('Fetch tasklists failed:', data);
    return null;
  } catch (err) {
    console.error('Fetch tasklists error:', err);
    return null;
  }
}

async function fetchFeishuTasks(db, tasklistGuid) {
  const token = await getValidToken(db);
  if (!token) return null;
  try {
    const res = await fetch(FEISHU_API_BASE + '/task/v2/tasklists/' + tasklistGuid + '/tasks?page_size=500', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (data.code === 0 && data.data && data.data.items) {
      return data.data.items.map((item) => ({
        id: item.task ? (item.task.id || item.guid || 'sparki_' + Date.now()) : (item.guid || 'sparki_' + Date.now()),
        guid: item.task ? (item.task.guid || item.guid) : item.guid,
        title: item.task ? (item.task.summary || '未命名任务') : '未命名任务',
        description: item.task ? (item.task.description || '') : '',
        status: item.task && item.task.completed ? 'done' : 'todo',
        due_date: item.task && item.task.due && item.task.due.timestamp ? new Date(parseInt(item.task.due.timestamp)).toISOString().split('T')[0] : null,
        completed_at: item.task && item.task.completed ? new Date().toISOString() : null,
        tasklist_guid: tasklistGuid,
      }));
    }
    console.error('Fetch tasks failed for', tasklistGuid, ':', data);
    return null;
  } catch (err) {
    console.error('Fetch tasks error:', err);
    return null;
  }
}

module.exports = {
  getValidToken,
  createFeishuTask,
  completeFeishuTask,
  uncompleteFeishuTask,
  deleteFeishuTask,
  updateFeishuTask,
  fetchFeishuTasklists,
  fetchFeishuTasks,
};
