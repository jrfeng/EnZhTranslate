@echo off
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install it first: https://nodejs.org
  echo.
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo   cargo not found. Make sure Rust is installed, then reopen this window.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing frontend dependencies ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo npm install failed. & pause & exit /b 1)
)

echo Building frontend ^(esbuild^) ...
call npm run build
if errorlevel 1 (echo Frontend build failed. & pause & exit /b 1)

cd /d "%~dp0src-tauri"
echo Building release exe ...
cargo build --release
if errorlevel 1 (
  echo.
  echo   Build failed. Send the error above.
  echo.
  pause
  exit /b 1
)

set "DEST=%LOCALAPPDATA%\Programs\EnZhTranslate"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "target\release\en-zh-translate.exe" "%DEST%\EnZhTranslate.exe" >nul

echo.
echo   Installed: %DEST%\EnZhTranslate.exe
echo.
echo   IMPORTANT: run it from there, NOT from this workspace folder.
echo   DSH sandbox ACLs on the workspace make WebView2 crash at startup.
echo.
pause
