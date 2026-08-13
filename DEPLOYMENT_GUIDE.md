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

### 方式 1: GitHub Pages (推荐)

#### 自动部署 (GitHub Actions)

1. **创建部署工作流**

创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ master ]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout
      uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        cache: 'npm'
        cache-dependency-path: web/package-lock.json
    
    - name: Install dependencies
      run: |
        cd web
        npm ci
    
    - name: Build
      run: |
        cd web
        npm run build
      env:
        # Optional. Leave empty when each user configures their own service.
        VITE_SCRAPER_URL: ${{ secrets.VITE_SCRAPER_URL }}
    
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./web/dist
        cname: cnote.yourdomain.com  # 可选：自定义域名
```

2. **配置 GitHub Secrets**

进入仓库 Settings → Secrets and variables → Actions:
- 可选添加 `VITE_SCRAPER_URL`: 你为该站点提供的默认内容解析服务 URL。
  留空时，每位用户可在设置中连接自己部署的服务。

3. **启用 GitHub Pages**

进入仓库 Settings → Pages:
- Source: 选择 "Deploy from a branch"
- Branch: 选择 `gh-pages` 分支
- 点击 Save

4. **触发部署**

推送代码到 master 分支即可自动部署。

访问: `https://yourusername.github.io/Cnote/`

#### 手动部署

```bash
cd web

# 安装依赖
npm install

# 构建
npm run build

# 安装 gh-pages 工具
npm install -g gh-pages

# 部署
gh-pages -d dist
```

---

### 方式 2: Vercel

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

### 方式 3: Cloudflare Pages

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

### 方式 4: Netlify

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

### 部署内容解析服务

1. **进入 Workers 目录**

```bash
cd workers
npm install
```

2. **本地测试**

```bash
npm run dev
```

访问 http://localhost:8787/v1/health 验证。

3. **部署到生产**

```bash
npm run deploy
```

4. **获取 Worker URL**

部署成功后会显示 URL，例如:
```
https://cnote-content-service.your-subdomain.workers.dev
```

在 Cnote 中打开“设置 → 内容解析服务”，测试并保存此 URL。可选的
`CN_CONTENT_TOKEN` 和 `SCRAPER_ALLOWED_ORIGINS` 详见 `workers/README.md`。

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
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**测试 Scraper**:

```bash
# 健康检查
curl https://your-scraper-url/health

# 测试网页抓取
curl -X POST https://your-scraper-url/scrape \
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
推送代码到 master 分支即可自动部署

**手动更新**:
```bash
cd web
npm run build
gh-pages -d dist  # 或其他部署命令
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
   - 使用平台的 Secrets 管理敏感信息

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
- 提供导出功能让用户备份 Flows
- 定期提醒用户导出重要数据

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
