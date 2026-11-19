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

echo Building installer ^(NSIS^) ...
call npx tauri build
if errorlevel 1 (
  echo.
  echo   Build failed. Send the error above.
  echo.
  pause
  exit /b 1
)

rem Collect the newest installer into .\build\ (created on demand, ignored by git).
rem The bundle folder keeps older versions around, so only copy the latest one.
if not exist "build" mkdir "build"
powershell -NoProfile -Command "$src = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $src) { exit 1 }; Get-ChildItem 'build\*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force; Copy-Item $src.FullName 'build\' -Force"
if errorlevel 1 (
  echo.
  echo   Installer not found under src-tauri\target\release\bundle\nsis\
  echo.
  pause
  exit /b 1
)

echo.
echo   Installer copied to .\build\
echo.
dir /b "build\*.exe"
echo.
echo   Double-click the .exe above to install.
echo   This script does NOT install anything by itself.
echo.
pause
