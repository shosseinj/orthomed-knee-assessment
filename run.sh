#!/usr/bin/env bash
# Start the local API and frontend in the background.
set -Eeuo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: ./run.sh [--stop | --help]"
  echo "Starts Django on 0.0.0.0:8000 and Vite on 0.0.0.0:5173 in the background."
  echo "Stops existing listeners on ports 8000 and 5173 before starting."
  echo "Installs missing dependencies and uses Node.js 22 through npx if needed."
  echo "Logs: .run/backend.log and .run/frontend.log."
  echo "Use --stop to stop listeners on both project ports without restarting."
  echo "Configure SMS.ir in .env before requesting a sign-in code."
  exit 0
fi
if (( $# > 1 )) || [[ -n "${1:-}" && "${1:-}" != "--stop" ]]; then
  echo "Unknown argument: $1. Use --help for usage." >&2
  exit 1
fi

if ! command -v python3 >/dev/null || ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  echo "Python 3.12 or newer is required." >&2
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

if [[ "${1:-}" == "--stop" ]]; then
  echo "Stopped project listeners on ports 8000 and 5173."
  exit 0
fi

if ! command -v npm >/dev/null || ! command -v npx >/dev/null; then
  echo "Install Node.js with npm, then run this script again." >&2
  exit 1
fi

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

log_dir="$project_dir/.run"
mkdir -p "$log_dir"

# Separate sessions and redirected streams let both servers outlive this script
# and its terminal. Keep ownership until startup succeeds so failures clean up.
python3 - "$log_dir" <<'PY'
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time

project = Path.cwd()
log_dir = Path(sys.argv[1])
specs = (
    ('Backend', [str(project / '.venv/bin/python'), '-u', 'backend/manage.py',
                 'runserver', '0.0.0.0:8000', '--noreload'], project, 8000),
    ('Frontend', [shutil.which('node'), 'node_modules/vite/bin/vite.js',
                  '--host', '0.0.0.0', '--port', '5173', '--strictPort'], project / 'frontend', 5173),
)
servers = []


def interrupted(signum, frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, interrupted)
try:
    for name, command, directory, port in specs:
        with (log_dir / f'{name.lower()}.log').open('w') as log:
            process = subprocess.Popen(command, cwd=directory, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        servers.append((name, process, port))

    deadline = time.monotonic() + 30
    pending = list(servers)
    while pending:
        for name, process, _ in servers:
            if process.poll() is not None:
                raise RuntimeError(f'{name} exited during startup.')
        for server in pending[:]:
            try:
                with socket.create_connection(('127.0.0.1', server[2]), timeout=0.2):
                    pending.remove(server)
            except OSError:
                pass
        if pending and time.monotonic() >= deadline:
            names = ', '.join(server[0] for server in pending)
            raise RuntimeError(f'{names} did not start within 30 seconds.')
        if pending:
            time.sleep(0.2)
except (Exception, KeyboardInterrupt) as error:
    for _, process, _ in servers:
        if process.poll() is None:
            process.terminate()
    for _, process, _ in servers:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    reason = str(error) or 'Startup interrupted.'
    sys.exit(f'{reason} Check logs in {log_dir}.')

print('Project is running in the background (' + ', '.join(
    f'{name.lower()} PID: {process.pid}' for name, process, _ in servers
) + ').')
PY

echo "Website: http://localhost:5173 (network: http://<your-machine-ip>:5173)"
echo "Backend: http://localhost:8000"
echo "Logs: $log_dir/backend.log and $log_dir/frontend.log"
echo "Stop: $project_dir/run.sh --stop"
echo "Run ./run.sh again to restart after changing .env or backend code."
