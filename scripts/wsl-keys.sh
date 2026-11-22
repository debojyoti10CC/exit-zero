#!/usr/bin/env bash
# Creates the deployer wallet and the program keypair (kept outside the repo, in /root/keys).
set -euo pipefail
mkdir -p ~/.config/solana /root/keys
[ -f ~/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase -s -o ~/.config/solana/id.json >/dev/null
solana config set --url https://api.devnet.solana.com >/dev/null
[ -f /root/keys/exit_zero-keypair.json ] || solana-keygen new --no-bip39-passphrase -s -o /root/keys/exit_zero-keypair.json >/dev/null
echo "DEPLOYER $(solana address)"
echo "PROGRAM $(solana-keygen pubkey /root/keys/exit_zero-keypair.json)"
solana balance || true
