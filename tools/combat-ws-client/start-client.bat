@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [BZSS Combat Receiver] Node.js 22 or newer was not found in PATH.
  echo Install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)
node server.mjs
if errorlevel 1 pause
