@chcp 65001 >nul
@echo off
title AniTracker 追迹
rem 一键入口：按需起服（15分钟空闲自退）+ 开页面；失败时窗口停留显示原因
netstat -ano | findstr ":8089 " | findstr /I "LISTENING" >nul 2>nul
if %errorlevel% equ 0 goto open
echo [1/2] 正在启动本地服务…
set "PYW=C:\Users\Venus\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
if exist "%PYW%" (
  start "" "%PYW%" "%~dp0服务器-空闲自退.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900 --log "%~dp0服务器日志.txt"
) else (
  start "anitracker-server" /MIN python "%~dp0服务器-空闲自退.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900 --log "%~dp0服务器日志.txt"
)
ping -n 4 127.0.0.1 >nul
netstat -ano | findstr ":8089 " | findstr /I "LISTENING" >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo [错误] 本地服务未能启动（端口8089）。
  echo 可能原因：Python 丢失、D盘未就绪、端口被占。详情见同目录 服务器日志.txt
  echo.
  pause
  exit /b 1
)
:open
echo [2/2] 打开页面…
start "" "http://127.0.0.1:8089/index.html?v=%RANDOM%"
ping -n 2 127.0.0.1 >nul
