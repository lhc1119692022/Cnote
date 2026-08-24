# 领域模型与运行时架构

## 1. 架构目标

本架构不把现有 Web 目录结构直接搬到 Electron，而是先定义稳定的领域对象和运行时边界。

目标：

- Desktop 拥有完整本地能力；
- Web 可以复用共享核心并提供降级实现；
- 业务语义不依赖具体浏览器 API；
- 长任务、资源和页面捕获可以持久化；
- API Key、文件和不可信网页保持隔离；
- 后续可以加入本地模型、插件和外部工具。

## 2. 建议的领域对象

```text
Workspace
└── Project
    ├── Flow
    │   ├── Node
    │   └── Edge
    ├── BrowserSession
    │   └── Capture
    ├── ContentAsset
    ├── Job / Run
    ├── OutputArtifact
    ├── ProviderConnection
    └── PluginInstance
```

### Workspace

用户数据和运行时配置的边界。可以对应一个个人工作区、一个项目集合或未来的同步空间。

### Project

围绕一个研究、创作或自动化目标组织 Flow、来源、资源、任务和输出。

### Flow

可视化或程序化的工作流定义。Flow 保存的是声明式结构，不直接持有运行时对象。

### Node / Edge

Node 描述可编排能力，Edge 描述数据或事件关系。节点类型不应永久写死为一个大型联合类型，未来应允许插件注册 schema 和执行器。

### BrowserSession

浏览器配置文件、Cookie、权限、标签和会话状态的容器。BrowserSession 不等同于 BrowserNode；多个节点和任务可以引用同一个会话，也可以要求隔离会话。

### Capture

一次页面或资源捕获结果，包含原始来源、快照、解析结果、资源和溯源信息。Capture 是进入 Flow 的稳定内容对象。

### ContentAsset

本地文件、页面正文、图片、视频、音频、文档、结构化数据或其派生结果。资源使用内容哈希和稳定 ID，允许去重、引用计数和迁移。

### Job / Run

Job 是可持久化的后台任务，Run 是某一次 Flow 执行实例。两者应保存状态、检查点、输入版本、输出和错误。

### OutputArtifact

AI 输出、编辑文档、图片、视频、音频、导出文件或其他结果。输出应保留来源 Flow、输入 Capture 和生成渠道。

### ProviderConnection

模型、内容服务、本地工具或远程 API 的连接配置。密钥本身不进入普通领域数据，而由 SecretStore 管理。

### PluginInstance

一个已安装扩展及其配置、版本、权限和迁移状态。

## 3. 运行时拓扑

```text
┌──────────────────────────────────────────────┐
│ Desktop Shell                                │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ UI Renderer  │  │ Native Browser Host  │  │
│  │ Canvas/Views │  │ Sessions/Tabs/DOM    │  │
│  └──────┬───────┘  └──────────┬───────────┘  │
│         │ controlled IPC       │              │
│  ┌──────▼──────────────────────▼───────────┐  │
│  │ Main Orchestrator                       │  │
│  │ runtime ports / jobs / permissions      │  │
│  └──────┬───────────┬───────────┬──────────┘  │
│         │           │           │             │
│  ┌──────▼────┐ ┌────▼─────┐ ┌──▼──────────┐  │
│  │ Data Layer│ │ Local    │ │ Plugin Host │  │
│  │ DB/files  │ │ Workers  │ │ permissions │  │
│  └───────────┘ └──────────┘ └─────────────┘  │
└──────────────────────────────────────────────┘
             │ optional remote fallback
             ▼
      Cloudflare Workers / AI APIs / User Services
```

## 4. Runtime Port 方向

当前实现的主进程任务边界：`JobManager` 负责持久化状态，`NativeJobRunner` 负责调度 `native:content-parse` 与 `native:network-request`。完整 Flow 的 AI/浏览器节点仍通过受控 renderer 执行，后续按节点逐步迁移到 Native Runner 或独立 worker。

共享核心不应直接调用 `window.fetch`、`localStorage`、`URL.createObjectURL` 或 DOM。它应依赖能力接口。

