#!/usr/bin/env bash
# Installs the Solana program toolchain inside WSL (Ubuntu 24.04).
# Versions match the official MagicBlock examples (Anchor 1.0.2, Solana 3.1.9, Rust 1.89.0).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y build-essential pkg-config libssl-dev libudev-dev curl git ca-certificates

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi
source "$HOME/.cargo/env"
rustup install 1.89.0

if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.9/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q 'solana/install/active_release' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/solana-foundation/anchor avm --force
fi
avm install 1.0.2
avm use 1.0.2

solana --version
anchor --version
echo "SETUP_DONE"
