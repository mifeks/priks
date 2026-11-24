@echo off
title Прикс - клиент
cd /d "%~dp0bin"
if not exist priks.exe (
  echo Не найден priks.exe - запусти build.ps1
  pause
  exit /b 1
)
start "" priks.exe