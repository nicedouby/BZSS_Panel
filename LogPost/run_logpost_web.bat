@echo off
cd /d "%~dp0"
python logpost_web_server.py ../config/logpost.json
pause
