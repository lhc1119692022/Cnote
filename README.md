# Cnote

**Web 优先的知识工作流应用 - 基于 Vite + React 19**

## 🎯 项目简介

Cnote 是一个开源的知识工作流应用，专为个人知识工作者和内容创作者设计。通过可视化的流程编排，连接内容输入、AI 处理和内容输出，实现高效的研究辅助、多源写作和内容迭代。

### 核心特性

- 🎨 **无限画布** - 基于 React Flow 的可视化工作流编辑器
- 🤖 **AI 集成** - 支持 Anthropic Claude、OpenAI GPT、Google Gemini 等主流模型
- 📝 **富文本编辑** - 完整的内容创作和编辑能力
- 🌐 **Web 优先** - 可构建为静态站点，适合支持 SPA 路由回退的托管服务
- 💾 **本地存储** - 基于 IndexedDB，无需服务器
- 🔐 **本地优先** - Flow、资源和 API Key 保存在当前浏览器；API Key 仅作本地混淆
- 🇨🇳 **中文界面** - 当前版本以中文界面为准
- 📦 **双重导出** - JSON 用于分享工作流结构，ZIP 完整备份同时包含本地资源

### 技术栈

- **构建工具**: Vite 6
- **前端框架**: React 19
- **路由**: React Router 7
- **状态管理**: Zustand 5
- **本地存储**: LocalForage (IndexedDB)
- **UI 框架**: TailwindCSS 4 + shadcn/ui
- **流程图**: React Flow
- **国际化**: i18next

## 🚀 快速开始

### Web 应用开发

```bash
# 克隆项目
git clone https://github.com/lhc1119692022/Cnote.git
cd cnote/web

# 安装依赖
npm install

# 配置环境变量（可选）
cp .env.example .env

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

访问 http://localhost:5173 开始使用。

### 可选：部署自己的 Cloudflare Worker

AI 跨域代理与内容解析服务是两个完全独立的 Worker。产品内只保留配置入口，详细步骤和可直接粘贴的脚本见：

- [AI 跨域代理 Worker 部署教程](./docs/AI_PROXY_WORKER.md)
- [内容解析 Worker 部署教程](./docs/CONTENT_SERVICE_WORKER.md)

未配置内容解析 Worker 时，本地文件、URL 输出和 YouTube 播放仍可使用；网页正文、YouTube 字幕、社媒和公开网页文档预览会明确提示需要内容解析服务。

## 📖 开发计划

- [x] Phase 0: 项目清理和初始化
- [x] Phase 1: 基础架构搭建
- [x] Phase 2: Flow 编辑器
- [x] Phase 3: 节点组件
- [x] Phase 4: AI 集成
- [x] Phase 5: 数据流引擎
- [x] Phase 6: 功能模块 (模板、内容库、本地存储)
- [x] Phase 7: API 开发 (Cloudflare Workers)
- [ ] Phase 8: 测试和优化

详细开发计划见：[CNOTE_TECHNICAL_ARCHITECTURE.md](./CNOTE_TECHNICAL_ARCHITECTURE.md)

## 📁 项目结构

```
cnote/
├── web/                    # Web 应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   │   ├── flow/     # Flow 编辑器组件
│   │   │   ├── settings/ # 设置组件
│   │   │   └── ui/       # UI 基础组件
│   │   ├── pages/        # 页面组件
│   │   ├── stores/       # Zustand 状态管理
│   │   ├── lib/          # 工具库
│   │   │   ├── api/      # AI API 客户端
│   │   │   ├── flow/     # Flow 执行引擎
│   │   │   └── scraper/  # Web scraper 客户端
│   │   ├── config/       # 配置文件
│   │   └── types/        # TypeScript 类型
│   └── public/           # 静态资源
├── workers/              # Cloudflare Workers
│   ├── dashboard/        # 可直接粘贴到 Cloudflare 控制台的脚本
│   ├── src/
│   │   ├── proxy.ts     # AI API 代理
│   │   └── scraper.ts   # 网页抓取
│   └── wrangler.toml    # Workers 配置
└── docs/                # 文档
```

## 🤝 贡献

欢迎贡献！请查看 [贡献指南](./CONTRIBUTING.md)。

## 📄 许可证

[MIT License](./LICENSE)

## 🔗 相关链接

- [技术架构文档](./CNOTE_TECHNICAL_ARCHITECTURE.md)
- [提取数据参考](./extracted-data/)
- [问题反馈](https://github.com/lhc1119692022/Cnote/issues)

---

**从 Creatos 的理念出发，构建开放的未来** 🚀
