//! Password hashing — Task 14.4. Faithful port of the scrypt halves of
//! src/lib/auth.ts (hashPassword / verifyPassword / passwordProblem /
//! normaliseEmail).
//!
//! Format: `scrypt:1:{saltHex}:{derivedHex}` with Node's crypto.scrypt
//! defaults (N=16384, r=8, p=1, keylen=64). The salt is stored inline as
//! a hex STRING and — this is the part to get right — Node passes that
//! hex string as the salt directly, so the KDF input is the hex text's
//! UTF-8 bytes, NOT the decoded bytes. Rust must do the same or every
//! verification of an existing hash fails.

use scrypt::{scrypt, Params};

/// Node scrypt defaults: cost 2^14, block 8, parallel 1, 64-byte key.
fn params() -> Params {
    Params::new(14, 8, 1, 64).expect("static scrypt params are valid")
}

fn derive(password: &str, salt_text: &str) -> [u8; 64] {
    let mut out = [0u8; 64];
    // Panic-free: params + inputs are within scrypt's limits; a failure
    // would mean OOM at 16 MiB, which cannot happen here.
    let _ = scrypt(password.as_bytes(), salt_text.as_bytes(), &params(), &mut out);
    out
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// CPU-bound (~100 ms) — run inside spawn_blocking at call sites.
pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    rand::Rng::fill(&mut rand::thread_rng(), &mut salt);
    let salt_hex = hex_encode(&salt);
    let derived = derive(password, &salt_hex);
    format!("scrypt:1:{salt_hex}:{}", hex_encode(&derived))
}

/// CPU-bound (~100 ms) — run inside spawn_blocking at call sites.
pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 4 || parts[0] != "scrypt" {
        return false;
    }
    let (salt, expected_hex) = (parts[2], parts[3]);
    let Some(expected) = hex_decode(expected_hex) else {
        return false;
    };
    if expected.len() != 64 {
        return false;
    }
    let derived = derive(password, salt);
    crate::auth::ct_eq(&derived, &expected)
}

/// Port of MIN_PASSWORD_LENGTH + passwordProblem. Long beats complex.
pub const MIN_PASSWORD_LENGTH: usize = 10;

pub fn password_problem(password: &str) -> Option<String> {
    // JS .length counts UTF-16 units; chars() is close enough for length
    // gates and avoids a panicking byte-slice.
    let len = password.chars().count();
    if len < MIN_PASSWORD_LENGTH {
        return Some(format!(
            "Use at least {MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember beats a short jumble you won't."
        ));
    }
    if len > 200 {
        return Some("That's longer than 200 characters.".into());
    }
    None
}

/// Port of normaliseEmail: trim + lowercase (ASCII lower is what SQLite
/// lower() does too, and the unique index uses that — stay consistent).
pub fn normalise_email(email: &str) -> String {
    email.trim().to_lowercase()
}
