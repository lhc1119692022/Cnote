# Contributing to Cnote

感谢您对 Cnote 项目的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

如果您发现了 bug，请创建一个 issue 并包含：

- 详细的问题描述
- 复现步骤
- 期望的行为
- 实际的行为
- 截图（如果适用）
- 环境信息（操作系统、Node.js 版本等）

### 功能建议

我们欢迎新功能的建议！请创建一个 issue 并包含：

- 功能的详细描述
- 使用场景
- 可能的实现方案（如果有）

### 提交代码

1. **Fork 项目**
   ```bash
   git clone https://github.com/yourusername/cnote.git
   cd cnote
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **安装依赖**
   ```bash
   npm install --legacy-peer-deps
   ```

4. **进行修改**
   - 遵循项目的代码风格
   - 保持代码简洁和可维护
   - 添加必要的注释

5. **测试修改**
   ```bash
   npm run build
   npm run dev
   ```

6. **提交代码**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   提交信息格式：
   - `feat:` 新功能
   - `fix:` 修复 bug
   - `docs:` 文档更新
   - `style:` 代码格式调整
   - `refactor:` 代码重构
   - `test:` 测试相关
   - `chore:` 构建/工具相关

7. **推送到 GitHub**
   ```bash
   git push origin feature/your-feature-name
   ```

8. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 详细描述您的修改
   - 关联相关的 issue

## 代码规范

### TypeScript

- 使用 TypeScript 进行类型检查
- 避免使用 `any` 类型
- 为复杂类型定义接口

### React

- 使用函数组件和 Hooks
- 保持组件单一职责
- 适当拆分大型组件

### 样式

- 使用 Tailwind CSS 类名
- 保持一致的设计系统
- 遵循 Apple 风格的 UI 设计原则

### 命名规范

- 组件：PascalCase（如 `SourcesManager`）
- 函数：camelCase（如 `handleAddSource`）
- 常量：UPPER_CASE（如 `API_BASE_URL`）
- 文件：kebab-case 或 PascalCase

## 项目结构

```
src/
├── app/                  # Next.js 页面
├── components/          # React 组件
│   ├── ui/             # 基础 UI 组件
│   ├── flow/           # 工作流相关
│   ├── sources/        # 内容源相关
│   ├── outputs/        # 输出相关
│   ├── templates/      # 模板相关
│   └── settings/       # 设置相关
├── lib/                # 工具函数和库
│   ├── db/            # 数据库层
│   └── i18n/          # 国际化
└── styles/            # 全局样式
```

## 开发工作流

1. 确保所有修改都能成功构建
2. 在 PR 中详细说明修改内容
3. 响应 code review 的反馈
4. 合并前确保没有冲突

## 需要帮助？

如果您有任何问题，欢迎：

- 创建 issue 询问
- 在 PR 中提问
- 查看现有的文档和代码

## 行为准则

- 尊重所有贡献者
- 保持友好和专业的交流
- 接受建设性的批评
- 关注项目的最佳利益

感谢您的贡献！🎉
