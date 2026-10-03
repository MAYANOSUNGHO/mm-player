@echo off
cd /d "%~dp0"
set ANDROID_HOME=E:\android-sdk
set ANDROID_SDK_ROOT=E:\android-sdk
call npm run android:apk
if errorlevel 1 (
  echo 빌드에 실패했습니다.
  pause
  exit /b 1
)
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
  copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "MM Player.apk" >nul
  echo MM Player.apk 파일이 만들어졌습니다.
)
pause
