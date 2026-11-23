#!/usr/bin/env bash
cd "$HOME/exitzero"
bash scripts/wsl-check.sh 60
cargo test -p ez-core --release -- --nocapture 2>&1 | grep -E "WORLD_RAW|test result: ok. 8|FAILED|panicked"
bash scripts/wsl-build.sh wasm 2>&1 | grep -E "^error|WASM_OK" -A5
