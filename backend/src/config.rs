//! Environment config — Task 14.2, extended in 14.4.
//!
//! Mirrors the Next.js side's env usage (see src/lib/admin-auth.ts and
//! src/lib/auth.ts): TRUSTED_PROXY and APP_PASSWORD presence change auth
//! behavior. Since 14.4 (auth domain port) the APP_PASSWORD VALUE is kept
//! in process memory for the password-mode login check — it is never
//! logged, never echoed, never persisted, exactly like the Next route
//! that reads process.env.APP_PASSWORD per request.

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub db_path: String,
    /// TRUSTED_PROXY=1 → trust x-forwarded-for / x-real-ip for local checks.
    pub trusted_proxy: bool,
    /// APP_PASSWORD is set (password mode exists).
    pub app_password_set: bool,
    /// APP_PASSWORD value — password-mode login + session-secret fallback.
    /// Empty when unset. Kept in memory only.
    pub app_password: String,
    /// SEO_COOKIE_SECURE=1 → always mark auth cookies Secure (isHttps port).
    pub cookie_secure_env: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3100);
        let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "../data.db".into());
        let trusted_proxy = std::env::var("TRUSTED_PROXY").as_deref() == Ok("1");
        let app_password = std::env::var("APP_PASSWORD").unwrap_or_default();
        let app_password_set = !app_password.is_empty();
        let cookie_secure_env = std::env::var("SEO_COOKIE_SECURE").as_deref() == Ok("1");
        Self {
            port,
            db_path,
            trusted_proxy,
            app_password_set,
            app_password,
            cookie_secure_env,
        }
    }

    /// Port of dataDir() (src/lib/data-dir.ts): SEO_DATA_DIR →
    /// dirname(SEO_DB_PATH) → install root. The Next process runs with
    /// cwd = repo root; this process runs with cwd = backend/, so the
    /// fallback resolves one level up. Same files end up in the same
    /// folder — that is the point.
    pub fn data_dir(&self) -> std::path::PathBuf {
        if let Ok(d) = std::env::var("SEO_DATA_DIR") {
            if !d.is_empty() {
                return std::path::PathBuf::from(d);
            }
        }
        if let Ok(p) = std::env::var("SEO_DB_PATH") {
            if !p.is_empty() {
                let pb = std::path::PathBuf::from(&p);
                if let Some(parent) = pb.parent() {
                    return parent
                        .canonicalize()
                        .unwrap_or_else(|_| parent.to_path_buf());
                }
            }
        }
        std::path::Path::new("..")
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(".."))
    }
}
