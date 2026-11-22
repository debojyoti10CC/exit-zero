#!/usr/bin/env bash
# Builds the Anchor program and the WASM core inside WSL, then copies artifacts back to Windows.
# Usage: bash scripts/wsl-build.sh [program|wasm|all]
set -uo pipefail
WHAT="${1:-all}"
WIN="/mnt/c/Users/Debojyoti De Majumde/Downloads/exitzero"
cd "$HOME/exitzero"

if [ "$WHAT" = "program" ] || [ "$WHAT" = "all" ]; then
  mkdir -p target/deploy
  cp /root/keys/exit_zero-keypair.json target/deploy/
  anchor build --no-idl 2>&1 | grep -E "^(error|warning)|error\[|^ +--> |Finished|Error|panicked" | head -80
  # IDL build is separate so a nightly/IDL hiccup does not hide program errors.
  anchor idl build -o target/idl/exit_zero.json 2>&1 | grep -E "^(error)|error\[|Error" | head -20
  mkdir -p "$WIN/target/idl" "$WIN/apps/web/src/chain"
  [ -f target/idl/exit_zero.json ] && cp target/idl/exit_zero.json "$WIN/apps/web/src/chain/exit_zero.json"
  ls -la target/deploy/ 2>/dev/null
fi

if [ "$WHAT" = "wasm" ] || [ "$WHAT" = "all" ]; then
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1
  command -v wasm-bindgen >/dev/null || cargo install wasm-bindgen-cli --version 0.2.100 --locked 2>&1 | tail -2
  cargo build -p ez-wasm --release --target wasm32-unknown-unknown 2>&1 | grep -E "^(error|warning)|error\[|^ +--> |Finished" | head -60
  wasm-bindgen --target web --out-dir "$WIN/apps/web/src/wasm" target/wasm32-unknown-unknown/release/ez_wasm.wasm && echo WASM_OK
fi
