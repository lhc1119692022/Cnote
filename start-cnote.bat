@echo off
title Cnote - 知识工作流应用
cd /d "%~dp0web"
echo.
echo ========================================
echo    Cnote 正在启动...
echo ========================================
echo.
echo 项目位置: %cd%
echo 默认地址: http://localhost:5173
echo.
echo 提示: 浏览器将自动打开，关闭此窗口将停止服务器
echo.
call npm run dev
pause
