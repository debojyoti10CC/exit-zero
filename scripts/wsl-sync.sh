#!/usr/bin/env bash
# Mirrors the Rust/Anchor sources into the WSL filesystem (fast builds; Windows
# Application Control blocks locally built test executables), keeping build output there.
set -euo pipefail
SRC="/mnt/c/Users/Debojyoti De Majumde/Downloads/exitzero"
DST="$HOME/exitzero"
mkdir -p "$DST"
command -v rsync >/dev/null || apt-get install -y rsync >/dev/null
rsync -a --delete \
  --exclude target --exclude node_modules --exclude apps --exclude .git --exclude .anchor \
  --exclude 'target/deploy/*keypair*' \
  "$SRC/" "$DST/"
find "$DST" -name '*.sh' -exec sed -i 's/\r$//' {} +
