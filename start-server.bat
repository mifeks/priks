@echo off
title Прикс - сервер
cd /d "%~dp0bin"
if not exist priks-server.exe (
  echo Не найден priks-server.exe - запусти build.ps1
  pause
  exit /b 1
)
echo Запускаю сервер Прикс. Это окно не закрывай, пока пользуешься мессенджером.
echo Остановить: Ctrl+C или просто закрой окно.
echo.
priks-server.exe %*
pause