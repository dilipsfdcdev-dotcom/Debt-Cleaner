#!/bin/bash
# SessionStart hook: install backend (pip) and frontend (npm) dependencies so
# tests, linters, and builds work in Claude Code on the web sessions.
set -euo pipefail

# Only run in the remote (web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] Installing backend Python dependencies..."
cd "$ROOT/backend"
python3 -m pip install --quiet --disable-pip-version-check -r requirements.txt

echo "[session-start] Installing frontend Node dependencies..."
cd "$ROOT/frontend"
npm install --no-audit --no-fund

echo "[session-start] Done."
