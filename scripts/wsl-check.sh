#!/usr/bin/env bash
# Fast host-side type check of the program (shows full rustc diagnostics).
cd "$HOME/exitzero"
cargo check -p exit-zero --features idl-build 2>&1 | grep -E "^(error|warning)" -A14 | grep -v "^warning: unused" | head -${1:-120}
cargo check -p exit-zero 2>&1 | tail -2
