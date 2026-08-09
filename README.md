# Cnote

**Web 优先的知识工作流应用 - 基于 Vite + React 19**

## 🎯 项目简介

Cnote 是一个开源的知识工作流应用，专为个人知识工作者和内容创作者设计。通过可视化的流程编排，连接内容输入、AI 处理和内容输出，实现高效的研究辅助、多源写作和内容迭代。

### 核心特性

- 🎨 **无限画布** - 基于 React Flow 的可视化工作流编辑器
- 🤖 **AI 集成** - 支持 Anthropic Claude、OpenAI GPT、Google Gemini 等主流模型
- 📝 **富文本编辑** - 完整的内容创作和编辑能力
- 🌐 **Web 优先** - 纯静态部署，GitHub Pages 即可运行
- 💾 **本地存储** - 基于 IndexedDB，无需服务器
- 🔐 **隐私优先** - API Key 加密存储，数据完全本地化
- 🌍 **国际化** - 中英文双语支持

### 技术栈

- **构建工具**: Vite 7
- **前端框架**: React 19
- **路由**: React Router 7
- **状态管理**: Zustand 5
- **本地存储**: LocalForage (IndexedDB)
- **UI 框架**: TailwindCSS 4 + shadcn/ui
- **流程图**: React Flow
- **富文本**: TipTap
- **国际化**: i18next

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/yourusername/cnote.git
cd cnote

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 📖 开发计划

- [x] Phase 0: 项目清理和初始化
- [ ] Phase 1: 基础架构搭建 (3-5 天)
- [ ] Phase 2: Flow 编辑器 (5-7 天)
- [ ] Phase 3: 节点组件 (7-10 天)
- [ ] Phase 4: AI 集成 + Proxy (5-7 天)
- [ ] Phase 5: 数据流引擎 (4-5 天)
- [ ] Phase 6: 功能模块 (4-5 天)
- [ ] Phase 7: API 开放 (3-4 天)
- [ ] Phase 8: 测试和优化 (3-4 天)

详细开发计划见：[CNOTE_TECHNICAL_ARCHITECTURE.md](./CNOTE_TECHNICAL_ARCHITECTURE.md)

## 📁 项目结构

```
cnote/
├── web/                    # 前端应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── stores/        # Zustand 状态
│   │   ├── lib/           # 工具函数
│   │   ├── types/         # TypeScript 类型
│   │   └── i18n/          # 国际化
│   └── public/            # 静态资源
├── proxy/                 # Cloudflare Workers Proxy
├── desktop/               # Electron 桌面端（后续）
└── docs/                  # 文档
```

## 🤝 贡献

欢迎贡献！请查看 [贡献指南](./CONTRIBUTING.md)。

## 📄 许可证

[MIT License](./LICENSE)

## 🔗 相关链接

- [技术架构文档](./CNOTE_TECHNICAL_ARCHITECTURE.md)
- [提取数据参考](./extracted-data/)
- [问题反馈](https://github.com/yourusername/cnote/issues)

---

**从 Creatos 的理念出发，构建开放的未来** 🚀
