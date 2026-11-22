#!/usr/bin/env bash
# Usage (from Windows): wsl -d Ubuntu-24.04 -u root -- bash /root/exitzero/scripts/wsl-env.sh '<command>'
# Runs a command inside the WSL mirror with the Solana/Anchor toolchain on PATH.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$HOME/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
source "$HOME/.cargo/env"
cd "$HOME/exitzero"
eval "$1"
