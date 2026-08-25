@echo off
setlocal EnableExtensions
cd /d "%~dp0web-client"

echo [BZSS] Build script started.

where node >nul 2>nul
if errorlevel 1 (
  echo [BZSS] ERROR: Node.js was not found in PATH.
  echo [BZSS] Install Node 24 LTS and try again.
  if "%CI%"=="" pause
  exit /b 1
)

if /I "%~1"=="--clean" (
  echo [BZSS] Cleaning previous build output and Vite cache...
  if exist "dist" rmdir /s /q "dist"
  if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite"
)

echo [BZSS] Building Vue client with Vite...
node scripts\run-vite.mjs build --config vite.config.mjs
set "BUILD_EXIT=%ERRORLEVEL%"

if not "%BUILD_EXIT%"=="0" (
  echo [BZSS] Build failed with exit code %BUILD_EXIT%.
  if "%CI%"=="" pause
  exit /b %BUILD_EXIT%
)

echo [BZSS] Build completed: %CD%\dist
exit /b 0