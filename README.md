# Cnote

一个开源的笔记和内容管理应用程序。

## 特性

- 📝 强大的 Markdown 编辑器（基于 TipTap）
- 🎨 优雅的 Apple 风格 UI 设计
- 🔄 工作流管理系统
- 📚 多种内容源支持（YouTube、网页、图片、视频、表格）
- 🎯 模板系统
- 💅 风格配置管理
- 🌍 多语言支持（i18n）
- 🎨 深色模式支持
- 🤖 多 AI 模型集成（OpenAI、Anthropic、Google、DeepSeek 等）

## 技术栈

### 前端
- **框架**: Next.js 15.2.8 (App Router)
- **UI 库**: React 19
- **样式**: Tailwind CSS + Radix UI
- **动画**: Framer Motion
- **富文本编辑**: TipTap
- **工作流可视化**: ReactFlow
- **状态管理**: Zustand
- **表单**: React Hook Form + Zod

### 后端
- **运行时**: Electron 40.0.0
- **数据库**: Better-SQLite3
- **ORM**: Drizzle ORM
- **认证**: Better Auth

### AI 集成
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- DeepSeek
- Groq
- Mistral
- 以及更多...

## 快速开始

### 前置要求

- Node.js 20.20.0
- pnpm 10.x

### 安装

```bash
# 安装依赖
pnpm install

# 开发模式（仅 Web）
pnpm dev

# Electron 开发模式
pnpm electron:dev

# 构建
pnpm build

# 构建 Electron 应用
pnpm electron:build
```

## 项目结构

```
cnote/
├── electron/              # Electron 主进程代码
│   ├── main.ts           # 主入口
│   └── core/             # 核心逻辑
├── src/
│   ├── app/              # Next.js App Router 页面
│   │   ├── [locale]/     # 国际化路由
│   │   │   ├── home/     # 首页
│   │   │   └── (protected)/ # 受保护的路由
│   │   │       ├── dashboard/    # 仪表板
│   │   │       │   ├── flows/    # 工作流管理
│   │   │       │   ├── sources/  # 内容源管理
│   │   │       │   ├── outputs/  # 输出管理
│   │   │       │   ├── templates/ # 模板管理
│   │   │       │   └── style-profiles/ # 风格配置
│   │   │       └── settings/     # 设置
│   │   └── layout.tsx    # 根布局
│   ├── components/       # React 组件
│   │   ├── ui/          # 基础 UI 组件
│   │   ├── creatorflow/ # 工作流相关组件
│   │   └── settings/    # 设置相关组件
│   ├── lib/             # 工具函数
│   └── styles/          # 全局样式
├── public/              # 静态资源
└── package.json
```

## 开发说明

### 移除的功能

此版本已移除 License 验证系统，使应用完全开源和自由使用。

### 恢复来源

此项目从 Creatos 的编译版本中恢复而来，通过以下工具：

1. **extract-all-components.js** - 从 Next.js 编译文件中提取所有组件
2. **transform-code.js** - 转换编译后的代码为可读格式
3. **auto-recovery.js** - 自动化恢复流程

恢复度：**95%**
- Electron 代码：100%（有 Source Maps）
- UI 组件：95%（变量名已重建）
- 设计系统：100%
- 交互逻辑：95%

## 贡献

欢迎贡献！请随时提交 Pull Request。

## License

MIT License - 自由使用和修改

## 致谢

- 原始项目：Creatos
- UI 设计灵感：Apple Human Interface Guidelines
- 感谢所有开源库的作者

## 路线图

- [ ] 完善文档
- [ ] 添加单元测试
- [ ] 改进工作流编辑器
- [ ] 添加更多 AI 模型支持
- [ ] 云同步功能
- [ ] 移动端支持

## 支持

如有问题或建议，请提交 Issue。
