#!/usr/bin/env bash
# Create a PUBLIC GitHub repo and push main.
# Prerequisites: GitHub CLI logged in  →  gh auth login
#
# Usage:
#   ./scripts/publish-github.sh                 # repo name: MattChat
#   ./scripts/publish-github.sh my-mattchat     # custom name
#   REPO_PRIVATE=1 ./scripts/publish-github.sh  # private instead

set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-MattChat}"
VIS="${REPO_PRIVATE:+--private}"
VIS="${VIS:---public}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) not found. Install:  brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not logged in. Run:"
  echo "  gh auth login -h github.com -p https -w"
  exit 1
fi

USER=$(gh api user -q .login)
echo "==> GitHub user: $USER"
echo "==> Creating $VIS repo: $USER/$NAME"

if gh repo view "$USER/$NAME" >/dev/null 2>&1; then
  echo "Repo already exists: https://github.com/$USER/$NAME"
else
  gh repo create "$NAME" $VIS --source=. --remote=origin --description "MattChat — LM Studio + multi-provider chat with A/B testing"
fi

# Ensure remote
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/$USER/$NAME.git"
else
  git remote set-url origin "https://github.com/$USER/$NAME.git"
fi

git push -u origin HEAD:main

# Update README clone URL if placeholders remain
if grep -q '<OWNER>' README.md 2>/dev/null; then
  sed -i.bak "s|<OWNER>|$USER|g" README.md SETUP.md 2>/dev/null || \
    sed -i '' "s|<OWNER>|$USER|g" README.md SETUP.md
  rm -f README.md.bak SETUP.md.bak
  git add README.md SETUP.md
  git commit -m "docs: set public GitHub clone URLs for $USER/$NAME" || true
  git push
fi

echo ""
echo "Public repo:"
echo "  https://github.com/$USER/$NAME"
echo ""
echo "Clone:"
echo "  git clone https://github.com/$USER/$NAME.git"
