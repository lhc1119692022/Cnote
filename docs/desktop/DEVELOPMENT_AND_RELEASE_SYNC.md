# Web 与 Desktop 的同步和发布规则

## 1. 保持在同一个仓库

Web Preview 和 Desktop Runtime 继续放在同一个 GitHub 仓库、同一个产品版本线中：

```text
Cnote/
├── web/       # 快速体验、分享和兼容入口
├── desktop/   # Windows 优先的完整产品运行时
├── workers/   # Web 必需服务和 Desktop fallback
└── docs/      # 产品、架构和迁移规则
```

不建立“Web 一个仓库、Desktop 另一个仓库”的分叉关系。两端共享领域类型、Flow 契约、备份格式和文档；运行时能力通过 Adapter/Runtime Port 分开实现。

## 2. Desktop-First 的变更顺序

从现在开始，所有产品能力都按下面的顺序推进：

```text
Desktop 设计/实现
  → Desktop 本地体验
  → Desktop 类型检查、构建和验证
  → 抽取或更新共享契约
  → Web Preview 降级适配
  → Web 构建与线上发布
```

Desktop 是产品真源（source of truth），Web 是 Preview/Compatibility Adapter。Web 端不能先定义一个会反过来限制桌面端的能力模型。

## 3. 每次改动的同步原则

- 领域模型、Flow schema、节点输入输出契约变更时，同一个提交同时更新 Web 兼容实现和 Desktop 实现。
- Desktop 专属能力不强行塞进 Web；为 Web 提供降级、提示或可导出的兼容子集。
- Web 无法提供的能力必须在 Desktop 代码和文档中明确，不通过 iframe 或远程 Worker 假装已经支持。
- 用户数据不进入 Git：Flow、资源、Cookie、API Key、任务日志都只在本机或用户主动导出的备份中保存。

## 4. 分支和提交建议

日常开发可以使用短期分支，例如 `codex/desktop-browser-runtime`，完成后合并到 `master`。不需要维护长期的 `web` 分支和 `desktop` 分支。

一个可审查的功能提交应尽量包含：

1. 共享契约/类型；
2. Desktop 实现；
3. Web 降级或桥接；
4. 迁移说明和测试；
5. 文档中的能力矩阵更新。

## 5. 自动检查

每个 Pull Request 和推送都应按 Desktop → Web → Workers 的顺序检查：

- `web`: `npm ci`、`npm run build`；
- `desktop`: `npm ci --ignore-scripts`、`npm run typecheck`、`npm run build`；
- `workers`: 现有 contract tests。

只有 Desktop 检查通过后，Web Preview 和 Workers 检查才进入后续阶段。合并到 `master` 后，GitHub Pages 继续发布 Web Preview；桌面安装包发布另行增加，不影响线上体验版的发布节奏。

## 6. 版本和迁移

- Web 与 Desktop 可以有独立的运行时版本，但共享的备份 `format/version/schemaVersion` 必须向后兼容。
- Desktop 新增能力时，先让旧备份可导入，再考虑导出桌面专属能力。
- 破坏性 schema 变更必须提供迁移函数和迁移报告，不能只依赖当前代码“碰巧能读”。
- 安装包升级不等于数据迁移；用户数据目录必须有独立的备份和恢复策略。

## 7. 当前推荐发布顺序

```text
提交代码
  → Desktop 自动检查
  → Web/Workers 兼容检查
  → 合并 master
  → Windows Desktop 内测包
  → GitHub Pages 发布 Web Preview
  → 收集体验反馈
  → 再扩大 Desktop 能力
```

当前不引入自动云同步和账号体系。先用 `.cnote.zip` 做 Web ↔ Desktop 的明确交换边界，等桌面核心体验稳定后再单独设计同步协议。
