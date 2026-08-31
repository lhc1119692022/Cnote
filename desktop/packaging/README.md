# Desktop 打包

Windows 是首发目标，默认输出 NSIS 安装包；macOS 默认输出 ZIP 便携包，解压后直接运行 `Cnote.app`，不需要安装器。

日常手动测试不需要打包或安装，推荐使用桌面上的 `Cnote` 快捷方式。它会先执行 `build:all`，然后直接启动当前源码对应的 Electron 窗口。

也可以在命令行运行：

```powershell
npm run dev:shortcut
```

项目根目录的 `icon.svg` 是 Logo 唯一源文件（当前与已保存的原始设计一致）。网页目录中的 `web/public/icon.svg` 和 `web/public/cnote-icon.svg` 只是同步副本。

如果项目 Logo 有更新，运行下面的命令即可同步网页资源并重新生成 Windows 图标资源：

```powershell
npm run sync:project-icon
```

该命令同时生成 `icon.ico`（打包使用）和 `icon-cnote.ico`（开发快捷方式使用）。开发快捷方式使用独立文件名，是为了避免 Windows Explorer 继续复用之前失败的图标缓存。

```powershell
npm install
npm run package:win
```

macOS 便携包（默认，输出 ZIP）：

```powershell
npm run package:mac:portable
```

按 CPU 架构打包：

```powershell
npm run package:mac:x64       # Intel Mac
npm run package:mac:arm64     # Apple Silicon Mac
npm run package:mac:universal # 同一个 App 同时支持两种架构
```

如确实需要传统安装体验，仍可生成 DMG：

```powershell
npm run package:mac:dmg
```

桌面端打包会自动使用 `web` 的 `desktop` 构建模式，资源会以相对路径写入安装包，避免 `file://` 加载时丢失前端资源。

如需验证已经生成的 unpacked 应用，可先用 Electron 的远程调试端口启动它，再运行：

```powershell
$env:CNOTE_DEVTOOLS_PORT = '9223'
npm run test:packaged-renderer
```

该检查会确认 React 工作区已经挂载，并验证一个原生浏览器会话可以嵌入、捕获和关闭。

输出位于 `desktop/release/`。便携 ZIP 解压到任意目录即可运行，应用数据仍保存到 macOS 的用户数据目录，不会写回 ZIP 或 `.app` 包内。

没有 Apple Developer 代码签名和公证时，macOS 首次打开可能显示“无法验证开发者”。用户可以在 Finder 中对 `Cnote.app` 使用“右键 > 打开”确认一次；面向非技术用户正式分发时，建议补齐签名和公证。

`universal` 构建需要同时准备 x64 和 arm64 的 Electron 产物；如果构建环境或 Electron 镜像不支持该架构组合，请分别生成 `x64` 和 `arm64` ZIP。

注意：electron-builder 要求在 macOS 主机上生成 macOS 包，Windows 不能直接交叉打包。仓库提供了手动 GitHub Actions 工作流 `Package Cnote for macOS`，从 Actions 页面运行后会上传 `x64` 和 `arm64` 两个 ZIP artifact，适合直接发给朋友试用。

打包配置不会把用户数据放入安装包。Flow、资源、浏览器会话、任务和 SecretStore 仍位于运行时用户数据目录。
