use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
pub const MAX_REPOS: usize = 8;
pub const MAX_ITEMS: usize = 240;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub enabled: bool,
    pub repositories: Vec<String>,
    pub pull_requests: bool,
    pub reviews: bool,
    pub ci: bool,
    pub issues: bool,
    pub calendar: bool,
    pub notifications: bool,
    pub interval_seconds: u64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            enabled: false,
            repositories: vec![],
            pull_requests: true,
            reviews: true,
            ci: true,
            issues: false,
            calendar: false,
            notifications: false,
            interval_seconds: 300,
        }
    }
}
impl Options {
    pub fn validate(&self) -> Result<(), String> {
        let mut names = HashSet::new();
        if self.repositories.len() > MAX_REPOS
            || self
                .repositories
                .iter()
                .any(|s| !valid_repo(s) || !names.insert(s.to_ascii_lowercase()))
        {
            return Err("Selecciona hasta 8 repositorios válidos, sin duplicados.".into());
        }
        if !(300..=3600).contains(&self.interval_seconds) {
            return Err("El intervalo debe estar entre 5 y 60 minutos.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub options: Options,
    pub account_id: Option<u64>,
    pub seen: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: u64,
    pub login: String,
    pub avatar: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: u64,
    pub full_name: String,
    pub organization: bool,
    pub private: bool,
    pub default_branch: String,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CiState {
    Running,
    Success,
    Failure,
    Cancelled,
    Unknown,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: &'static str,
    pub repository: String,
    pub title: String,
    pub number: u64,
    pub state: String,
    pub url: String,
    pub updated_at: String,
    pub head_sha: Option<String>,
    pub branch: String,
    pub ci: CiState,
    pub review: String,
    pub mine: bool,
    pub review_requested: bool,
    pub attempt: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub count: u64,
    pub level: Option<u8>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub total: u64,
    pub days: Vec<Day>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub status: &'static str,
    pub profile: Option<Profile>,
    pub options: Options,
    pub items: Vec<Item>,
    pub calendar: Option<Calendar>,
    pub last_sync: Option<u64>,
    pub next_refresh: Option<u64>,
    pub syncing: bool,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            status: "disconnected",
            profile: None,
            options: Options::default(),
            items: vec![],
            calendar: None,
            last_sync: None,
            next_refresh: None,
            syncing: false,
            error: None,
            warnings: vec![],
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub snapshot: Snapshot,
    pub repositories: Vec<Repository>,
    pub truncated: bool,
}
pub fn valid_repo(value: &str) -> bool {
    let parts: Vec<_> = value.split('/').collect();
    parts.len() == 2
        && parts[0].len() <= 100
        && !parts[0].is_empty()
        && parts[0]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        && parts[1].len() <= 100
        && !parts[1].is_empty()
        && !matches!(parts[1], "." | "..")
        && parts[1]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}
pub fn valid_token(value: &str) -> bool {
    value.starts_with("github_pat_")
        && (50..=255).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
pub fn safe_url(url: &str, repository: &str) -> bool {
    if !valid_repo(repository) {
        return false;
    }
    let base = format!("https://github.com/{repository}");
    if url == base {
        return true;
    }
    let Some(tail) = url.strip_prefix(&(base + "/")) else {
        return false;
    };
    let parts: Vec<_> = tail.split('/').collect();
    let number = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|c| c.is_ascii_digit());
    matches!(parts.as_slice(),["pull"|"issues",id] if number(id))
        || matches!(parts.as_slice(),["actions","runs",id] if number(id))
}
pub fn text(value: &Value, key: &str, limit: usize) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}
pub fn profile(value: &Value) -> Option<Profile> {
    let id = value.get("id")?.as_u64()?;
    let login = text(value, "login", 100);
    if id == 0
        || login.is_empty()
        || !login
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return None;
    }
    Some(Profile {
        id,
        login,
        avatar: None,
    })
}
pub fn repository(value: &Value) -> Option<Repository> {
    let full_name = text(value, "full_name", 201);
    if !valid_repo(&full_name) {
        return None;
    }
    let expected = format!("https://github.com/{full_name}");
    if value.get("html_url")?.as_str()? != expected {
        return None;
    }
    Some(Repository {
        id: value.get("id")?.as_u64()?,
        full_name,
        organization: value.pointer("/owner/type").and_then(Value::as_str) == Some("Organization"),
        private: value
            .get("private")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        default_branch: text(value, "default_branch", 128),
    })
}
pub fn run_state(status: &str, conclusion: &str) -> CiState {
    match status {
        "queued" | "in_progress" | "waiting" | "requested" | "pending" => CiState::Running,
        "completed" => match conclusion {
            "success" => CiState::Success,
            "failure" | "timed_out" | "startup_failure" => CiState::Failure,
            "cancelled" => CiState::Cancelled,
            _ => CiState::Unknown,
        },
        _ => CiState::Unknown,
    }
}
fn sha(value: &Value, key: &str) -> Option<String> {
    let s = text(value, key, 65);
    ((s.len() == 40 || s.len() == 64) && s.bytes().all(|c| c.is_ascii_hexdigit())).then_some(s)
}
pub fn workflow(value: &Value, repo: &str) -> Option<Item> {
    let id = value.get("id")?.as_u64()?;
    let url = text(value, "html_url", 512);
    if !safe_url(&url, repo) {
        return None;
    }
    let status = text(value, "status", 40);
    let conclusion = text(value, "conclusion", 40);
    Some(Item {
        id: format!("run:{id}"),
        kind: "run",
        repository: repo.into(),
        title: text(value, "name", 160),
        number: value
            .get("run_number")
            .and_then(Value::as_u64)
            .unwrap_or(id),
        state: if status == "completed" {
            conclusion
        } else {
            status.clone()
        },
        url,
        updated_at: text(value, "updated_at", 40),
        head_sha: sha(value, "head_sha"),
        branch: text(value, "head_branch", 128),
        ci: run_state(&status, &text(value, "conclusion", 40)),
        review: "unknown".into(),
        mine: false,
        review_requested: false,
        attempt: value
            .get("run_attempt")
            .and_then(Value::as_u64)
            .unwrap_or(1),
    })
}
pub fn pull(value: &Value, repo: &str, login: &str) -> Option<Item> {
    let id = value.get("id")?.as_u64()?;
    let number = value.get("number")?.as_u64()?;
    let url = text(value, "html_url", 512);
    if !safe_url(&url, repo) {
        return None;
    }
    let requested = value
        .get("requested_reviewers")
        .and_then(Value::as_array)
        .is_some_and(|r| {
            r.iter()
                .any(|v| v.get("login").and_then(Value::as_str) == Some(login))
        });
    Some(Item {
        id: format!("pr:{id}"),
        kind: "pull",
        repository: repo.into(),
        title: text(value, "title", 160),
        number,
        state: if value.get("merged_at").is_some_and(|v| !v.is_null()) {
            "merged".into()
        } else {
            text(value, "state", 16)
        },
        url,
        updated_at: text(value, "updated_at", 40),
        head_sha: value.get("head").and_then(|v| sha(v, "sha")),
        branch: value
            .get("head")
            .map(|v| text(v, "ref", 128))
            .unwrap_or_default(),
        ci: CiState::Unknown,
        review: if requested { "requested" } else { "unknown" }.into(),
        mine: value.pointer("/user/login").and_then(Value::as_str) == Some(login),
        review_requested: requested,
        attempt: 1,
    })
}
pub fn issue(value: &Value, repo: &str) -> Option<Item> {
    if value.get("pull_request").is_some() {
        return None;
    }
    let id = value.get("id")?.as_u64()?;
    let number = value.get("number")?.as_u64()?;
    let url = text(value, "html_url", 512);
    if !safe_url(&url, repo) {
        return None;
    }
    Some(Item {
        id: format!("issue:{id}"),
        kind: "issue",
        repository: repo.into(),
        title: text(value, "title", 160),
        number,
        state: text(value, "state", 16),
        url,
        updated_at: text(value, "updated_at", 40),
        head_sha: None,
        branch: String::new(),
        ci: CiState::Unknown,
        review: "unknown".into(),
        mine: true,
        review_requested: false,
        attempt: 1,
    })
}
pub fn contribution_calendar(value: &Value) -> Option<Calendar> {
    let value = value.pointer("/data/viewer/contributionsCollection/contributionCalendar")?;
    let total = value.get("totalContributions")?.as_u64()?;
    let mut days = vec![];
    for week in value.get("weeks")?.as_array()?.iter().take(54) {
        for day in week.get("contributionDays")?.as_array()?.iter().take(7) {
            let date = text(day, "date", 10);
            if date.len() != 10
                || !date.bytes().enumerate().all(|(i, c)| {
                    if i == 4 || i == 7 {
                        c == b'-'
                    } else {
                        c.is_ascii_digit()
                    }
                })
            {
                continue;
            }
            let Some(count) = day.get("contributionCount").and_then(Value::as_u64) else {
                continue;
            };
            let level = match day.get("contributionLevel").and_then(Value::as_str) {
                Some("NONE") => Some(0),
                Some("FIRST_QUARTILE") => Some(1),
                Some("SECOND_QUARTILE") => Some(2),
                Some("THIRD_QUARTILE") => Some(3),
                Some("FOURTH_QUARTILE") => Some(4),
                _ => None,
            };
            days.push(Day { date, count, level });
        }
    }
    days.sort_by(|a, b| a.date.cmp(&b.date));
    days.dedup_by(|a, b| a.date == b.date);
    if days.len() > 91 {
        days.drain(..days.len() - 91);
    }
    Some(Calendar { total, days })
}
pub fn fingerprint(item: &Item) -> String {
    format!(
        "{}:{}:{}:{}:{:?}:{}",
        item.id,
        item.attempt,
        item.head_sha.as_deref().unwrap_or(""),
        item.state,
        item.ci,
        item.review_requested
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn slugs_urls_and_configuration_are_finite() {
        for v in ["Orvyn-Studios/nivo", "SnoW-099/project"] {
            assert!(valid_repo(v));
        }
        for v in [
            "../nivo",
            "o/..",
            "o/r/a",
            "o/r?token=x",
            "https://github.com/o/r",
        ] {
            assert!(!valid_repo(v));
        }
        assert!(safe_url(
            "https://github.com/Orvyn-Studios/nivo/pull/12",
            "Orvyn-Studios/nivo"
        ));
        for u in [
            "javascript:alert(1)",
            "https://github.com.evil/x",
            "https://github.com/o/r/pull/1?redirect=x",
            "https://github.com/o/r/../../x",
        ] {
            assert!(!safe_url(u, "o/r"));
        }
        assert!(Options::default().validate().is_ok());
        let o = Options {
            interval_seconds: 1,
            ..Options::default()
        };
        assert!(o.validate().is_err());
    }
    #[test]
    fn ci_completion_never_means_success_without_conclusion() {
        assert_eq!(run_state("completed", "failure"), CiState::Failure);
        assert_eq!(run_state("completed", "cancelled"), CiState::Cancelled);
        assert_eq!(run_state("completed", ""), CiState::Unknown);
        assert_eq!(run_state("completed", "skipped"), CiState::Unknown);
        assert_eq!(run_state("in_progress", ""), CiState::Running);
        assert_eq!(run_state("completed", "success"), CiState::Success);
    }
    #[test]
    fn real_shape_organization_and_calendar_parsing() {
        let r=repository(&json!({"id":12,"full_name":"Orvyn-Studios/nivo","html_url":"https://github.com/Orvyn-Studios/nivo","owner":{"type":"Organization"},"private":true})).unwrap();
        assert!(r.organization);
        assert!(profile(&json!({"id":1,"login":"SnoW-099"})).is_some());
        assert!(contribution_calendar(&json!({"errors":[{}]})).is_none());
        let empty=contribution_calendar(&json!({"data":{"viewer":{"contributionsCollection":{"contributionCalendar":{"totalContributions":0,"weeks":[]}}}}})).unwrap();
        assert!(empty.days.is_empty());
    }
}
