@echo off
setlocal
title FishTranslate Linux test build

echo.
echo   Starting Linux test build via WSL ...
echo   The app window is a WSLg window. Close it to quit.
echo.

wsl.exe -- bash -lc "cd ~/dsh-linux-test && exec ./src-tauri/target/debug/fish-translate"

echo.
echo   App exited.
pause
