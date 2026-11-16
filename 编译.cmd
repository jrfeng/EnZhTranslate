@echo off
setlocal
cd /d "%~dp0src-tauri"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo   cargo not found. Make sure Rust is installed, then reopen this window.
  echo.
  pause
  exit /b 1
)

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
