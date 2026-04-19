use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "dev.ghtasks.app";
const KEYRING_ACCOUNT: &str = "github-token";

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
    },
}

/// Start the device flow: ask GitHub for a user code.
pub async fn start_device_flow(client: &reqwest::Client) -> Result<DeviceCode> {
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id()),
            ("scope", "repo read:user notifications".to_string()),
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

/// Poll once for the access token. Returns Ok(Some(token)) on success,
/// Ok(None) if still pending, or Err on hard failure.
pub async fn poll_for_token(
    client: &reqwest::Client,
    device_code: &str,
) -> Result<Option<String>> {
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

    let body: TokenResponse = resp.json().await?;
    match body {
        TokenResponse::Ok { access_token, .. } => Ok(Some(access_token)),
        TokenResponse::Err { error, .. } => match error.as_str() {
            "authorization_pending" => Err(Error::AuthPending),
            "slow_down" => Err(Error::AuthSlowDown),
            "expired_token" => Err(Error::AuthExpired),
            "access_denied" => Err(Error::AuthDenied),
            other => Err(Error::Other(format!("oauth error: {other}"))),
        },
    }
}

/// Persist the token in the OS keychain.
pub fn store_token(token: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    entry.set_password(token)?;
    Ok(())
}

/// Retrieve the token from the OS keychain if present.
pub fn load_token() -> Result<Option<String>> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match entry.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Keyring(e)),
    }
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
