@echo off
title AniTracker 追迹
rem ============================================
rem 一键入口：按需起服（15 分钟空闲自退）+ 打开页面
rem 失败时窗口停留显示原因（按任意键关闭）
rem
rem 2026-09-25 修：
rem  1) 项目目录只用 %~dp0（本 bat 所在目录）相对定位，不再写死 D:\... 回退路径；
rem     要放桌面请放快捷方式，不要把 bat 复制出去。
rem  2) Python 探测精简：PATH 优先，仅保留本机内置 Python 一个必要回退。
rem  3) 修掉 nopython 分支里游离的 ")"（导致该分支报错退出）。
rem ============================================
setlocal enableextensions

set "PORT=8089"

rem ---- 定位项目目录：本 bat 所在目录即项目目录 ----
set "HERE=%~dp0"
rem 去掉 HERE 末尾的反斜杠，避免拼出 "..\"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

if not exist "%HERE%\server.py" (
  echo.
  echo [错误] 在本 bat 所在目录找不到 server.py。
  echo   本 bat 所在目录：%~dp0
  echo   请把本 bat 与项目文件放在同一目录。
  echo.
  pause
  exit /b 1
)

rem ---- 若端口已在监听，直接开页面 ----
netstat -ano | findstr ":%PORT% " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

echo [1/3] 正在启动本地服务...

rem ---- 探测可用的 Python：PATH 优先，其次本机内置回退 ----
set "PYW="
set "PYC="

rem 候选 1：PATH 里的 pythonw / python（最稳，环境变了也不会坏）
for %%I in (pythonw.exe) do if not defined PYW if exist "%%~$PATH:I" set "PYW=%%~$PATH:I"
for %%I in (python.exe)  do if not defined PYC if exist "%%~$PATH:I" set "PYC=%%~$PATH:I"

rem 候选 2（必要回退）：本机内置 Python（注意目录名是 .workbuddy-ai）
if not defined PYW if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe" set "PYW=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe"
if not defined PYC if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"  set "PYC=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"

rem ---- 优先用 pythonw（无黑框）；没有就退回 python + 最小化窗口 ----
rem 注意：用 goto 而不是 if defined ... else，避免 pythonw 缺失时
rem       cmd 把 "%PYW%" 解析成命令名导致偶发失败。
if defined PYW goto usepyw
if defined PYC goto usepyc
goto nopython

:usepyw
start "" "%PYW%" "%HERE%\server.py" --port %PORT% --host 0.0.0.0 --dir "%HERE%." --idle 900
goto waitready

:usepyc
start "anitracker-server" /MIN "%PYC%" "%HERE%\server.py" --port %PORT% --host 0.0.0.0 --dir "%HERE%." --idle 900
goto waitready

:nopython
echo.
echo [错误] 没找到任何可用的 Python。
echo 请安装 Python 3，或把 python.exe 放到 PATH 里。
echo 详情见同目录：服务器日志.txt
echo.
pause
exit /b 1

:waitready
set /a n=0
:loop
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":%PORT% " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open
set /a n=%n%+1
if %n% lss 10 goto loop
echo.
echo [错误] 本地服务未能启动（端口 %PORT%）。
echo 常见原因：
echo   1. D 盘未挂载或正在唤醒（确认资源管理器里能看到 D 盘后重试）
echo   2. Python 运行环境缺失（本机已探测：请运行 python --version 检查）
echo   3. 端口 %PORT% 被其他程序占用
echo.
echo 已用的解释器：
echo    pythonw = %PYW%
echo    python  = %PYC%
echo 详情见同目录：服务器日志.txt
echo.
pause
exit /b 1

:open
echo [2/3] 服务已就绪，正在打开页面...
start "" "http://127.0.0.1:%PORT%/index.html?v=%RANDOM%"
echo [3/3] 完成，本窗口即将自动关闭。
ping -n 4 127.0.0.1 >nul
exit /b 0
