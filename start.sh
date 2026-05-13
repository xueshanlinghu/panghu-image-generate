#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo
echo "[Panghu] Checking default ports..."

for port in 5173 8787; do
  pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u)"
  fi

  if [ -n "$pids" ]; then
    echo "[Panghu] Port $port is in use. Stopping: $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "[Panghu] Starting dev services..."
echo "[Panghu] Frontend: http://localhost:5173"
echo "[Panghu] Backend:  http://localhost:8787"
echo

npm run dev

echo
echo "[Panghu] Dev services stopped."
