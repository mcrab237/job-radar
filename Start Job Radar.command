#!/bin/bash
# Double-click this file to start Job Radar. Keep the window open while it runs.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Job Radar needs Node.js. Get it from https://nodejs.org (the LTS button), then double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
[ -d node_modules ] || npm install --silent
node server.js --open
