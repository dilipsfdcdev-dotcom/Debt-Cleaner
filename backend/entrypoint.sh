#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Seeding database (idempotent)..."
python -m app.seed

echo "Starting API on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
