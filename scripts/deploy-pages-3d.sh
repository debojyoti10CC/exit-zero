#!/usr/bin/env bash
# Deploys the 3D (reaper-3d) client as its own site, separate from the main 2D one.
# The built files go to the gh-pages branch of a dedicated repo, so this never
# touches the main site's gh-pages (exitzero.djyo.tech).
#
#   https://debojyoti10cc.github.io/exit-zero-3d/
#
# Usage (Git Bash, from the repo root, on the theme/reaper-3d branch):
#   bash scripts/deploy-pages-3d.sh
# Optional custom domain: DOMAIN=3d.exitzero.djyo.tech bash scripts/deploy-pages-3d.sh
#   (add a CNAME record 3d.exitzero -> debojyoti10cc.github.io first).
set -euo pipefail
REPO="${REPO:-debojyoti10CC/exit-zero-3d}"
DOMAIN="${DOMAIN:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"

# A custom domain serves from /, the github.io URL from /<repo>/.
if [ -n "$DOMAIN" ]; then BASE="/"; else BASE="/${REPO#*/}/"; fi

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --description "EXIT//ZERO 3D client (HD-2D renderer) — live build of the theme/reaper-3d branch of debojyoti10CC/exit-zero"
fi

cd "$ROOT/apps/web"
# MSYS_NO_PATHCONV stops Git Bash rewriting the base path into a Windows path.
MSYS_NO_PATHCONV=1 VITE_BASE="$BASE" npx vite build
cp -r dist/. "$OUT/"
touch "$OUT/.nojekyll"
[ -n "$DOMAIN" ] && echo "$DOMAIN" > "$OUT/CNAME"
cp "$OUT/index.html" "$OUT/404.html"
cat > "$OUT/README.md" <<EOF
# EXIT//ZERO — 3D client

Built output of the \`theme/reaper-3d\` branch of [debojyoti10CC/exit-zero](https://github.com/debojyoti10CC/exit-zero/tree/theme/reaper-3d).
Source, program and docs live there. This repo only hosts the static site.
EOF
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c core.autocrlf=false commit -q -m "Deploy EXIT//ZERO 3D client ($(git -C "$ROOT" rev-parse --short HEAD))"
git push -q -f "https://github.com/$REPO.git" gh-pages

# Serve the gh-pages branch (no-op if already configured).
gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true
if [ -n "$DOMAIN" ]; then echo "Published: https://$DOMAIN/"; else echo "Published: https://${REPO%%/*}.github.io/${REPO#*/}/" | tr '[:upper:]' '[:lower:]'; fi
