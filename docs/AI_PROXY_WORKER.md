# 第三方 API 跨域错误：部署 AI 代理

只有当 Cnote 显示“第三方 API 跨域错误！”时，才需要部署这个 Worker。

如果能正常拉取模型和运行 AI 节点，直接使用原接口即可，不用继续看这篇教程。

开始前准备好：

1. 一个 Cloudflare 账户。
2. 发生跨域错误的第三方 API 原接口地址。
3. 这个第三方 API 的 API Key。

## 第一步：打开脚本

- [打开可直接复制的完整脚本](../workers/dashboard/ai-proxy.js)
- [打开更方便全选复制的纯文本脚本](https://raw.githubusercontent.com/lhc1119692022/Cnote/master/workers/dashboard/ai-proxy.js)

先不要修改脚本中“以下内容不用修改”后面的代码。

## 第二步：创建 Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers 和 Pages**，创建一个 Worker。
3. 名称可以填写 `cnote-ai-proxy`。
4. 打开这个 Worker 的在线代码编辑器。
5. 删除编辑器里的示例代码。
6. 复制上面的完整脚本，全部粘贴进去。

## 第三步：只填写脚本最上面的 3 项

脚本顶部会看到下面几行：

```js
// 填发生跨域错误的第三方 API 原接口地址
globalThis.CNOTE_PROXY_UPSTREAM_URL = "";

// 这个名称不懂就保持不变
globalThis.CNOTE_PROXY_HEADER_NAME = "X-Cnote-Access";

// 填一段只有你知道的长字符串
globalThis.CNOTE_PROXY_HEADER_VALUE = "";
```

填写时注意：

- `CNOTE_PROXY_UPSTREAM_URL` 填你原来在 Cnote“接口地址”中填写的第三方 API 地址。
- 不要把 Cloudflare 的 Worker 地址填到这里。
- 不要额外添加 `/v1/models`、`/v1/responses` 等请求路径。
- 不要把 AI API Key 写进脚本。
- 请求头值建议使用至少 32 位、只有你知道的字符串。稍后还要把同一串内容填入 Cnote。

一个 Worker 只转发一个第三方 API。另一个第三方接口也发生跨域错误时，请再创建一个 Worker。

## 第四步：部署并复制 Worker 地址

点击 Cloudflare 编辑器中的 **部署**。

部署成功后，Cloudflare 会显示一个类似下面的地址：

```text
https://cnote-ai-proxy.你的子域.workers.dev
```

请复制 Cloudflare 实际显示的完整地址，不要照抄上面的示例文字。

## 第五步：回到 Cnote 填写渠道

进入 **Cnote → 设置 → 渠道**，新增或编辑渠道：

1. **接口地址**：直接粘贴 Cloudflare 给你的 Worker 地址。
2. **API Key**：填写第三方 API 原本的 API Key。
3. **API 协议**：选择这个第三方 API 使用的协议。
4. 展开 **第三方 API 跨域错误！**。
5. **请求头名称**：填写 `X-Cnote-Access`。
6. **请求头值**：填写脚本中的同一串值。
7. 点击 **拉取模型**，选择模型并保存。

接口地址只填 Worker 根地址，不需要再拼接 `/proxy/openai` 或任何请求路径。

## 遇到问题

### 提示 401

检查 Cnote 中的请求头名称和值，必须与脚本顶部完全一致。

### 提示先填写第三方 API 原接口地址

脚本顶部的 `CNOTE_PROXY_UPSTREAM_URL` 仍为空，或填写的不是完整地址。修改后重新部署。

### 仍然拉取不到模型

先确认第三方 API 原接口地址、API Key 和 API 协议都正确。接口地址不要手动追加模型或对话请求路径。

## 更新脚本

以后需要更新时，重新复制最新的完整脚本，填回顶部 3 项，再覆盖 Cloudflare 中的旧脚本并部署。
