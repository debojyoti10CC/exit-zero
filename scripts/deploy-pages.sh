#!/usr/bin/env bash
# Builds the web client for GitHub Pages and force-pushes it to the gh-pages branch.
# Served at the custom domain below (Cloudflare CNAME -> debojyoti10cc.github.io, DNS only).
# Usage (Git Bash, from the repo root): bash scripts/deploy-pages.sh
set -euo pipefail
DOMAIN="${DOMAIN:-exitzero.djyo.tech}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
cd "$ROOT/apps/web"
# MSYS_NO_PATHCONV stops Git Bash rewriting / into a Windows path.
MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build
cp -r dist/. "$OUT/"
touch "$OUT/.nojekyll"
echo "$DOMAIN" > "$OUT/CNAME"
cp "$OUT/index.html" "$OUT/404.html"
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c core.autocrlf=false commit -q -m "Deploy EXIT//ZERO web client"
git push -q -f "$(git -C "$ROOT" remote get-url origin)" gh-pages
echo "Published: https://$DOMAIN/"
