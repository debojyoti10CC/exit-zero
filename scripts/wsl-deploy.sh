#!/usr/bin/env bash
# Deploys the built program to devnet with the deployer wallet (~/.config/solana/id.json).
set -euo pipefail
cd "$HOME/exitzero"
echo "Deployer: $(solana address)  balance: $(solana balance)"
solana program deploy target/deploy/exit_zero.so \
  --program-id /root/keys/exit_zero-keypair.json \
  --url https://api.devnet.solana.com \
  --with-compute-unit-price 50000 \
  --max-sign-attempts 20
solana program show "$(solana-keygen pubkey /root/keys/exit_zero-keypair.json)" --url https://api.devnet.solana.com
