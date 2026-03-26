use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateCheckResult {
    pub up_to_date: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.config().version.clone().unwrap_or_default();

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/bassman2112/palimpsest/releases/latest")
        .header("User-Agent", format!("Palimpsest/{}", current_version))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;

    let tag = body["tag_name"]
        .as_str()
        .ok_or("Missing tag_name in response")?;
    let latest_version = tag.strip_prefix('v').unwrap_or(tag).to_string();
    let release_url = body["html_url"]
        .as_str()
        .unwrap_or("https://github.com/bassman2112/palimpsest/releases")
        .to_string();

    let up_to_date = current_version == latest_version;

    Ok(UpdateCheckResult {
        up_to_date,
        current_version,
        latest_version,
        release_url,
    })
}
