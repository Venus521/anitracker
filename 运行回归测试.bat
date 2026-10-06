@echo off
title AniTracker regression tests
cd /d %~dp0
node tests\cred-crypto-check.js
set RC0=%ERRORLEVEL%
node tests\run-regression.js
set RC1=%ERRORLEVEL%
node tests\douban-sync-e2e.js
set RC2=%ERRORLEVEL%
node tests\douban-push-e2e.js
set RC3=%ERRORLEVEL%
echo.
echo EXIT CODE: cred=%RC0% regression=%RC1% douban-sync=%RC2% douban-push=%RC3%
if not "%RC0%"=="0" exit /b 1
if not "%RC1%"=="0" exit /b 2
if not "%RC2%"=="0" exit /b 3
if not "%RC3%"=="0" exit /b 4
pause