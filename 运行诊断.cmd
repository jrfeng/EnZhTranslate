@echo off
setlocal
cd /d "%~dp0src-tauri"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo Debug build keeps the console, so the panic message is visible.
echo.
cargo run
echo.
echo   Exit code: %ERRORLEVEL%
echo   If it panicked, copy the message above.
echo.
pause
