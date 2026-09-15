@echo off
title AniTracker regression tests
cd /d %~dp0
node tests\run-regression.js
echo.
echo EXIT CODE: %ERRORLEVEL%
pause
