@echo off
setlocal
cd /d "%~dp0.."

echo.
echo   Running debug build (console stays open) ...
echo.

"%~dp0..\src-tauri\target\debug\en-zh-translate.exe"
set "CODE=%ERRORLEVEL%"

echo.
echo   Exit code: %CODE%
if exist "%TEMP%\enzh-translate-panic.log" (
  echo   --- panic log ---
  type "%TEMP%\enzh-translate-panic.log"
  echo   -----------------
)
echo.
echo   If the app window opened, close it and tell me "window ok".
echo   Otherwise send me the text above.
echo.
pause
