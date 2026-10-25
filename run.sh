#!/usr/bin/env bash
# Start the local API and frontend; Ctrl+C stops both.
set -Eeuo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: ./run.sh"
  echo "Starts Django on 0.0.0.0:8000 and Vite on 0.0.0.0:5173."
  echo "Stops existing listeners on ports 8000 and 5173 before starting."
  echo "Installs missing dependencies and uses Node.js 22 through npx if needed."
  echo "Configure SMS.ir in .env before requesting a sign-in code."
  exit 0
fi
if (( $# )); then
  echo "Unknown argument: $1. Use --help for usage." >&2
  exit 1
fi

if ! command -v python3 >/dev/null || ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  echo "Python 3.12 or newer is required." >&2
  exit 1
fi
if ! command -v npm >/dev/null || ! command -v npx >/dev/null; then
  echo "Install Node.js with npm, then run this script again." >&2
  exit 1
fi

# Release occupied ports before installing dependencies or applying migrations.
python3 - <<'PY'
import os
import shutil
import signal
import socket
import subprocess
import sys
import time


def available(port):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('0.0.0.0', port))
        except OSError:
            return False
    return True


def listeners(port):
    result = subprocess.run(
        ['lsof', '-nP', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'],
        capture_output=True, text=True,
    )
    return {int(pid) for pid in result.stdout.split()}


def stop(pids, sig, port):
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            sys.exit(f'Cannot stop process {pid} on port {port}: it belongs to another user.')


def wait_for_port(port, seconds):
    deadline = time.monotonic() + seconds
    while not available(port):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)
    return True


for port in (8000, 5173):
    if available(port):
        continue
    if not shutil.which('lsof'):
        sys.exit('Install lsof to automatically stop processes on occupied ports.')
    pids = listeners(port)
    if not pids:
        sys.exit(f'Port {port} is unavailable, but its listener could not be identified.')
    print(f'Port {port} is in use. Stopping existing listener(s): {", ".join(map(str, sorted(pids)))}.', flush=True)
    stop(pids, signal.SIGTERM, port)
    if not wait_for_port(port, 5):
        print(f'Port {port} is still busy. Force-stopping the previous listener(s).', flush=True)
        stop(listeners(port) & pids, signal.SIGKILL, port)
        if not wait_for_port(port, 2):
            sys.exit(f'Could not release port {port}.')
PY

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major < 22 || (major === 22 && minor < 12));' 2>/dev/null; then
  echo "Using Node.js 22 through npx..."
  node_path="$(npx --yes --package=node@22 -c 'command -v node')"
  export PATH="$(dirname -- "$node_path"):$PATH"
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env. Add your SMS.ir API key, template ID, and code parameter name."
fi

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
requirements_hash="$(.venv/bin/python -c 'import hashlib; print(hashlib.sha256(open("backend/requirements.txt", "rb").read()).hexdigest())')"
if [[ ! -f .venv/.requirements.sha256 ]] || [[ "$(cat .venv/.requirements.sha256)" != "$requirements_hash" ]]; then
  .venv/bin/python -m pip install -r backend/requirements.txt
  printf '%s\n' "$requirements_hash" > .venv/.requirements.sha256
fi

frontend_hash="$(.venv/bin/python -c 'import hashlib; print(hashlib.sha256(open("frontend/package-lock.json", "rb").read() + open("frontend/package.json", "rb").read()).hexdigest())')"
if [[ ! -f frontend/node_modules/.runner-dependencies.sha256 ]] || [[ "$(cat frontend/node_modules/.runner-dependencies.sha256)" != "$frontend_hash" ]]; then
  (cd frontend && npm ci --no-audit --no-fund)
  printf '%s\n' "$frontend_hash" > frontend/node_modules/.runner-dependencies.sha256
fi

.venv/bin/python backend/manage.py migrate --noinput

backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  for server_pid in "$backend_pid" "$frontend_pid"; do
    if [[ -n "$server_pid" ]]; then
      kill "$server_pid" 2>/dev/null || true
    fi
  done
  wait || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Disable Django's reloader so the runner owns and stops both server processes.
.venv/bin/python backend/manage.py runserver 0.0.0.0:8000 --noreload &
backend_pid=$!
(
  cd frontend
  exec node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort
) &
frontend_pid=$!

echo "Website: http://localhost:5173 (network: http://<your-machine-ip>:5173)"
echo "Press Ctrl+C to stop both servers. Restart after changing .env or backend code."
wait -n "$backend_pid" "$frontend_pid"
