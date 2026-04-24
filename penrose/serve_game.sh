#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-8000}"

cd "$(dirname "$0")"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
