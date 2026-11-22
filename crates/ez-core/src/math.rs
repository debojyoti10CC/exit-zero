//! Integer trigonometry and geometry helpers.

/// sin(i * 2pi / 256) * 1024 for i in 0..=64 (first quadrant).
const SIN_Q: [i32; 65] = [
    0, 25, 50, 75, 100, 125, 150, 175, 200, 224, 249, 273, 297, 321, 345, 369, 392, 415, 438, 460,
    483, 505, 526, 548, 569, 590, 610, 630, 650, 669, 688, 706, 724, 742, 759, 775, 792, 807, 822,
    837, 851, 865, 878, 891, 903, 915, 926, 936, 946, 955, 964, 972, 980, 987, 993, 999, 1004, 1009,
    1013, 1016, 1019, 1021, 1023, 1024, 1024,
];

/// Sine of a byte angle (256 = full turn), scaled by 1024.
pub fn sin256(a: u8) -> i32 {
    let a = a as usize;
    match a {
        0..=64 => SIN_Q[a],
        65..=128 => SIN_Q[128 - a],
        129..=192 => -SIN_Q[a - 128],
        _ => -SIN_Q[256 - a],
    }
}

/// Cosine of a byte angle, scaled by 1024. Angle 0 points along +x, 64 along +y (screen down).
pub fn cos256(a: u8) -> i32 {
    sin256(a.wrapping_add(64))
}

pub fn isqrt(n: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

pub fn dist2(ax: i32, ay: i32, bx: i32, by: i32) -> i64 {
    let dx = (ax - bx) as i64;
    let dy = (ay - by) as i64;
    dx * dx + dy * dy
}

pub fn dist(ax: i32, ay: i32, bx: i32, by: i32) -> i32 {
    isqrt(dist2(ax, ay, bx, by)) as i32
}

/// Byte angle from (ax,ay) towards (bx,by). Uses an octant-based atan2 approximation
/// that is exact enough (about 1/256 turn) for aiming and arcs.
pub fn angle_to(ax: i32, ay: i32, bx: i32, by: i32) -> u8 {
    let dx = (bx - ax) as i64;
    let dy = (by - ay) as i64;
    if dx == 0 && dy == 0 {
        return 0;
    }
    let adx = dx.abs();
    let ady = dy.abs();
    // angle within first octant in units of 1/256 turn: atan(t) * 128/pi, t in [0,1]
    // atan(t) ~ t * (pi/4) - t(t-1)(0.2447 + 0.0663 t) ; we use a table-free rational approx.
    let (num, den, swap) = if adx >= ady { (ady, adx, false) } else { (adx, ady, true) };
    // t scaled by 4096
    let t = num * 4096 / den;
    // atan(t)/(2pi)*256 = atan(t)*40.743 ; approximate atan(t) ~ t*(0.9724 - 0.1919 t^2) radians
    let t2 = t * t / 4096;
    let at = t * (3983 - 786 * t2 / 4096) / 4096; // radians * 4096
    let oct = (at * 40743 / 1000 / 4096) as i32; // 0..32
    let mut a = if swap { 64 - oct } else { oct };
    if dx < 0 {
        a = 128 - a;
    }
    if dy < 0 {
        a = 256 - a;
    }
    (a & 255) as u8
}

/// Shortest absolute difference between two byte angles (0..=128).
pub fn angle_diff(a: u8, b: u8) -> u8 {
    let d = a.wrapping_sub(b);
    if d > 128 {
        (256u16 - d as u16) as u8
    } else {
        d
    }
}

pub fn clamp_i32(v: i32, lo: i32, hi: i32) -> i32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}
