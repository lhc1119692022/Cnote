@echo off
title Cnote - 知识工作流应用
cd /d "%~dp0desktop"
echo.
echo ========================================
echo    Cnote 正在启动...
echo ========================================
echo.
echo 项目位置: %cd%
echo 运行方式: Electron 桌面应用
echo.
echo 提示: 关闭此窗口将停止桌面应用
echo.
call npm run dev:shortcut
pause
