@echo off
REM MattChat — Windows double-click / cmd launcher
REM Prefer PowerShell script for full options:  scripts\start-windows.ps1

setlocal
cd /d "%~dp0\.."

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist .env.local if exist .env.local.example (
  echo Creating .env.local from example...
  copy /Y .env.local.example .env.local >nul
)

echo MattChat runs on THIS PC. Point Base URL at the shared Mac Studio LM Studio.
echo Starting http://localhost:3010
echo Press Ctrl+C to stop.
echo.
call npx next dev --port 3010 --webpack
pause
