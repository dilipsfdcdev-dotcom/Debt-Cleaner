#!/usr/bin/env bash
# Launcher for My Debt Tracker (Mac / Linux)
cd "$(dirname "$0")" || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3 is not installed. Get it from https://www.python.org/downloads/"
  exit 1
fi
if ! "$PY" -c "import openpyxl" >/dev/null 2>&1; then
  echo "Installing openpyxl for Excel import/export..."
  "$PY" -m pip install --quiet --user openpyxl || "$PY" -m pip install --quiet openpyxl
fi
exec "$PY" tracker.py "$@"
