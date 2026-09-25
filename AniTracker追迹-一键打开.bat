@echo off
title AniTracker 追迹
rem ============================================
rem 一键入口：按需起服（15 分钟空闲自退）+ 打开页面
rem 失败时窗口停留显示原因（按任意键关闭）
rem
rem 2026-09-25 修：原来写死 PYW=C:\Users\Venus\.workbuddy\...（少了 -ai），
rem 路径不存在 → 降级到裸 python → 黑框里找不到 → 直接失败。
rem 现在改为「四个候选依次探测」，谁在就用谁，不再依赖某个写死的绝对路径。
rem ============================================
setlocal enableextensions

set "PORT=8089"

rem ---- 定位项目目录（让这个 bat 放到桌面/任何地方都能用）----
rem 顺序：① 同目录有 server.py → 就用同目录
rem       ② 否则用写死的项目路径（bat 被复制到桌面时走这条）
set "HERE=%~dp0"
if not exist "%HERE%server.py" (
  if exist "D:\项目\01_媒体娱乐\ani-tracker\server.py" (
    set "HERE=D:\项目\01_媒体娱乐\ani-tracker\"
  )
)
rem 去掉 HERE 末尾的反斜杠，避免拼出 "..\"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

if not exist "%HERE%\server.py" (
  echo.
  echo [错误] 找不到 server.py。
  echo   本 bat 所在目录：%~dp0
  echo   期望的项目目录：D:\项目\01_媒体娱乐\ani-tracker
  echo   D 盘可能未挂载，或项目被移动了。
  echo.
  pause
  exit /b 1
)

rem ---- 若端口已在监听，直接开页面 ----
netstat -ano | findstr ":%PORT% " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

echo [1/3] 正在启动本地服务...

rem ---- 依次探测可用的 Python（用「解释器自身」而不是写死路径）----
set "PYC="
set "PYW="

rem 候选 1：PATH 里的 pythonw（最稳，环境变了也不会坏）
for %%I in (pythonw.exe) do if not defined PYW if exist "%%~$PATH:I" set "PYW=%%~$PATH:I"
for %%I in (python.exe)  do if not defined PYC if exist "%%~$PATH:I" set "PYC=%%~$PATH:I"

rem 候选 2：本机内置 Python（真实路径，注意是 .workbuddy-ai）
if not defined PYW if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe" set "PYW=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe"
if not defined PYC if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"  set "PYC=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"

rem 候选 3：系统 Python
if not defined PYC if exist "C:\Python313\python.exe" set "PYC=C:\Python313\python.exe"

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
)

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
