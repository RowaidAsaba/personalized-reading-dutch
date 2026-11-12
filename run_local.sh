#!/usr/bin/env bash
# Starts the LeesWijs backend (FastAPI) and frontend (Vite) for local development.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/leeswijs"

BACKEND_PID=""
FRONTEND_PID=""

stop_servers() {
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
}
trap stop_servers EXIT INT TERM

echo "Starting LeesWijs locally..."

cd "$BACKEND_DIR"

if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
elif [ -x ".venv/bin/python" ]; then
  PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
else
  python3 -m venv .venv
  PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
fi

"$PYTHON_BIN" -m pip install -q -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created backend/.env. Add GOOGLE_API_KEY (and AUTH_SECRET_KEY) there before generating readings."
fi

"$PYTHON_BIN" seed.py
"$PYTHON_BIN" -m uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  npm install
fi

if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
fi

npm run dev -- --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!

echo ""
echo "Frontend: http://127.0.0.1:5173"
echo "Backend:  http://127.0.0.1:8000  (API docs: http://127.0.0.1:8000/docs)"
echo ""
echo "Open the frontend and create an account to get started."
echo "Press Ctrl+C to stop both servers."

wait
