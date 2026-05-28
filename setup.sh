#!/usr/bin/env bash
set -euo pipefail

# vault-os — First-time setup
# Usage: ./setup.sh

echo "=== vault-os Setup ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || {
  echo "Error: Node.js is required (18+). Download from https://nodejs.org"
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "Error: npm is required. It is bundled with Node.js."
  exit 1
}

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18 or higher is required (found $(node --version))."
  exit 1
fi

echo "Node.js $(node --version) — OK"

# Environment
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  else
    echo "Warning: .env.example not found — .env was not created."
  fi
else
  echo ".env already exists — skipping"
fi

# CLAUDE.md
if [ ! -f CLAUDE.md ]; then
  if [ -f CLAUDE.md.template ]; then
    cp CLAUDE.md.template CLAUDE.md
    echo "Created CLAUDE.md from CLAUDE.md.template"
  fi
else
  echo "CLAUDE.md already exists — skipping"
fi

# Install dashboard dependencies
echo ""
echo "Installing dashboard dependencies..."
cd dashboard
npm install
cd ..

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env — set VAULT_PATH, TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY"
echo "  2. Edit CLAUDE.md — fill in YOUR_NAME and your vault context"
echo "  3. Start the dashboard: cd dashboard && node server.js"
echo "  4. Open: http://localhost:3777"
echo ""
echo "  Optional — register the nightly agent (Windows, PowerShell 7+, run as Administrator):"
echo "    pwsh -File scripts/install-scheduler.ps1"
echo ""
echo "  Using Claude Code? CLAUDE.md has full project context."
echo "    claude"
