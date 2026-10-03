@echo off
cd /d "%~dp0"

if /i "%~1"=="console" goto :run
wscript //nologo "%~dp0MM Player.vbs"
exit /b 0

:run
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 처음 실행입니다. 패키지를 설치합니다. 잠시만 기다려 주세요.
  call npm install
  if errorlevel 1 (
    echo 설치에 실패했습니다.
    pause
    exit /b 1
  )
)

call npm run dev
if errorlevel 1 pause
