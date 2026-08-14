# 第三方 API 跨域错误：部署 AI 代理

只有当 Cnote 显示“第三方 API 跨域错误！”时，才需要部署这个 Worker。能正常拉取模型和运行 AI 节点时，继续直连即可。

## 最容易填错：先看懂这两个地址

脚本和 Cnote 中填写的不是同一个地址：

- **脚本右边填写第三方 API 原接口地址**。
- **Cnote 的接口地址填写：Worker 地址 + `/proxy/线路名`**。

例如脚本中有一条名为 `api-1` 的线路：

```text
Cloudflare 给你的 Worker 地址：https://你的-worker.workers.dev
Cnote 最终填写的接口地址：https://你的-worker.workers.dev/proxy/api-1
```

不要自己慢慢拼。部署完成后，直接在浏览器打开 Worker 根地址，页面会把每条线路的完整 Cnote 接口地址列出来，复制即可。

一个 Worker 可以配置多条线路，分别转发到不同的第三方 API。

## 第一步：打开脚本

- [打开可直接复制的完整脚本](../workers/dashboard/ai-proxy.js)
- [打开更方便全选复制的纯文本脚本](https://raw.githubusercontent.com/lhc1119692022/Cnote/master/workers/dashboard/ai-proxy.js)

## 第二步：创建 Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers 和 Pages**，创建一个 Worker。
3. 名称可以填写 `cnote-ai-proxy`。
4. 打开这个 Worker 的在线代码编辑器。
5. 删除编辑器里的示例代码。
6. 复制上面的完整脚本，全部粘贴进去。

## 第三步：填写第三方 API 线路

脚本最上面会看到：

```js
globalThis.CNOTE_PROXY_ROUTES = {
  "api-1": "", // Cnote 接口地址：Worker 地址/proxy/api-1
  "api-2": "", // Cnote 接口地址：Worker 地址/proxy/api-2
};
```

左边是线路名，右边填写发生跨域错误的第三方 API 原接口地址：

```js
globalThis.CNOTE_PROXY_ROUTES = {
  "work": "https://第一个第三方接口地址",
  "personal": "https://第二个第三方接口地址",
};
```

线路名只能使用字母、数字、短横线和下划线。没有第二条线路时，让 `api-2` 右边保持为空即可；需要更多线路时，照着复制一行并换一个名称。

原接口地址不要额外添加 `/v1/models`、`/v1/responses` 等请求路径，也不要把 AI API Key 写进脚本。

## 第四步：填写访问校验

脚本顶部还有两行：

```js
globalThis.CNOTE_PROXY_HEADER_NAME = "X-Cnote-Access";
globalThis.CNOTE_PROXY_HEADER_VALUE = "";
```

请求头名称不懂就保持不变。请求头值建议填写一段至少 32 位、只有你知道的字符串。

这个 Worker 中的所有线路共用同一组请求头名称和值。稍后在每个 Cnote 渠道中都填写同样的内容。

## 第五步：部署并直接复制完整地址

1. 点击 Cloudflare 编辑器中的 **部署**。
2. 复制 Cloudflare 给出的 Worker 根地址。
3. 在浏览器中打开这个根地址。
4. 页面会列出类似下面的内容：

```text
work: https://你的-worker.workers.dev/proxy/work
personal: https://你的-worker.workers.dev/proxy/personal
```

这些就是已经拼好的 Cnote 接口地址，请直接复制对应的一条。不要删掉 `/proxy/线路名`，也不要继续追加其他路径。

## 第六步：回到 Cnote 填写渠道

进入 **Cnote → 设置 → 渠道**，为每个第三方 API 分别新增渠道：

1. **接口地址**：复制 Worker 页面中对应线路的完整地址。
2. **API Key**：填写这个第三方 API 原本的 API Key。
3. **API 协议**：选择这个第三方 API 使用的协议。
4. 展开 **第三方 API 跨域错误！**。
5. **请求头名称和值**：与 Worker 脚本顶部完全一致。
6. 点击 **拉取模型**，选择模型并保存。

## 遇到问题

### Worker 页面没有显示某条线路

检查脚本中该线路右边是否仍为空，并确认修改后已经重新部署。

### 提示没有找到线路

Cnote 接口地址末尾的线路名与脚本左边的名称不一致。重新打开 Worker 根地址，复制页面中完整的地址。

### 提示 401

检查 Cnote 中的请求头名称和值，必须与脚本顶部完全一致。

### 仍然拉取不到模型

确认该线路右边的第三方 API 原接口地址、API Key 和 API 协议正确。原接口地址不要手动追加模型或对话请求路径。

## 更新脚本

重新复制最新脚本，填回线路和请求头配置，再覆盖 Cloudflare 中的旧脚本并部署。部署后重新打开 Worker 根地址，复制最新显示的完整地址。
