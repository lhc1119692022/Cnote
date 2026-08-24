# Desktop 打包

Windows 是首发目标，默认输出 NSIS 安装包；macOS 目标先保留为 DMG 配置，后续补签名、公证和 universal 架构矩阵。

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

桌面端打包会自动使用 `web` 的 `desktop` 构建模式，资源会以相对路径写入安装包，避免 `file://` 加载时丢失前端资源。

如需验证已经生成的 unpacked 应用，可先用 Electron 的远程调试端口启动它，再运行：

```powershell
$env:CNOTE_DEVTOOLS_PORT = '9223'
npm run test:packaged-renderer
```

该检查会确认 React 工作区已经挂载，并验证一个原生浏览器会话可以嵌入、捕获和关闭。

输出位于 `desktop/release/`。没有代码签名证书时，安装包仍可用于内部体验，但 Windows 可能显示 SmartScreen 警告；这不是代码构建失败。

打包配置不会把用户数据放入安装包。Flow、资源、浏览器会话、任务和 SecretStore 仍位于运行时用户数据目录。