```ts
interface RuntimePorts {
  network: NetworkPort
  browser: BrowserPort
  content: ContentPort
  storage: DataPort
  resources: ResourcePort
  secrets: SecretPort
  jobs: JobPort
  nativeJobs: NativeJobPort
  system: SystemPort
  plugins: PluginPort
}
```

Web Runtime 为这些接口提供浏览器实现；Desktop Runtime 为这些接口提供主进程、本地服务和原生浏览器实现。

## 5. 浏览器节点的新语义

浏览器节点不直接保存一个 iframe，而是保存声明：

```text
BrowserNode
├── sessionId
├── activeTarget
├── navigationPolicy
├── capturePolicy
├── outputMode
└── latestCaptureId
```

浏览器会话负责访问页面；Capture 负责保存页面结果；Flow 节点负责引用和传递结果。这样可以避免把易变的页面状态和稳定的 Flow 数据混在一起。

## 6. 内容解析管线

内容解析器应采用注册式管线，而不是把所有平台判断堆在一个函数中：

```text
Source Resolver
→ Fetcher / Browser Capture
→ Provider Adapter
→ Normalizer
→ Extractor
→ Media Resolver
→ Provenance Builder
→ ContentAsset
```

每个解析器需要声明：

- 支持的来源和 URL 模式；
- 是否需要浏览器会话；
- 是否需要登录态；
- 产出的 schema；
- 版本和兼容范围；
- 失败类型和是否可重试。

现有 Content Worker 可以作为一个远程 Provider Adapter 接入，而不是成为解析器的唯一实现。

## 7. 任务模型

任务至少需要以下状态：

```text
created → validating → queued → running → checkpointed
                         ├──────────────→ completed
                         ├──────────────→ failed
                         ├──────────────→ cancelled
                         └──────────────→ waiting-for-user
```

任务记录需要保存：

- 输入对象版本；
- 使用的 Flow 版本；
- 使用的 Provider 和模型；
- 当前检查点；
- 产出资源；
- 错误和重试次数；
- 是否允许重启后恢复。

## 8. 数据与迁移

第一阶段可以继续兼容现有 Web 的 `.cnote.zip`，但需要引入正式的迁移机制：

- 所有领域对象有 schema version；
- 每个版本有明确迁移函数；
- 备份 manifest 记录应用版本和 schema 版本；
- 旧资源 ID 保持可解析；
- Web → Desktop 通过导入向导迁移，而不是读取另一套浏览器 IndexedDB；
- Desktop → Web 只导出 Web 能理解的子集，并显式提示降级。

## 9. 安全边界

- Renderer 只访问白名单 IPC；
- 主进程不把密钥返回给不可信页面；
- Native Browser Host 与 Cnote UI 使用不同的权限边界；
- 页面脚本、插件和外部工具默认无权访问文件和秘密；
- 文件、网络和系统操作通过授权接口执行；
- 任务日志不得记录密钥、Cookie 或完整敏感请求体。

## 10. 实施顺序

### Phase A：设计冻结

- 确认 Desktop 产品原则；
- 确认目标操作系统和信任模型；
- 确认浏览器会话语义；
- 确认第一版数据迁移方式。

### Phase B：桌面垂直切片

- Electron Shell；
- 主进程和受控 IPC；
- 一个原生浏览器会话（优先嵌入工作区，必要时弹出独立窗口）；
- 页面捕获和本地解析；
- 一个 AI Provider；
- 一个可恢复 Flow 任务。

### Phase C：共享核心

- 抽取 Flow schema 和执行语义；
- 抽取 Runtime Ports；
- 将 Web 改为 Preview Adapter；
- 保持现有备份格式可迁移。

### Phase D：桌面差异化

- 多会话和登录态；
- 文件系统和媒体处理；
- 任务中心；
- 本地索引；
- 插件和脚本；
- 安装、更新、崩溃恢复。

## 11. 当前明确不继承的实现假设

- iframe 是最终浏览器节点；
- Web fetch 是统一网络层；
- Worker 是内容解析唯一来源；
- IndexedDB 是 Desktop 的最终资源存储；
- 固定 NodeType 联合类型可以覆盖全部扩展；
- 页面前台执行可以满足长任务；
- XOR 混淆可以作为桌面密钥保护；
- Web 和 Desktop 必须有完全相同的能力。
