#!/usr/bin/env bash
# Tests the core, then rebuilds the program (with IDL) and the WASM bundle.
cd "$HOME/exitzero"
cargo test -p ez-core --release 2>&1 | grep -E "test result: ok. 5|FAILED|panicked"
bash scripts/wsl-build.sh all 2>&1 | grep -E "Stack offset|^error|WASM_OK|exit_zero.so"
