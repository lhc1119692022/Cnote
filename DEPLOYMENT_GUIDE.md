# Cnote 部署指南

## 目录
1. [前端部署](#前端部署)
2. [Cloudflare Workers 部署](#cloudflare-workers-部署)
3. [环境变量配置](#环境变量配置)
4. [域名配置](#域名配置)
5. [故障排查](#故障排查)

---

## 前端部署

Cnote Web 应用是一个纯静态应用，可以部署到任何静态托管服务。

### GitHub Pages

仓库已经包含 `.github/workflows/deploy-pages.yml`。推送到 `master` 后，GitHub
Actions 会自动安装依赖、使用 `github-pages` 模式构建 `web/dist`，并通过
GitHub Pages 官方部署 Action 发布站点。

项目页地址：

```text
https://lhc1119692022.github.io/Cnote/
```

前端使用哈希路由，页面地址类似：

```text
https://lhc1119692022.github.io/Cnote/#/dashboard
```

这样在 GitHub Pages 上直接刷新 Dashboard、Flow 和设置页面时不会产生 SPA
路由 404。Vite 的 `github-pages` 构建模式会自动给静态资源添加 `/Cnote/`
前缀。

首次部署时，在 GitHub 仓库的 **Settings → Pages** 中确认 **Source** 为
**GitHub Actions**。后续只需推送到 `master`，无需维护 `gh-pages` 分支。

本地验证 Pages 构建：

```bash
cd web
npm ci
npm run build -- --mode github-pages
```

可选的 `VITE_SCRAPER_URL` 只应填写公开的内容解析 Worker 地址，不要在任何
`VITE_*` 变量中保存私钥。留空时，每位用户可以在 Cnote 设置中连接自己的
内容解析服务。

---

### 方式 1: Vercel

1. **连接仓库**

访问 [vercel.com](https://vercel.com)，使用 GitHub 登录

2. **导入项目**

- 点击 "New Project"
- 选择 Cnote 仓库
- 配置构建设置:
  - Framework Preset: Vite
  - Root Directory: `web`
  - Build Command: `npm run build`
  - Output Directory: `dist`

3. **配置环境变量**

如需提供默认内容解析服务，可在项目设置中添加
`VITE_SCRAPER_URL`。留空时，每位用户可在设置中配置自己的服务。

4. **部署**

点击 "Deploy"，等待部署完成。

访问: `https://your-project.vercel.app`

---

### 方式 2: Cloudflare Pages

1. **安装 Wrangler**

```bash
npm install -g wrangler
```

2. **登录 Cloudflare**

```bash
wrangler login
```

3. **构建应用**

```bash
cd web
npm install
npm run build
```

4. **部署到 Cloudflare Pages**

```bash
wrangler pages deploy dist --project-name=cnote
```

5. **配置环境变量**

如需提供默认内容解析服务，在 Cloudflare Dashboard → Pages → 项目设置 →
Environment Variables 中添加 `VITE_SCRAPER_URL`。

访问: `https://cnote.pages.dev`

---

### 方式 3: Netlify

1. **连接仓库**

访问 [netlify.com](https://netlify.com)，使用 GitHub 登录

2. **导入项目**

- 点击 "New site from Git"
- 选择 Cnote 仓库
- 配置构建设置:
  - Base directory: `web`
  - Build command: `npm run build`
  - Publish directory: `web/dist`

3. **配置环境变量**

如需提供默认内容解析服务，在 Site settings → Environment variables 中添加
`VITE_SCRAPER_URL`。

4. **部署**

点击 "Deploy site"。

访问: `https://your-site.netlify.app`

---

## Cloudflare Workers 部署

### 前置要求

1. **Cloudflare 账号**
   - 注册: https://dash.cloudflare.com/sign-up
   - 免费计划即可使用 Workers

2. **登录 Cloudflare**

```bash
npx wrangler login
```

浏览器会打开授权页面，点击授权。

---

### 内容解析 Worker：无 Key 快速部署

1. **进入 Workers 目录**

```bash
cd workers
npm install
```

2. **登录并部署**

```bash
npx wrangler login
npm run deploy
```

部署成功后会显示类似以下 URL：

```text
https://cnote-content-service.your-subdomain.workers.dev
```

在 Cnote 中打开“设置 → 内容解析服务”，填写该 URL，Key 留空，然后测试并保存。
无 Key 是默认模式，适合个人使用和快速部署；公开 URL 可能被他人调用，配额风险由部署者承担。

### 内容解析 Worker：Bearer Key 快速部署

先完成上一节的安装和登录，然后执行：

```bash
npx wrangler secret put CN_CONTENT_TOKEN
npm run deploy
```

Wrangler 提示输入值时，填写自行生成的随机 Key。部署后，在 Cnote 的“设置 →
内容解析服务”中填写 Worker URL 和同一个 Key。客户端会发送：

```http
Authorization: Bearer YOUR_RANDOM_KEY
```

如需恢复无 Key 模式，删除 Secret 后重新部署：

```bash
npx wrangler secret delete CN_CONTENT_TOKEN
npm run deploy
```

### AI CORS 代理：可选自定义请求头

AI 代理与内容解析 Worker 是两个独立服务。仅当 AI 服务商不允许浏览器直接请求，
且你愿意自行承担代理流量和密钥传输风险时部署：

```bash
cd workers
npm install
npx wrangler login
npm run deploy:proxy
```

代理地址格式为：

```text
https://cnote-ai-proxy.your-subdomain.workers.dev/proxy/{provider}/{endpoint}
```

代理仅接受 `GET`、`POST` 和浏览器预检请求，单次请求体上限为 20 MiB。
允许的上游路径为模型列表、Chat Completions、Responses、Anthropic Messages，
以及 Gemini OpenAI 兼容的模型列表和 Chat Completions；其他路径会被拒绝。

默认不要求额外的代理访问头。需要简单防滥用时，同时配置请求头名称和值：

```bash
npx wrangler secret put CN_PROXY_HEADER_NAME --config wrangler-proxy.toml
npx wrangler secret put CN_PROXY_HEADER_VALUE --config wrangler-proxy.toml
npm run deploy:proxy
```

例如分别输入 `X-Cnote-Proxy-Key` 和一个随机 Key，调用时附加：

```http
X-Cnote-Proxy-Key: YOUR_RANDOM_KEY
```

两个变量必须同时配置。只有调用端能够附加自定义请求头时才启用此保护；Cnote
发布站点不会内置维护者或部署者的代理 URL、Key。AI 服务商的 API Key 仍通过
`Authorization`、`x-api-key` 等官方请求头传给上游。

AI API 代理不是应用的默认组件。若某个 AI 渠道没有提供浏览器 CORS 支持，请在
“设置 → 渠道”填写你自己部署并信任的中转地址；不要把 API Key 发送到公共代理。

---

### 自定义域名 (可选)

如果你有自己的域名:

1. **添加域名到 Cloudflare**

在 Cloudflare Dashboard 添加你的域名

2. **配置 Workers 路由**

方式 A: 在 `wrangler.toml` 中添加:

```toml
[env.production]
    name = "cnote-content-service"
routes = [
  { pattern = "content.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

方式 B: 在 Cloudflare Dashboard 中配置:
- Workers → 选择 Worker → Triggers → Routes
- 添加路由: `content.yourdomain.com/*`

3. **配置 DNS**

在 Cloudflare DNS 设置中:
- 类型: AAAA
- 名称: content
- 内容: 100:: (Workers 占位符)
- 代理状态: Proxied (橙色云朵)

这会为内容解析服务配置自定义域名。

---

## 环境变量配置

### 开发环境

创建 `web/.env`:

```env
# Optional default Content Service URL
VITE_SCRAPER_URL=https://cnote-content-service.your-subdomain.workers.dev
```

### 生产环境

根据部署平台配置:

**GitHub Actions**:
在仓库 Secrets 中添加

**Vercel/Netlify**:
在项目设置的环境变量中添加

**Cloudflare Pages**:
在 Pages 项目设置中添加

---

## 域名配置

### 为前端应用配置自定义域名

#### GitHub Pages

1. 在仓库根目录创建 `CNAME` 文件:
```
cnote.yourdomain.com
```

2. 在域名 DNS 设置中添加记录:
```
类型: CNAME
名称: cnote
内容: yourusername.github.io
```

#### Vercel

1. 在项目设置 → Domains
2. 添加域名: `cnote.yourdomain.com`
3. 按提示配置 DNS 记录

#### Cloudflare Pages

1. 在项目设置 → Custom domains
2. 添加域名
3. DNS 会自动配置 (如果域名在 Cloudflare)

---

## 验证部署

### 1. 检查前端应用

访问部署的 URL，确认:
- [ ] 页面正常加载
- [ ] Dashboard 可以访问
- [ ] 可以创建新 Flow
- [ ] Flow 编辑器正常工作

### 2. 检查 Workers

**测试 API 代理**:

```bash
# 健康检查
curl https://your-proxy-url/health

# 应该返回:
# {"status":"ok","timestamp":"...","version":"1.0.0"}

# 测试代理 (需要有效的 API Key)
curl -X POST https://your-proxy-url/proxy/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_OPENAI_KEY" \
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**测试 Scraper**:

```bash
# 健康检查
curl https://your-scraper-url/v1/health

# 测试网页抓取
curl -X POST https://your-scraper-url/v1/web/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### 3. 端到端测试

1. 在应用中配置 API Key
2. 创建一个简单的 Flow (Content → AI → Output)
3. 执行 Flow
4. 检查是否能正常获得 AI 响应

---

## 监控和日志

### Cloudflare Workers 日志

1. 访问 Cloudflare Dashboard
2. Workers → 选择 Worker → Logs
3. 使用 Tail Workers 实时查看日志:

```bash
wrangler tail
```

### 性能监控

Cloudflare Dashboard 提供:
- 请求数量
- 错误率
- CPU 时间
- 带宽使用

### 告警配置

在 Cloudflare 中配置告警:
- Workers → 选择 Worker → Settings → Alerts
- 设置错误率阈值告警

---

## 成本估算

### Cloudflare Workers (免费套餐)

- 请求数: 100,000 次/天
- CPU 时间: 10ms/请求
- 基本满足个人使用

**付费套餐** ($5/月):
- 请求数: 10,000,000 次/月
- CPU 时间: 50ms/请求
- 适合团队使用

### 静态托管

- **GitHub Pages**: 免费
- **Vercel**: 免费 (个人项目)
- **Cloudflare Pages**: 免费
- **Netlify**: 免费 (个人项目)

**总成本**: 个人使用可以完全免费

---

## 故障排查

### 问题: 部署后页面空白

**解决方法**:
1. 检查浏览器控制台错误
2. 确认构建成功 (查看构建日志)
3. 检查 base path 配置 (如果部署在子路径)

### 问题: API 调用失败

**可能原因**:
1. Workers 未部署或 URL 错误
2. CORS 配置问题
3. API Key 未配置

**解决方法**:
1. 验证 Workers URL 可访问
2. 检查环境变量配置
3. 查看浏览器 Network 标签的请求详情

### 问题: Workers 部署失败

**解决方法**:
1. 确认 Wrangler 已登录: `wrangler whoami`
2. 检查 `wrangler.toml` 配置
3. 查看错误信息并根据提示修复

### 问题: 自定义域名不工作

**解决方法**:
1. 确认 DNS 记录已生效 (可能需要等待几分钟)
2. 使用 `dig` 或 `nslookup` 检查 DNS:
   ```bash
   dig cnote.yourdomain.com
   ```
3. 检查 SSL 证书状态 (Cloudflare 会自动配置)

### 问题: Workers 超出限制

**解决方法**:
1. 查看 Cloudflare Dashboard 的使用统计
2. 优化代码减少 CPU 时间
3. 升级到付费套餐

---

## 更新部署

### 更新前端

**GitHub Pages (自动)**:
推送代码到 `master` 分支即可触发 `.github/workflows/deploy-pages.yml`，无需
手动维护 `gh-pages` 分支。

**手动更新**:
```bash
cd web
npm run build
npm run build -- --mode github-pages
```

### 更新 Workers

```bash
cd workers

# 更新代码后重新部署
wrangler deploy
wrangler deploy --config wrangler-scraper.toml
```

### 零停机部署

Cloudflare Workers 自动支持零停机部署:
- 新版本部署时旧版本继续服务
- 部署完成后自动切换
- 无需额外配置

---

## 回滚

### 回滚 Workers

```bash
# 查看部署历史
wrangler deployments list

# 回滚到指定版本
wrangler rollback <deployment-id>
```

### 回滚前端

**GitHub Actions**:
1. 找到之前的成功构建
2. 重新运行 workflow

**手动**:
```bash
git checkout <previous-commit>
cd web
npm run build
# 重新部署
```

---

## 安全最佳实践

1. **环境变量**
   - 不要在代码中硬编码 API URL
   - 使用平台的 Secrets 管理 Worker 访问 Key
   - 不要把 AI 提供商 API Key 写入前端构建变量或仓库

2. **CORS 配置**
   - Workers 已配置允许所有来源
   - 生产环境可以限制为特定域名

3. **Rate Limiting**
   - Cloudflare 提供 DDoS 防护
   - 可以添加自定义限流规则

4. **日志**
   - 不要在 Workers 中记录敏感信息
   - API Key 不应出现在日志中

---

## 备份和恢复

### 数据备份

用户数据存储在浏览器本地:
- 在控制台使用 Flow 卡片菜单中的“备份”创建 `.cnote.zip` 完整备份
- 完整备份包含该 Flow 引用的本地资源；单个资源超过 500 MiB 时会拒绝备份
- 画板中的 JSON 导出只包含工作流结构，不包含本地文件

### 代码备份

- 代码托管在 GitHub
- Workers 代码也在 Git 仓库中
- 建议定期创建 Git tags 标记版本

---

## 生产检查清单

部署到生产前确认:

- [ ] 所有环境变量已配置
- [ ] Workers 已部署并测试通过
- [ ] 前端应用可正常访问
- [ ] API 调用功能正常
- [ ] 自定义域名已配置 (如果使用)
- [ ] SSL 证书有效
- [ ] 错误监控已配置
- [ ] 文档已更新
- [ ] 用户指南已提供

---

## 下一步

完成部署后:
1. 测试所有核心功能
2. 邀请用户试用
3. 收集反馈
4. 持续优化和改进

---

**需要帮助？** 查看 [故障排查指南](./USER_GUIDE.md#故障排查) 或在 GitHub 提交 Issue。
