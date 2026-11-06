@echo off
title My Debt Tracker
cd /d "%~dp0"

rem Find a real Python. "python" may be the Microsoft Store shortcut, so test each one.
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY python3 -c "import sys" >nul 2>nul && set "PY=python3"
if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Python\pythoncore-*" "%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%~D\python.exe" set PY="%%~D\python.exe"
  )
)
if not defined PY (
  echo Python was not found.
  echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

%PY% -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing openpyxl for Excel import/export...
  %PY% -m pip install --quiet openpyxl
)
%PY% tracker.py
pause
