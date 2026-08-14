# 部署 Cnote 内容解析 Worker

这个 Worker 用来读取公开网页正文、YouTube 字幕和部分社媒公开内容。它和 AI 渠道没有关系，也不需要 AI API Key。

你只需要一个 Cloudflare 账户。按照下面的步骤做完，再把地址和访问令牌填回 Cnote 即可。

## 第一步：打开脚本

- [打开可直接复制的完整脚本](../workers/dashboard/content-service.js)
- [打开更方便全选复制的纯文本脚本](https://raw.githubusercontent.com/lhc1119692022/Cnote/master/workers/dashboard/content-service.js)

## 第二步：创建 Worker

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers 和 Pages**，创建一个 Worker。
3. 名称可以填写 `cnote-content-service`。
4. 打开这个 Worker 的在线代码编辑器。
5. 删除编辑器里的示例代码。
6. 复制上面的完整脚本，全部粘贴进去。

## 第三步：先填写最上面的访问令牌

脚本最上面有一块很醒目的“访问令牌”区域：

```js
/* ==================== 部署前先填：访问令牌 ==================== */
globalThis.CNOTE_CONTENT_TOKEN = "";
```

在引号中填一段至少 32 位、只有你知道的字符串，例如由密码管理器生成的一串随机字符。

请记住这串内容。稍后需要把完全相同的内容粘贴到 Cnote 的“访问令牌”中。

不要把真实令牌提交到公开仓库，也不要把它发给别人。留空虽然也能运行，但知道 Worker 地址的人都可以调用它。

填好后，点击 Cloudflare 编辑器中的 **部署**。

## 第四步：添加兼容性标志

进入这个 Worker 的 **设置 → 运行时 → 兼容性标志**，添加下面这行并保存：

```text
global_fetch_strictly_public
```

这个名字不用理解，照着复制即可。缺少它时，内容解析可能无法正常工作。

## 第五步：复制 Worker 地址

Cloudflare 会显示一个类似下面的地址：

```text
https://cnote-content-service.你的子域.workers.dev
```

请复制 Cloudflare 实际显示的完整地址，不要照抄示例文字。

## 第六步：填回 Cnote

进入 **Cnote → 设置 → 内容解析服务**：

1. **服务地址**：粘贴 Cloudflare 给你的 Worker 地址。
2. **访问令牌**：粘贴脚本顶部填写的同一串内容。
3. 点击 **测试并保存**。

服务地址只填 Worker 根地址，不要追加 `/v1/health` 或其他路径。

## 遇到问题

### 提示访问令牌无效

检查脚本和 Cnote 中的令牌是否完全相同，然后确认修改脚本后已经重新部署。

### 能连接，但某个网页解析失败

先换一个不需要登录的普通公开文章测试。需要登录、验证码、付费或地区权限的页面不一定能读取。

### YouTube 没有字幕

视频本身可能没有字幕，或者字幕需要登录、年龄或地区权限。

## 更新脚本

以后需要更新时，重新复制最新的完整脚本，填回顶部访问令牌，再覆盖 Cloudflare 中的旧脚本并部署。
