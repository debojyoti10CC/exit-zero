#!/usr/bin/env bash
# Compares the local build with the deployed program and lists the biggest symbols.
cd "$HOME/exitzero"
ls -la --time-style=+%H:%M target/deploy/exit_zero.so
sha256sum target/deploy/exit_zero.so | cut -c1-16
solana program dump 3gPCvP9DviVCg4MAwA1xcKFbvzPNubVf6rBkJFtnQ9Zi /tmp/deployed.so --url https://api.devnet.solana.com >/dev/null 2>&1
head -c 578016 /tmp/deployed.so | sha256sum | cut -c1-16
grep -c "decode_into" target/deploy/exit_zero.so || true
grep -n "from_raw_mut\|fn world_of" programs/exit-zero/src/lib.rs crates/ez-core/src/world.rs | head
