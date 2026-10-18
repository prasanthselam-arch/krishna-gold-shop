#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing packages (first time only)…"
  npm install
fi
echo "Starting Krishna Gold Shop…"
echo "Open http://localhost:5173"
echo "Login: owner / KrishnaGold@123"
npm run dev
