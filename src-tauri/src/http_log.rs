//! Tiny timing wrapper around reqwest requests so every GitHub API call
//! shows up in logs with method + URL + status + elapsed time.

use std::time::Instant;

/// Send a request and log its timing. `label` is a short operation name so
/// logs are easy to grep: `search_issues`, `graphql:fields`, etc.
///
/// The request is built from the caller's own `reqwest::Client` so all
/// configured headers (User-Agent, etc.) are preserved.
pub async fn send_timed(
    client: &reqwest::Client,
    label: &str,
    builder: reqwest::RequestBuilder,
) -> reqwest::Result<reqwest::Response> {
    let req = builder.build()?;
    let method = req.method().clone();
    let url = req.url().clone();
    let start = Instant::now();
    let res = client.execute(req).await;
    let elapsed = start.elapsed();
    match &res {
        Ok(r) => {
            let status = r.status().as_u16();
            log::info!(
                "gh-api {label} {method} {path} -> {status} in {ms}ms",
                path = short_path(&url),
                ms = elapsed.as_millis(),
            );
        }
        Err(e) => log::warn!(
            "gh-api {label} {method} {path} -> ERR {e} in {ms}ms",
            path = short_path(&url),
            ms = elapsed.as_millis(),
        ),
    }
    res
}

/// Keep the logged URL short — first 60 chars of query string.
fn short_path(url: &reqwest::Url) -> String {
    let path = url.path();
    let query = url.query().unwrap_or("");
    if query.is_empty() {
        return path.to_string();
    }
    let truncated: String = query.chars().take(60).collect();
    let suffix = if query.len() > 60 { "…" } else { "" };
    format!("{path}?{truncated}{suffix}")
}
