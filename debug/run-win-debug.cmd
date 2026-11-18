@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo.
echo   === FishTranslate debug runner ===
echo.

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
  echo   Installing frontend dependencies ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo   npm install failed. & pause & exit /b 1)
)

echo   [1/3] Building frontend ...
call npm run build
if errorlevel 1 (echo   Frontend build failed. & pause & exit /b 1)

echo   [2/3] Building debug exe ...
pushd "src-tauri"
cargo build
if errorlevel 1 (
  popd
  echo   Debug build failed.
  pause
  exit /b 1
)
popd

rem ---- running instances share the single-instance lock, ask before killing ----
set "RUNNING="
tasklist /fi "imagename eq fish-translate.exe" 2>nul | find /i "fish-translate.exe" >nul && set "RUNNING=1"
tasklist /fi "imagename eq FishTranslateTest.exe" 2>nul | find /i "FishTranslateTest.exe" >nul && set "RUNNING=1"

if defined RUNNING (
  echo.
  echo   A FishTranslate instance is already running:
  echo     - fish-translate.exe   (release build)
  echo     - FishTranslateTest.exe (previous test build)
  echo   Both share the same single-instance lock, so one of them must be closed.
  echo.
  set "ANSWER="
  set /p "ANSWER=  Close the running instance(s)? [y/N] "
  rem trim: piped input may carry a trailing space
  if /i not "!ANSWER:~0,1!"=="y" (
    echo.
    echo   Cancelled. Nothing was started.
    pause
    exit /b 1
  )
  taskkill /f /im fish-translate.exe >nul 2>nul
  taskkill /f /im FishTranslateTest.exe >nul 2>nul
  timeout /t 1 /nobreak >nul
)

set "DEST=%LOCALAPPDATA%\Programs\FishTranslateTest"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "src-tauri\target\debug\fish-translate.exe" "%DEST%\FishTranslateTest.exe" >nul
if errorlevel 1 (
  echo   Copy failed: %DEST%
  pause
  exit /b 1
)

echo   [3/3] Starting debug build ...
echo.
echo   ------------------------------------------------------------
echo    Debug build console: logs and panics appear in this window.
echo    Close the app window (or press Ctrl+C here) to stop it.
echo   ------------------------------------------------------------
echo.

del /q "%TEMP%\fish-translate-panic.log" >nul 2>nul
"%DEST%\FishTranslateTest.exe"
set "CODE=%ERRORLEVEL%"

echo.
echo   App exited with code %CODE%
if exist "%TEMP%\fish-translate-panic.log" (
  echo   --- panic log ---
  type "%TEMP%\fish-translate-panic.log"
  echo   -----------------
)
echo.
pause
