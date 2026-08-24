# Cnote 设计文档

## 文档目的

这一组文档描述 Cnote 的桌面端方向。桌面端不是现有 Web 应用的简单打包，而是一个以本地能力为主、Web 版作为快速体验入口的独立产品运行时。

当前 Web 项目提供了已经验证过的用户场景、交互样例、数据格式和解析经验，但不作为桌面端的技术边界。桌面端可以重新定义产品模型和运行方式，只在确实有价值的地方复用现有代码。

## 阅读顺序

1. [Desktop 产品原则](./PRODUCT_PRINCIPLES.md)
2. [Desktop 能力矩阵](./CAPABILITY_MATRIX.md)
3. [领域模型与运行时架构](./DOMAIN_AND_RUNTIME_ARCHITECTURE.md)
4. [Web 与 Desktop 的同步和发布规则](./DEVELOPMENT_AND_RELEASE_SYNC.md)

## 当前结论

- Desktop 是完整产品，Web 是 Preview/Compatibility Runtime。
- Desktop 是产品真源；能力先在 Desktop 上设计、实现、体验和验证，再同步到 Web Preview。
- Electron 是桌面容器，不是产品架构本身。
- 共享的是领域模型、Flow 语义、数据格式和契约，不是浏览器限制。
- 本地能力优先；远程 Worker 作为 Web 必需能力和 Desktop 的 fallback。
- 原生浏览器、后台任务、本地内容处理、文件系统和系统集成属于桌面端一等能力。
- 任何高权限能力都必须通过隔离、授权和可审计的边界提供。

## 当前默认断言

用户不需要先理解 Cookie、IndexedDB 或云同步的实现细节。当前先采用 Windows 优先、会话可登录且按工作区隔离、`.cnote.zip` 文件迁移且暂不做云同步的默认方案。完整规则见[会话与迁移默认规则](./SESSION_AND_MIGRATION_DEFAULTS.md)。

## 当前阶段

第一条桌面垂直切片已经落地：`desktop/` 提供 Electron Shell、受控 preload/IPC、原生浏览器会话、工作区内 `WebContentsView` 挂载、主进程网络端口、版本化本地 HTML 解析器、OS 安全存储和可恢复任务状态；Web 浏览器节点在检测到桌面桥接后会切换为原生会话并支持页面捕获。下一阶段再把 Flow 后台执行和迁移向导接入这些端口。

## 后续通过体验确认的断言

- 默认会话是否需要按项目进一步隔离；
- 页面捕获是否增加持续监听和元素选择；
- 是否允许任务自动打开登录页面并等待人工确认；
- 是否引入可选的加密迁移包（包含用户主动选择的秘密）；
- 本地模型、FFmpeg、OCR/ASR 和外部脚本的权限与安装体验。
