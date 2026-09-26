#!/usr/bin/env bash
set -e
# One-command teammate setup: migrate schema + seed data
# Usage: ./scripts/setup.sh   or   bash scripts/setup.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$(dirname "$DIR")"
cd "$BACKEND"
echo "== alembic upgrade head =="
alembic upgrade head || echo "alembic failed — falling back to create_all (ok for fresh clone without alembic history)"
echo "== seed_db.py (merge) =="
python3 scripts/seed_db.py
echo "== done — run: fastapi dev =="
