# Sparki Backend (Render 版)

Node.js + Express + SQLite 后端，部署到 Render 平台。

## 部署步骤

### 1. 创建 GitHub 仓库并推送代码

```bash
# 进入项目目录
cd sparki-render

# 初始化 git
git init
git add .
git commit -m "Initial commit"

# 添加远程仓库（替换 YOUR_USERNAME 为你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/sparki-backend.git

# 推送
git branch -M main
git push -u origin main
```

### 2. 部署到 Render

1. 打开 https://render.com
2. 点击 **New +** → **Blueprint**
3. 连接 GitHub 仓库 `sparki-backend`
4. Render 会自动读取 `render.yaml` 并部署

### 3. 获取 URL

部署完成后，Render 会给你 URL：
```
https://sparki-backend.onrender.com
```

## API 文档

### 健康检查
- `GET /health`

### 用户
- `GET /api/user` - 用户信息
- `PUT /api/user` - 更新用户

### 任务
- `GET /api/tasks?status=&source=` - 任务列表
- `POST /api/tasks` - 创建任务
- `GET /api/tasks/:id` - 任务详情
- `PUT /api/tasks/:id` - 更新任务
- `POST /api/tasks/:id/complete` - 完成任务（自动加金币）
- `DELETE /api/tasks/:id` - 删除任务

### 记账
- `GET /api/transactions?type=&limit=` - 收支记录
- `POST /api/transactions` - 记一笔

### 金币
- `GET /api/gold/history` - 金币历史
- `POST /api/gold/checkin` - 每日打卡

### 成就
- `GET /api/achievements` - 成就列表
- `POST /api/achievements` - 创建成就

### 奖励商店
- `GET /api/rewards` - 奖励列表
- `POST /api/rewards` - 创建奖励
- `POST /api/rewards/:id/purchase` - 兑换奖励

### 飞书同步
- `POST /api/sync/feishu/tasks` - 推送飞书任务列表
- `POST /api/sync/feishu/complete` - 标记飞书任务完成

## 前端接入

把 API_BASE 改成你的 Render URL：

```javascript
const API_BASE = 'https://sparki-backend.onrender.com';
```
