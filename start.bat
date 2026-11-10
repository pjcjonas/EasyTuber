@echo off
REM Runs EASY-TUBER from source (needs Node.js). To build a standalone EASY-TUBER.exe: npm run dist
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Installing Electron, first run only...
  call npm install
)
call npx electron .
