@echo off
setlocal
cd /d "%~dp0"

rem Windows logical CPU indices are zero-based.
rem CPU 26 + CPU 27 = affinity mask 0x0C000000.
set "BZSS_ASTRBOT_TOKEN=12345"
set "NODE_AFFINITY=C000000"

echo [BZSS] Starting Node on logical CPUs 26 and 27...
start "BZSS Panel Node" /b /wait /affinity %NODE_AFFINITY% node app\main.js
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo [BZSS] Node exited with code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%
