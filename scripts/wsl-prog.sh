#!/usr/bin/env bash
# Type-checks, then builds the SBF program and reports stack-frame problems.
cd "$HOME/exitzero"
bash scripts/wsl-check.sh 60
bash scripts/wsl-build.sh program 2>&1 | grep -E "Stack offset|overwrites|^error|Finished|exit_zero.so|Error" | head -40
