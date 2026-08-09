# Cnote - 开源内容创作工作流工具

基于 Next.js 15 和 React 19 构建的内容创作和处理平台。

## ✨ 功能特性

### 核心功能

- **内容源管理** - 支持文本、网页、YouTube 视频等多种内容源
- **工作流编辑器** - 可视化流程编辑，支持多种节点类型
- **模板库** - 内置多种常用模板，快速开始创作
- **输出管理** - 统一管理所有生成的内容
- **风格配置** - 自定义写作风格和语调
- **API 管理** - 集成多个 AI 服务提供商

### 技术特性

- ⚡️ Next.js 15 App Router
- ⚛️ React 19 with Server Components
- 🎨 Tailwind CSS + Radix UI
- 📊 ReactFlow 工作流编辑器
- 💾 Better-SQLite3 + Drizzle ORM
- 🌐 国际化支持 (中文/英文)
- 🎯 TypeScript 严格模式
- 📦 静态导出，可直接部署

## 🚀 快速开始

### 环境要求

- Node.js 20.20.0 或更高版本
- npm 或 pnpm

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/cnote.git
cd cnote

# 安装依赖
npm install --legacy-peer-deps

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

### 构建

```bash
# 构建静态网站
npm run build

# 预览构建结果
npm run preview
```


## 📁 项目结构

```
cnote/
├── src/
│   ├── app/                    # Next.js App Router
│   │   └── [locale]/          # 国际化路由
│   │       └── (protected)/   # 受保护路由
│   │           └── dashboard/ # 主应用页面
│   ├── components/            # React 组件
│   │   ├── flow/             # 工作流编辑器
│   │   ├── sources/          # 内容源管理
│   │   ├── outputs/          # 输出管理
│   │   ├── templates/        # 模板管理
│   │   ├── settings/         # 设置页面
│   │   └── ui/               # 基础 UI 组件
│   ├── lib/                   # 工具库
│   │   ├── db/               # 数据库层
│   │   └── i18n/             # 国际化
│   └── styles/               # 全局样式
├── public/                    # 静态资源
└── package.json
```

## 🎨 核心组件

### 内容源管理 (SourcesManager)
- 支持文本、URL、YouTube、网页等多种内容类型
- 搜索和过滤功能
- 内容预览和管理

### 工作流编辑器 (FlowEditor)
- 基于 ReactFlow 的可视化编辑器
- 支持多种节点类型 (AI对话、网页抓取、输出等)
- 节点连接和流程执行

### 模板库 (TemplatesManager)
- 内置常用模板
- 按分类浏览
- 一键应用模板

### 输出管理 (OutputsManager)
- 查看所有生成内容
- 导出为 TXT 格式
- 搜索和过滤

### API Keys 管理 (ApiKeysManager)
- 支持 OpenAI、Anthropic、Google AI、DeepSeek 等
- 密钥加密存储
- 可见性控制

### 写作风格 (StyleProfilesManager)
- 自定义语调和风格
- 内置常用风格配置
- 目标受众设定

## 🗄️ 数据库

使用 Better-SQLite3 + Drizzle ORM，数据存储在本地 SQLite 数据库。

### 数据表

- `sources` - 内容源
- `flows` - 工作流
- `outputs` - 输出结果
- `api_keys` - API 密钥
- `style_profiles` - 风格配置
- `templates` - 模板

## 🌐 国际化

支持中文和英文界面，语言文件位于 `src/lib/i18n/locales/`。

## 🛠️ 技术栈

- **框架**: Next.js 15.2.8
- **UI**: React 19, Tailwind CSS, Radix UI
- **工作流**: ReactFlow 11
- **数据库**: Better-SQLite3, Drizzle ORM
- **AI SDK**: @ai-sdk/anthropic, openai, google, deepseek
- **类型检查**: TypeScript 5.x
- **包管理**: npm with --legacy-peer-deps

## 📝 License

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请提交 Issue。

---

**注意**: 本项目从 Creatos 项目恢复重写而来，已完全移除 License 验证系统，可自由使用和修改。
