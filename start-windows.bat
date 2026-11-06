@echo off
title My Debt Tracker
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during install.
  pause
  exit /b 1
)
python -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing openpyxl for Excel import/export...
  python -m pip install --quiet openpyxl
)
python tracker.py
pause
