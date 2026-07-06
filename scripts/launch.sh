#!/bin/bash
set -e

# Finder/LaunchServices launches apps with a minimal PATH that excludes
# Homebrew- and nvm-installed node, so add the usual locations explicitly.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=5175
LOG_FILE="/tmp/opentakeoff-server.log"

cd "$REPO_DIR/web"

if [ ! -d dist ]; then
  npm install
  npm run build
fi

if ! lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  nohup node "$REPO_DIR/scripts/serve-with-heartbeat.mjs" > "$LOG_FILE" 2>&1 &
  disown
  sleep 1
fi

# Open in Chrome specifically: its File System Access API lets "Save project"
# overwrite one file and show a verified backup. Fall back to the default browser
# if Chrome isn't installed.
URL="http://localhost:$PORT"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
else
  open "$URL"
fi
