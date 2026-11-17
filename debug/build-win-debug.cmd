@echo off
setlocal
cd /d "%~dp0.."
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js not found. Install it first: https://nodejs.org
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo   cargo not found. Make sure Rust is installed, then reopen this window.
  pause
  exit /b 1
)

if not exist "node_modules" (
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo npm install failed. & pause & exit /b 1)
)

echo.
echo   [1/2] Building frontend ...
call npm run build
if errorlevel 1 (echo Frontend build failed. & pause & exit /b 1)

echo   [2/2] Building debug exe ...
cd /d "%~dp0..\src-tauri"
cargo build
if errorlevel 1 (echo Debug build failed. & pause & exit /b 1)

set "DEST=%LOCALAPPDATA%\Programs\FishTranslateTest"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "target\debug\fish-translate.exe" "%DEST%\FishTranslateTest.exe" >nul

echo.
echo   Test build installed: %DEST%\FishTranslateTest.exe
echo.
echo   Notes:
echo     - Close the release app first: both share the same single-instance lock.
echo     - This is a DEBUG build, a console window stays open beside the app.
echo     - There is no installer for test builds.
echo.
pause
