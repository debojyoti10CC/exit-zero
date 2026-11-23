#!/usr/bin/env bash
# Check, build and upgrade the program on devnet.
cd "$HOME/exitzero"
bash scripts/wsl-check.sh 40 || exit 1
bash scripts/wsl-prog.sh | grep -E "Stack offset|^error|exit_zero.so"
bash scripts/wsl-deploy.sh 2>&1 | grep -E "Signature|Last Deployed|Error|error"
