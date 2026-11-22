//! EXIT//ZERO deterministic game core.
//!
//! Integer-only, `no_std` simulation. The exact same code runs inside the
//! Solana program (on a MagicBlock Ephemeral Rollup) and in the browser via
//! WASM (practice mode and client-side movement prediction). Because there is
//! no floating point and no hidden randomness, every client and the rollup
//! agree on the outcome of every input.

#![no_std]
extern crate alloc;

pub mod bots;
pub mod codec;
pub mod consts;
pub mod loot;
pub mod map;
pub mod math;
pub mod rng;
pub mod sim;
pub mod world;

pub use consts::*;
pub use world::*;
