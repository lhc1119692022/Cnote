# 部署 Cnote AI 跨域代理 Worker

这份教程用于解决部分 AI 服务商不允许浏览器直接调用 API 的跨域问题。代理部署在你自己的 Cloudflare 账户中，Cnote 项目维护者不会代管你的 Worker，也不会获得你的 API Key。

> 如果当前 AI 接口可以在 Cnote 中正常“拉取模型”和运行节点，就不需要部署代理。直连始终是更简单的默认方式。

## 先了解它会做什么

浏览器把请求发给你的 Worker，Worker 再把请求转发给对应的 AI 服务商：

```text
Cnote（浏览器） → 你自己的 Cloudflare Worker → OpenAI / Anthropic / Gemini 等服务商
```

- AI API Key 仍保存在当前浏览器，并随每次请求发送给 Worker。
- Worker 不会把 API Key 固定写进脚本。
- Worker 只开放模型列表、Chat Completions、Responses、Messages 和 Gemini 生成内容等有限路径。
- 可选的访问请求头用于减少别人直接滥用你的 Worker，但它在浏览器端并不是真正不可见的秘密。
- CORS 负责允许浏览器读取响应；访问请求头负责基础的调用校验，两者不是一回事。

## 准备工作

你需要：

1. 一个 Cloudflare 账户。
2. 对应 AI 服务商的 API Key。
3. Cnote 中准备添加或编辑的 AI 渠道。

Cnote 本身还没有部署到 GitHub Pages 也没关系。Worker 是独立服务，本地运行的 Cnote 同样可以连接它。

## 第一步：打开完整脚本

- [查看可直接粘贴的完整 AI 代理脚本](../workers/dashboard/ai-proxy.js)
- [打开 Raw 纯文本脚本](https://raw.githubusercontent.com/lhc1119692022/Cnote/master/workers/dashboard/ai-proxy.js)
- [查看便于二次开发的 TypeScript 源码](../workers/src/proxy.ts)

完整脚本顶部有一个明确标注的“可操作配置区”。除非你要修改代理能力，否则只需要处理最上面的两行：

```js
// 请求头名称建议保持固定，便于 CORS、日志和后续更新。
globalThis.CNOTE_PROXY_HEADER_NAME = "X-Cnote-Access";

// 改成自己生成的长随机字符串，不要使用这里的示例文字。
globalThis.CNOTE_PROXY_HEADER_VALUE = "请替换成随机值";
```

两项都留空表示关闭额外访问校验。只填写其中一项会被视为配置错误，Worker 会拒绝请求。

可以在任意浏览器的开发者工具 Console 中执行下面一行生成随机值，然后自行粘贴：

```js
Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
```

### 为什么请求头需要名称和值

HTTP 请求头本身就是“名称—值”结构。名称是固定字段标识，值才是可轮换的凭证。例如：

```http
X-Cnote-Access: 你的随机值
```

不要把随机值改成请求头名称。请求头名称会出现在 CORS 许可列表、代理配置和日志中，且大小写不敏感；保持名称固定、只更换值，更容易维护和脱敏。

## 第二步：创建 Cloudflare Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers 和 Pages**，创建一个 Worker。
3. 名称可填写 `cnote-ai-proxy`，也可以使用你喜欢的名称。
4. 完成初始部署后进入这个 Worker，打开在线代码编辑器。
5. 删除编辑器里的示例代码。
6. 从上面的完整脚本页面复制全部内容，粘贴到编辑器。

## 第三步：配置访问校验

有两种方式，任选一种即可。

### 方式 A：直接修改脚本顶部

这是最容易操作的方式：修改 `CNOTE_PROXY_HEADER_NAME` 和 `CNOTE_PROXY_HEADER_VALUE`，然后部署。

适合个人使用和快速部署。请不要把填有真实随机值的副本提交到公开仓库。

### 方式 B：使用 Cloudflare 变量和机密（推荐）

保持脚本顶部两项为空，然后在 Worker 的设置中添加：

| 名称 | 类型 | 示例或说明 |
| --- | --- | --- |
| `CN_PROXY_HEADER_NAME` | 文本变量 | `X-Cnote-Access` |
| `CN_PROXY_HEADER_VALUE` | 机密 | 一段长随机字符串 |

环境变量优先于脚本顶部配置。以后更换随机值时，只需要更新机密，不必重新修改整份脚本。

> Cloudflare 控制台的栏目名称可能随界面版本略有变化，通常位于 Worker 的 **设置 → 变量和机密** 或相近位置。

## 第四步：部署并取得地址

点击编辑器中的 **部署**。部署成功后，Cloudflare 会提供类似下面的地址：

```text
https://cnote-ai-proxy.你的-Cloudflare-子域.workers.dev
```

这个地址属于 Cloudflare，不是 Cnote 的 GitHub Pages 地址。

如果启用了访问请求头，可以用下面的方式检查健康状态：

```bash
curl "https://你的-worker地址/health" \
  -H "X-Cnote-Access: 你的随机值"
```

正常响应中会包含 `"status":"ok"`。未启用请求头时，可以直接在浏览器中打开 `/health`。

## 第五步：填写 Cnote 渠道

进入 **Cnote → 设置 → 渠道**，新增或编辑渠道。

接口地址需要在 Worker 地址后追加服务商路径：

| 服务商 | Cnote 接口地址 |
| --- | --- |
| OpenAI | `https://你的-worker地址/proxy/openai` |
| Anthropic | `https://你的-worker地址/proxy/anthropic` |
| DeepSeek | `https://你的-worker地址/proxy/deepseek` |
| Google Gemini | `https://你的-worker地址/proxy/google` |
| xAI | `https://你的-worker地址/proxy/xai` |
| Groq | `https://你的-worker地址/proxy/groq` |
| OpenRouter | `https://你的-worker地址/proxy/openrouter` |

然后填写：

1. 对应服务商的 API Key。
2. 与服务商匹配的 API 协议。
3. 如果 Worker 开启了访问校验，再填写完全一致的“请求头名称”和“请求头值”。
4. 点击 **拉取模型**，选择模型后保存渠道。

不要把 `/v1/models` 或 `/v1/chat/completions` 手动写进接口地址。Cnote 会根据协议自动追加实际 API 路径。

## 常见问题

### 返回 401

- Worker 已开启访问校验，但 Cnote 没有填写请求头。
- 请求头名称或值与 Worker 不一致。
- 编辑已有渠道时，请求头值留空表示保留旧值；如果 Worker 已换值，需要在 Cnote 中明确填写新值。

### 返回 404 或“此 AI 端点未开放代理”

- 检查接口地址是否为 `/proxy/服务商`，不要把健康检查地址当作接口地址。
- 当前脚本有端点白名单，不会转发文件管理、微调等未开放路径。

### 可以拉取模型，但运行节点失败

- 检查渠道所选协议是否与服务商一致。
- 检查模型 ID 是否由该服务商账户实际开放。
- 在 Cloudflare 的 Worker 日志中查看上游状态码，但不要把 API Key 复制到公开问题中。

### 请求头能完全防止别人使用 Worker 吗

不能。Cnote 是浏览器应用，使用者可以在开发者工具中看到发出的请求头。它适合避免 Worker 地址被随手公开调用，不适合作为高强度身份认证。如果需要严格控制，应把调用放到具有登录、会话和限流能力的后端。

## 更新脚本

项目更新后，可以重新打开[完整粘贴版脚本](../workers/dashboard/ai-proxy.js)，复制全部内容覆盖 Worker 中的旧代码。使用 Cloudflare 变量和机密时，覆盖脚本不会影响已有的请求头配置。
