# Cnote

这是 Cnote 的 Windows-first 桌面运行时。它不是把 Web 页面简单打包，而是提供一层独立的本地能力：原生浏览器会话、主进程网络、受控 IPC、系统安全存储和可恢复任务。

## 开发

桌面端开发命令会自动构建当前 Web Preview，再构建桌面运行时：

```powershell
npm run dev
```

运行桌面运行时的无窗口契约检查：

```powershell
npm run typecheck
npm run test:runtime
```

如果希望直接连接 Vite 开发服务，可以先在另一个终端启动 Web Vite 服务，再设置环境变量：

```powershell
npm --prefix ..\web run dev
$env:CNOTE_WEB_DEV_SERVER = 'http://localhost:5173'
npm run build
npx electron . --dev
```

如果没有设置 `CNOTE_WEB_DEV_SERVER`，桌面端会加载 `..\web\dist\index.html`。生产包也会使用这个构建产物。

## 当前垂直切片

- Cnote UI 通过最小 preload API 访问桌面能力；
- 浏览器会话默认以 `WebContentsView` 嵌入 Cnote 工作区，使用持久化、按工作区隔离的 Electron session partition；没有可用挂载点时自动退回独立窗口；
- 浏览器页面不能访问 Node.js、文件系统或 Cnote 的 IPC；
- 主进程提供导航、刷新、关闭、页面元数据/正文/DOM 捕获；
- 页面捕获后的 HTML 可通过版本化的本地解析器生成正文、标题层级、链接和解析警告；
- API 密钥只允许由主进程内部的 SecretStore 读取，渲染层只能查询是否已配置；
- 原生文件打开/保存对话框已接入 `.cnote.zip` 等迁移文件；
- Flow 执行会在 Desktop 下创建持久化 Job，并按节点写入检查点；应用重启后中断任务恢复为 `queued`，当前 Flow 可以从工具栏继续；
- 主进程 Native Job Runner 已支持 `native:content-parse` 和 `native:network-request`，任务具备排队、并发上限、取消、失败记录和重启后继续；网络任务的敏感请求头只能引用 SecretStore 名称；
- 普通迁移包只包含 Flow 与本地资源，不包含 Cookie、登录态、API Key、任务日志或系统路径。

## 当前边界

当前完整 Flow 的 AI/浏览器编排仍运行在 Desktop 的受控 renderer 中；主进程 Native Job Runner 已可承接本地解析和网络任务。下一步将把更多 Flow 节点适配到 Native Job Runner 或独立 worker，避免窗口渲染生命周期影响真正的后台执行。

Electron 实际窗口启动需要本机 Electron 二进制和图形环境；无窗口契约测试不会替代真实 UI 验证。
