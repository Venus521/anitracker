@echo off
start "" python -m http.server 8089 --bind 127.0.0.1 --directory "%~dp0."
timeout /t 1 >nul
start "" http://localhost:8089
