# 安阳市区天气预警监控

每小时检查安阳市区（不含所辖县）的红色/橙色天气预警，通过飞书发送提醒。

## 功能

- 🕐 每小时自动检查一次（通过 Railway Cron）
- 📍 只关注安阳市区，不包含安阳县、林州、汤阴、滑县、内黄等
- 🔴🟠 发现红色/橙色预警 → 连续发送 5 条飞书消息
- ✅ 无预警 → 安静结束，不打扰

## 技术栈

- Node.js (ESM)
- Railway (托管 + Cron 定时触发)
- 飞书 Open API (消息发送)

## 部署到 Railway

### 1. 推送代码到 GitHub

```bash
git remote add origin 你的仓库地址
git add .
git commit -m "init: anyang weather alert"
git push -u origin main
```

### 2. 在 Railway 中连接仓库

1. 登录 [Railway](https://railway.app)
2. New Project → Deploy from GitHub repo → 选择本仓库
3. 项目部署后，进入项目设置

### 3. 设置环境变量

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `FEISHU_APP_ID` | 飞书应用 App ID | `cli_aaa459062bf89be0` |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | (从 secrets.json 获取) |
| `FEISHU_USER_OPEN_ID` | 接收用户 Open ID | `ou_5483b347a9ba5d39f8bf3203b4f0dc7a` |

### 4. 配置 Cron 触发器

在 Railway 中：
1. 进入项目 → Deployments → 当前部署
2. 点击 **Cron Jobs** 标签
3. 添加一个每小时执行的 Cron 任务

```
Schedule: 0 * * * *    (每小时整点触发)
Command: npm start
```

### 5. 测试部署

可以先临时设置 `TEST_MODE=true` 环境变量，手动触发一次，确认飞书能收到测试消息。

## 本地测试

```bash
# 安装依赖
npm install

# 运行（首次可设置 TEST_MODE=true 发送测试消息）
TEST_MODE=true FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_USER_OPEN_ID=xxx npm start

# 正常模式运行
npm start
```
