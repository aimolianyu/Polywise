# Polymarket Start Engine (Supports 32 Languages)

前端纯静态 + Node/Express 后端，支持多语言翻译、文章/专题管理、后台受保护访问。

## 本地运行
```bash
npm install
npm start
# 访问 http://localhost:3000
```

### 环境变量
在项目根目录创建 `.env`（已在 `.gitignore` 中忽略）：
```
GOOGLE_API_KEY=你的谷歌翻译API密钥
ADMIN_TOKEN=你的后台口令
```

### 后台访问
```
http://localhost:3000/admin.html?token=<ADMIN_TOKEN>
# 或请求头 x-admin-token: <ADMIN_TOKEN>
```

## 数据与上传
- 文章数据：`data/articles.json`（已清空）。
- 专题数据：`data/topics.json`（已清空）。
- 上传目录：`uploads/`（已在 `.gitignore` 中忽略）。

## Docker
已提供 `Dockerfile`（基于 node:18-alpine）：
```bash
docker build -t polymarket-start-engine .
docker run -p 3000:3000 --env-file .env polymarket-start-engine
```

## 部署到 Render（Docker）
1. 在 Render 新建 Web Service，选择 Docker 部署，指向本仓库。
2. 在环境变量中配置 `GOOGLE_API_KEY`、`ADMIN_TOKEN`。
3. 端口使用 3000（`EXPOSE 3000`）。

## 推送到 GitHub（私有仓库）
> GitHub 私有仓库需你在 GitHub 端新建后复制仓库地址。
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <你的私有仓库SSH或HTTPS地址>
git push -u origin main
```

## 注意
- 语言切换依赖 `/api/translate`，需有效的 `GOOGLE_API_KEY`。
- 后台发布/删除需要 `ADMIN_TOKEN`。
- 分享链接会包含文章 ID 与 lang 参数，打开后按分享时语言展示。
- 免责声明页 `about.html` 为英文静态页，包含侵权联系邮箱。
