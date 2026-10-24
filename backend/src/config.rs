//! Environment config — Task 14.2.
//!
//! Mirrors the Next.js side's env usage (see src/lib/admin-auth.ts):
//! TRUSTED_PROXY and APP_PASSWORD presence change auth behavior, so they
//! are read the same way. APP_PASSWORD's VALUE is deliberately not kept —
//! in `password` mode the Next proxy validates the cookie before the
//! request ever reaches a route; the backend only needs to know the mode.

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub db_path: String,
    /// TRUSTED_PROXY=1 → trust x-forwarded-for / x-real-ip for local checks.
    pub trusted_proxy: bool,
    /// APP_PASSWORD is set (password mode exists). Value never read here.
    pub app_password_set: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3100);
        let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "../data.db".into());
        let trusted_proxy = std::env::var("TRUSTED_PROXY").as_deref() == Ok("1");
        let app_password_set = std::env::var("APP_PASSWORD")
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        Self {
            port,
            db_path,
            trusted_proxy,
            app_password_set,
        }
    }
}
