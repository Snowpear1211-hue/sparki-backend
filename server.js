const fetch = require('node-fetch');
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
