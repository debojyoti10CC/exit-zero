#!/usr/bin/env bash
# Runs core tests then rebuilds WASM.
cd "$HOME/exitzero"
cargo test -p ez-core --release 2>&1 | grep -E "^test |test result|panicked"
bash scripts/wsl-build.sh wasm
