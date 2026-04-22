use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "com.cgaspard.ghtasks";
const KEYRING_ACCOUNT: &str = "github-token";
/// Previous service name (pre-v0.1.5). Checked by `load_token` for a
/// one-time migration so existing users don't have to re-authenticate.
const LEGACY_KEYRING_SERVICE: &str = "dev.ghtasks.app";

/// Default client id points to the public "GH Tasks" GitHub App / OAuth app.
/// Override at build time with the `GHTASKS_CLIENT_ID` env var (read via
/// `option_env!`), or at runtime with the `GHTASKS_CLIENT_ID` env var.
pub fn client_id() -> String {
    if let Ok(v) = std::env::var("GHTASKS_CLIENT_ID") {
        return v;
    }
    option_env!("GHTASKS_CLIENT_ID")
        .unwrap_or("Iv1.placeholder-set-at-build-time")
        .to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TokenResponse {
    Ok {
        access_token: String,
        #[allow(dead_code)]
        token_type: String,
        #[allow(dead_code)]
        scope: Option<String>,
    },
    Err {
        error: String,
        #[allow(dead_code)]
        error_description: Option<String>,
        /// GitHub may include a new minimum interval (in seconds) when it
        /// returns `slow_down`. Honor it — otherwise we deadlock at 5s.
        #[serde(default)]
        interval: Option<u64>,
    },
}

/// Outcome of a single device-flow poll.
pub enum PollOutcome {
    /// Auth complete — bearer token ready.
    Token(String),
    /// Not ready yet. Optional new minimum interval (secs) from GitHub.
    Pending { new_interval: Option<u64> },
}

/// Start the device flow: ask GitHub for a user code.
pub async fn start_device_flow(client: &reqwest::Client) -> Result<DeviceCode> {
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id()),
            (
                "scope",
                "repo read:user read:org notifications project".to_string(),
            ),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let message = resp.text().await.unwrap_or_default();
        return Err(Error::GitHub { status, message });
    }

    let d: DeviceCodeResponse = resp.json().await?;
    Ok(DeviceCode {
        device_code: d.device_code,
        user_code: d.user_code,
        verification_uri: d.verification_uri,
        expires_in: d.expires_in,
        interval: d.interval,
    })
}

/// Poll once for the access token. On a pending response, includes any new
/// minimum polling interval GitHub has asked us to honor.
pub async fn poll_for_token(
    client: &reqwest::Client,
    device_code: &str,
) -> Result<PollOutcome> {
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id()),
            ("device_code", device_code.to_string()),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code".to_string(),
            ),
        ])
        .send()
        .await?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    log::debug!("device-flow poll status={status} body={}", redact_token(&raw));

    let body: TokenResponse = serde_json::from_str(&raw).map_err(|e| {
        // Defense in depth: even though a parse failure on the
        // device-flow response shouldn't contain a token (GitHub only
        // returns access_token on valid 200 JSON), redact anyway
        // before surfacing the raw body to the frontend.
        Error::Other(format!(
            "device-flow: could not parse response (status {status}): {e}; body: {}",
            redact_token(&raw)
        ))
    })?;
    match body {
        TokenResponse::Ok { access_token, .. } => Ok(PollOutcome::Token(access_token)),
        TokenResponse::Err {
            error, interval, ..
        } => match error.as_str() {
            "authorization_pending" => Ok(PollOutcome::Pending {
                new_interval: interval,
            }),
            "slow_down" => Ok(PollOutcome::Pending {
                new_interval: interval,
            }),
            "expired_token" => Err(Error::AuthExpired),
            "access_denied" => Err(Error::AuthDenied),
            other => Err(Error::Other(format!("oauth error: {other}"))),
        },
    }
}

/// Persist the token in the OS keychain.
pub fn store_token(token: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match entry.set_password(token) {
        Ok(()) => {
            log::info!("stored github token in keychain ({} bytes)", token.len());
            Ok(())
        }
        Err(e) => {
            log::error!("failed to store token in keychain: {e}");
            Err(Error::Keyring(e))
        }
    }
}

/// Retrieve the token from the OS keychain if present.
///
/// Performs a one-time migration from the legacy `dev.ghtasks.app` service
/// name so existing installs don't have to re-authenticate after the
/// bundle-identifier rename.
pub fn load_token() -> Result<Option<String>> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match entry.get_password() {
        Ok(t) => return Ok(Some(t)),
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(Error::Keyring(e)),
    }

    // New-style entry absent — try legacy and migrate in place.
    let legacy = keyring::Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match legacy.get_password() {
        Ok(t) => {
            log::info!(
                "migrating GitHub token from legacy keychain entry ({LEGACY_KEYRING_SERVICE}) to {KEYRING_SERVICE}"
            );
            if let Err(e) = entry.set_password(&t) {
                log::warn!("failed to copy token to new keychain entry: {e}");
                // Fall back to returning the legacy value; we'll retry next launch.
                return Ok(Some(t));
            }
            // Best-effort cleanup of the legacy entry. Failures here are
            // harmless — the entry will just sit there unused.
            if let Err(e) = legacy.delete_credential() {
                log::debug!("legacy keychain entry cleanup failed (harmless): {e}");
            }
            Ok(Some(t))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Keyring(e)),
    }
}

/// Redact any `access_token` value from a raw JSON response so tokens don't
/// leak into logs or error messages.
fn redact_token(raw: &str) -> String {
    // Simple string-level mask — good enough for logging.
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(idx) = rest.find("\"access_token\":") {
        out.push_str(&rest[..idx]);
        out.push_str("\"access_token\":\"<redacted>\"");
        rest = &rest[idx + "\"access_token\":".len()..];
        // Skip the original value: optional whitespace, then a quoted string.
        let after_ws = rest.trim_start();
        if let Some(stripped) = after_ws.strip_prefix('"') {
            if let Some(end) = stripped.find('"') {
                rest = &stripped[end + 1..];
                continue;
            }
        }
        break;
    }
    out.push_str(rest);
    out
}

/// Remove the stored token (logout).
pub fn clear_token() -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keyring(e)),
    }
}
