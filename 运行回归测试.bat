@echo off
title AniTracker regression tests
cd /d %~dp0
node tests\run-regression.js
set RC1=%ERRORLEVEL%
node tests\douban-sync-e2e.js
set RC2=%ERRORLEVEL%
echo.
echo EXIT CODE: regression=%RC1% douban-sync=%RC2%
if not "%RC1%"=="0" exit /b 1
if not "%RC2%"=="0" exit /b 2
pause
