# 部署 Cnote 内容解析 Worker

这个 Worker 用来读取公开网页正文、YouTube 字幕和部分社媒公开内容。它和 AI 渠道没有关系，也不需要 AI API Key。

## 最容易填错：服务地址怎么填

Cnote 的“服务地址”只填写 Cloudflare 给你的 **Worker 根地址**：

```text
https://你的-worker.workers.dev
```

不要在后面添加 `/v1/health`、`/v1/web/extract` 或其他路径。

部署完成后，可以直接在浏览器打开 Worker 根地址。页面会显示已经准备好的服务地址，完整复制到 Cnote 即可。

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

## 第三步：填写最上面的访问令牌

脚本最上面有一块醒目的“访问令牌”区域：

```js
/* ==================== 部署前先填：访问令牌 ==================== */
globalThis.CNOTE_CONTENT_TOKEN = "";
```

在引号中填一段至少 32 位、只有你知道的字符串，例如由密码管理器生成的一串随机字符。

请记住这串内容。稍后需要把完全相同的内容粘贴到 Cnote 的“访问令牌”中。

留空虽然也能运行，但知道 Worker 地址的人都可以调用它。不要把填有真实令牌的脚本提交到公开仓库。

## 第四步：部署并复制服务地址

1. 点击 Cloudflare 编辑器中的 **部署**。
2. 在浏览器中打开 Cloudflare 给你的 Worker 根地址。
3. 页面会显示：

```text
请把下面完整地址复制到 Cnote → 设置 → 内容解析服务 → 服务地址：
https://你的-worker.workers.dev
```

直接复制页面显示的地址，不要追加其他路径。

## 第五步：添加兼容性标志

进入这个 Worker 的 **设置 → 运行时 → 兼容性标志**，添加下面这行并保存：

```text
global_fetch_strictly_public
```

这个名字不用理解，照着复制即可。缺少它时，内容解析可能无法正常工作。

## 第六步：填回 Cnote

进入 **Cnote → 设置 → 内容解析服务**：

1. **服务地址**：复制 Worker 页面显示的完整地址。
2. **访问令牌**：粘贴脚本顶部填写的同一串内容。
3. 点击 **测试并保存**。

## 遇到问题

### 提示访问令牌无效

检查脚本和 Cnote 中的令牌是否完全相同，然后确认修改脚本后已经重新部署。

### 提示服务不存在或 404

检查服务地址后面是否多了 `/v1/health` 或其他路径。重新打开 Worker 根地址，复制页面显示的地址。

### 能连接，但某个网页解析失败

先换一个不需要登录的普通公开文章测试。需要登录、验证码、付费或地区权限的页面不一定能读取。

### YouTube 没有字幕

视频本身可能没有字幕，或者字幕需要登录、年龄或地区权限。

## 更新脚本

重新复制最新脚本，填回顶部访问令牌，再覆盖 Cloudflare 中的旧脚本并部署。服务地址通常不会改变，可以重新打开 Worker 根地址确认。
