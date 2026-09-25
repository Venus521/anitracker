@echo off
title AniTracker Launcher
rem ============================================================
rem AniTracker one-click entry: start local server (idle-exit 15m)
rem + open page. Kept 100% ASCII on purpose: cmd batch parsing of
rem CJK bytes is codepage-fragile (this box mixes 65001/936).
rem Locate project by this bat's own folder (%~dp0). No absolute
rem paths. For the Desktop use a .lnk, never copy the .bat out.
rem ============================================================
setlocal enableextensions

set "PORT=8089"
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

if not exist "%HERE%\server.py" (
  echo.
  echo  [ERROR] server.py not found next to this launcher:
  echo     %~dp0
  echo.
  pause
  exit /b 1
)

rem ---- if port already listening, just open the page ----
netstat -ano | findstr ":%PORT% " | findstr /I "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

echo [1/3] Starting local server...
set "PYW="
set "PYC="
for %%I in (pythonw.exe) do if not defined PYW if exist "%%~$PATH:I" set "PYW=%%~$PATH:I"
for %%I in (python.exe)  do if not defined PYC if exist "%%~$PATH:I" set "PYC=%%~$PATH:I"
if not defined PYW if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe" set "PYW=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\pythonw.exe"
if not defined PYC if exist "C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"  set "PYC=C:\Users\Venus\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"

if defined PYW goto usepyw
if defined PYC goto usepyc
goto nopython

:usepyw
start "" "%PYW%" "%HERE%\server.py" --port %PORT% --host 0.0.0.0 --dir "%HERE%" --idle 900
goto waitready

:usepyc
start "anitracker-server" /MIN "%PYC%" "%HERE%\server.py" --port %PORT% --host 0.0.0.0 --dir "%HERE%" --idle 900
goto waitready

:nopython
echo.
echo  [ERROR] No usable Python found (PATH and built-in both missing).
echo  Install Python 3 or put python.exe into PATH.
echo  See the server log file in this folder.
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
echo  [ERROR] Server did not come up on port %PORT%.
echo    1. Drive D not ready (external USB) - check Explorer, retry
echo    2. Python missing - test with: python --version
echo    3. Port %PORT% occupied by another program
echo    used pythonw = %PYW%
echo    used python  = %PYC%
echo    See the server log file in this folder.
echo.
pause
exit /b 1

:open
echo [2/3] Server ready, opening page...
start "" "http://127.0.0.1:%PORT%/index.html?v=%RANDOM%"
echo [3/3] Done. Server auto-exits after 15 min idle.
ping -n 4 127.0.0.1 >nul
exit /b 0
