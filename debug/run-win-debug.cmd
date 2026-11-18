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

echo   [1/2] Building frontend ...
call npm run build
if errorlevel 1 (echo   Frontend build failed. & pause & exit /b 1)

echo   [2/2] Building debug exe ...
pushd "src-tauri"
cargo build
if errorlevel 1 (
  popd
  echo   Debug build failed.
  pause
  exit /b 1
)
popd

set "EXE=src-tauri\target\debug\fish-translate.exe"
if not exist "%EXE%" (
  echo   Executable not found: %EXE%
  pause
  exit /b 1
)

rem ---- running instances share the single-instance lock, ask before killing ----
set "RUNNING="
tasklist /fi "imagename eq fish-translate.exe" 2>nul | find /i "fish-translate.exe" >nul && set "RUNNING=1"
tasklist /fi "imagename eq FishTranslateTest.exe" 2>nul | find /i "FishTranslateTest.exe" >nul && set "RUNNING=1"

if defined RUNNING (
  echo.
  echo   A FishTranslate instance is already running:
  echo     - fish-translate.exe   ^(release or debug build^)
  echo     - FishTranslateTest.exe ^(older test build^)
  echo   Both share the same single-instance lock, so one of them must be closed.
  echo.
  set "ANSWER="
  set /p "ANSWER=  Close the running instance(s)? [y/N] "
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

echo.
echo   ------------------------------------------------------------
echo    Running %EXE%
echo    Debug build console: logs and panics appear in this window.
echo    Close the app window (or press Ctrl+C here) to stop it.
echo   ------------------------------------------------------------
echo.

del /q "%TEMP%\fish-translate-panic.log" >nul 2>nul
"%EXE%"
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
