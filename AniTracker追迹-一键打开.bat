@echo off
title AniTracker 追迹
rem ============================================
rem 一键入口：按需起服（15 分钟空闲自退）+ 打开页面
rem 失败时窗口停留显示原因（按任意键关闭）
rem ============================================
netstat -ano | findstr ":8089 " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open
echo [1/3] 正在启动本地服务...
set "PYW=C:\Users\Venus\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
if not exist "%PYW%" goto trytool
start "" "%PYW%" "%~dp0server.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900
goto waitready
:trytool
echo [提示] 未找到内置 Python，改用系统 Python...
start "anitracker-server" /MIN python "%~dp0server.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900
:waitready
set /a n=0
:loop
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":8089 " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open
set /a n=%n%+1
if %n% lss 10 goto loop
echo.
echo [错误] 本地服务未能启动（端口 8089）。
echo 常见原因：
echo   1. D 盘未挂载或正在唤醒（确认资源管理器里能看到 D 盘后重试）
echo   2. Python 运行环境缺失
echo   3. 端口 8089 被其他程序占用
echo 详情见同目录：服务器日志.txt
echo.
pause
exit /b 1
:open
echo [2/3] 服务已就绪，正在打开页面...
start "" "http://127.0.0.1:8089/index.html?v=%RANDOM%"
echo [3/3] 完成，本窗口即将自动关闭。
ping -n 4 127.0.0.1 >nul
exit /b 0
