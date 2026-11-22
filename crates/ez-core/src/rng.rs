//! Deterministic PRNG (SplitMix64). Seeded from VRF output, never from a client clock.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rng {
    pub state: u64,
}

impl Rng {
    pub fn new(state: u64) -> Self {
        Self { state }
    }

    pub fn from_seed(seed: &[u8; 32], salt: u64) -> Self {
        let mut s = salt ^ 0x9E37_79B9_7F4A_7C15;
        for chunk in seed.chunks(8) {
            let mut b = [0u8; 8];
            b.copy_from_slice(chunk);
            s = s.rotate_left(17) ^ u64::from_le_bytes(b);
            s = s.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        }
        Self { state: s }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform integer in [0, n). Returns 0 when n == 0.
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 {
            return 0;
        }
        ((self.next_u64() >> 32) * n as u64 >> 32) as u32
    }

    /// Uniform integer in [lo, hi] inclusive.
    pub fn range(&mut self, lo: i32, hi: i32) -> i32 {
        if hi <= lo {
            return lo;
        }
        lo + self.below((hi - lo + 1) as u32) as i32
    }

    pub fn chance(&mut self, percent: u32) -> bool {
        self.below(100) < percent
    }
}
