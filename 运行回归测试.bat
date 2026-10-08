@echo off
title AniTracker regression tests
cd /d %~dp0
rem 门禁必须串行：两个 Chrome 门禁并发会撞端口。
rem v2.35.0 起加 phone-canon-check（漫改恢复+漫改进度行）与 name-refresh-e2e（不经过 AI 刷名）。
node tests\cred-crypto-check.js
set RC0=%ERRORLEVEL%
node tests\run-regression.js
set RC1=%ERRORLEVEL%
node tests\douban-sync-e2e.js
set RC2=%ERRORLEVEL%
node tests\douban-push-e2e.js
set RC3=%ERRORLEVEL%
node tests\desktop-tier-check.js
set RC4=%ERRORLEVEL%
node tests\phone-canon-check.js
set RC5=%ERRORLEVEL%
node tests\name-refresh-e2e.js
set RC6=%ERRORLEVEL%
node tests\phone-use.js
set RC7=%ERRORLEVEL%
node tests\phone-look.js
set RC8=%ERRORLEVEL%
node tests\ep-duration-check.js
set RC9=%ERRORLEVEL%
echo.
echo EXIT CODE: cred=%RC0% regression=%RC1% douban-sync=%RC2% douban-push=%RC3% desk-tier=%RC4% phone-canon=%RC5% name-refresh=%RC6% phone-use=%RC7% phone-look=%RC8% ep-duration=%RC9%
if not "%RC0%"=="0" exit /b 1
if not "%RC1%"=="0" exit /b 2
if not "%RC2%"=="0" exit /b 3
if not "%RC3%"=="0" exit /b 4
if not "%RC4%"=="0" exit /b 5
if not "%RC5%"=="0" exit /b 6
if not "%RC6%"=="0" exit /b 7
if not "%RC7%"=="0" exit /b 8
if not "%RC8%"=="0" exit /b 9
if not "%RC9%"=="0" exit /b 10
pause