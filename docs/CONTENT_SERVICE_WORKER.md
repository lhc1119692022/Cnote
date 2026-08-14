# 部署 Cnote 内容解析 Worker

内容解析服务用于获取公开网页正文、YouTube 字幕和部分社媒公开内容。它与 AI 渠道完全独立，不会代理 AI 请求，也不需要填写 AI API Key。

未部署内容解析服务时，Cnote 的本地文件、手动文本、视频播放和普通 URL 输出仍然可以使用；需要远程解析的功能会提示配置服务。

## 能力与边界

这个 Worker：

- 可以解析公开可访问的网页正文。
- 可以读取可获取到的 YouTube 字幕。
- 可以解析脚本已支持的部分公开社媒页面和媒体。
- 会限制目标地址、重定向、超时、请求体和响应大小，降低 SSRF 与资源滥用风险。
- 不会绕过登录、付费墙、验证码、地区限制或目标网站的访问控制。
- 不保证所有启用反爬或必须执行复杂前端脚本的网站都能解析成功。

## 准备工作

你只需要一个 Cloudflare 账户。Cnote 可以仍然运行在本地，内容解析 Worker 会获得独立的 `workers.dev` 地址。

## 第一步：打开完整脚本

- [查看可直接粘贴的完整内容解析脚本](../workers/dashboard/content-service.js)
- [打开 Raw 纯文本脚本](https://raw.githubusercontent.com/lhc1119692022/Cnote/master/workers/dashboard/content-service.js)
- [查看便于二次开发的 TypeScript 源码](../workers/src/scraper.ts)

完整脚本顶部有一个明确标注的“可操作配置区”：

```js
// 填入长随机字符串会启用访问令牌；留空则不校验令牌。
globalThis.CNOTE_CONTENT_TOKEN = "请替换成随机值";
```

令牌不是 AI API Key。它只用于判断请求是否来自知道该值的 Cnote 客户端。

可以在任意浏览器的开发者工具 Console 中执行下面一行生成随机值，然后自行粘贴：

```js
Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
```

## 第二步：创建 Cloudflare Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers 和 Pages**，创建一个 Worker。
3. 名称可填写 `cnote-content-service`。
4. 完成初始部署后进入 Worker，打开在线代码编辑器。
5. 删除编辑器里的示例代码。
6. 从完整脚本页面复制全部内容，粘贴到编辑器。

## 第三步：配置访问令牌

有两种方式，任选一种。

### 方式 A：直接修改脚本顶部

把 `CNOTE_CONTENT_TOKEN` 改成自己生成的长随机字符串。适合快速部署。

```js
globalThis.CNOTE_CONTENT_TOKEN = "一段只供你自己使用的长随机字符串";
```

请不要把填有真实令牌的脚本提交到公开仓库。

### 方式 B：使用 Cloudflare 机密（推荐）

保持脚本顶部为空，在 Worker 的 **设置 → 变量和机密** 中添加：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `CN_CONTENT_TOKEN` | 机密 | 与 Cnote 中填写的访问令牌完全一致 |

环境变量优先于脚本顶部配置。以后轮换令牌时不需要重新粘贴完整脚本。

如果完全不配置令牌，任何知道 Worker 地址的人都可以调用它，不建议长期这样使用。

## 第四步：添加安全兼容标志

内容解析服务需要 Cloudflare 的安全兼容标志：

```text
global_fetch_strictly_public
```

在 Worker 的 **设置 → 运行时 → 兼容性标志**（或名称相近的栏目）中添加并保存。这个标志会让 Worker 的远程抓取严格走公开互联网地址。

如果你使用仓库中的 Wrangler 配置部署，该标志已经写在 [`workers/wrangler.toml`](../workers/wrangler.toml) 中。

## 第五步：可选地限制允许来源

如需只允许自己的 Cnote 页面调用，可以添加文本变量：

| 名称 | 类型 | 示例 |
| --- | --- | --- |
| `SCRAPER_ALLOWED_ORIGINS` | 文本变量 | `https://你的站点.example,http://localhost:5173` |

多个来源使用英文逗号分隔，并写完整的协议、域名和端口：

```text
https://lhc1119692022.github.io,http://localhost:5173
```

请不要在末尾添加路径。若暂时不确定 Cnote 的最终域名，可以先不配置，确认部署正常后再收紧来源。

## 第六步：部署并取得地址

点击在线编辑器中的 **部署**。成功后会得到类似地址：

```text
https://cnote-content-service.你的-Cloudflare-子域.workers.dev
```

如果配置了访问令牌，可以这样检查健康状态：

```bash
curl "https://你的-worker地址/v1/health" \
  -H "Authorization: Bearer 你的随机值"
```

正常响应会包含：

```json
{
  "status": "ok",
  "service": "cnote-content-service",
  "version": "当前服务版本",
  "capabilities": {}
}
```

未配置令牌时，可以直接在浏览器中打开 `/v1/health`。

## 第七步：填写 Cnote

进入 **Cnote → 设置 → 内容解析服务**：

1. “服务地址”填写 Worker 根地址，例如 `https://cnote-content-service.example.workers.dev`。
2. 不要在服务地址后追加 `/v1/health`、`/v1/web/extract` 或其他路径。
3. 如果 Worker 配置了 `CN_CONTENT_TOKEN`，在“访问令牌”中填写同一个值。
4. 点击 **测试并保存**。

连接成功后，Cnote 会显示服务版本和当前支持的能力。

## 常见问题

### 返回 401 或提示访问令牌无效

- Worker 已配置 `CN_CONTENT_TOKEN`，但 Cnote 中没有填写。
- Cnote 与 Worker 中的令牌不完全一致。
- Cloudflare 机密优先于脚本顶部配置；如果两处都填写，请以机密中的值为准。

### 返回 403 或提示当前站点未授权

- `SCRAPER_ALLOWED_ORIGINS` 中缺少当前 Cnote 页面的来源。
- 本地开发地址需要包含实际端口，例如 `http://localhost:5173`。
- GitHub Pages、自定义域名和本地地址是三个不同来源，需要分别加入。

### 健康检查正常，但某个网页解析失败

- 目标页面可能需要登录、验证码或地区权限。
- 网站可能拒绝数据中心网络，或必须执行复杂前端脚本。
- 页面或媒体可能超过脚本的大小、重定向或超时限制。
- 这类失败不一定代表 Worker 部署错误，可先用普通公开文章页面交叉测试。

### YouTube 没有字幕

- 视频本身可能没有字幕或禁止了字幕访问。
- 某些字幕轨道可能受地区、年龄或登录状态限制。
- Worker 不会绕过 YouTube 的账户权限。

## 使用命令行部署（可选）

如果你希望从源码部署和修改：

```bash
git clone https://github.com/lhc1119692022/Cnote.git
cd Cnote/workers
npm install
npx wrangler login
npm run deploy
```

配置访问令牌：

```bash
npx wrangler secret put CN_CONTENT_TOKEN
npm run deploy
```

## 更新脚本

项目更新后，可以重新打开[完整粘贴版脚本](../workers/dashboard/content-service.js)，复制全部内容覆盖 Worker 中的旧代码。使用 Cloudflare 机密时，覆盖脚本不会影响已有的令牌配置。兼容性标志和来源变量也会继续保留。
