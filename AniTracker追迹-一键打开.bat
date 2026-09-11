@chcp 65001 >nul
@echo off
rem AniTracker 追迹一键入口：按需起服（15分钟空闲自退）+ 开页面；服务已在就直接开页面
netstat -ano | findstr ":8089 " | findstr /I "LISTENING" >nul 2>nul
if %errorlevel% equ 0 goto open
set "PYW=C:\Users\Venus\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"
if exist "%PYW%" (
  start "" "%PYW%" "%~dp0服务器-空闲自退.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900 --log "%~dp0服务器日志.txt"
) else (
  start "anitracker-server" /MIN python "%~dp0服务器-空闲自退.py" --port 8089 --host 0.0.0.0 --dir "%~dp0." --idle 900 --log "%~dp0服务器日志.txt"
)
ping -n 3 127.0.0.1 >nul
:open
start "" "http://127.0.0.1:8089/index.html"
