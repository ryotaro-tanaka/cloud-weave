//! Pure helpers for remote path strings, upload routing, download progress math, and open-cache naming.
//! No Tauri dependency.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path};

/// Join two remote path segments (rclone-style, forward slashes).
pub fn join_remote_path(base_path: &str, relative_path: &str) -> String {
    let trimmed_base = base_path.trim_matches('/');
    let trimmed_relative = relative_path.trim_matches('/');

    if trimmed_base.is_empty() {
        trimmed_relative.to_string()
    } else if trimmed_relative.is_empty() {
        trimmed_base.to_string()
    } else {
        format!("{trimmed_base}/{trimmed_relative}")
    }
}

/// Download / copy progress percentage from bytes and known total.
pub fn completion_progress(
    bytes_transferred: Option<u64>,
    total_bytes: Option<u64>,
) -> Option<f64> {
    match (bytes_transferred, total_bytes) {
        (_, Some(0)) => Some(100.0),
        (Some(bytes), Some(total)) if total > 0 => {
            Some(((bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UploadRemoteCapacity {
    Supported { free_bytes: u64 },
    SupportedWithoutFree,
    Unsupported,
}

/// Rank remotes for upload: prefer largest free space that fits `file_size`, then unsupported fallbacks.
pub fn rank_upload_remotes_by_capacity(
    remotes: &[String],
    capacities: &HashMap<String, UploadRemoteCapacity>,
    file_size: u64,
) -> Vec<String> {
    let mut supported = remotes
        .iter()
        .filter_map(|remote_name| match capacities.get(remote_name) {
            Some(UploadRemoteCapacity::Supported { free_bytes }) if *free_bytes >= file_size => {
                Some((remote_name.clone(), *free_bytes))
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    supported.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));

    let unsupported = remotes
        .iter()
        .filter(|remote_name| {
            matches!(
                capacities.get(*remote_name),
                Some(
                    UploadRemoteCapacity::Unsupported | UploadRemoteCapacity::SupportedWithoutFree
                )
            )
        })
        .cloned()
        .collect::<Vec<_>>();

    if !supported.is_empty() {
        let mut ranked = vec![supported[0].0.clone()];

        for remote_name in unsupported {
            if !ranked.iter().any(|existing| existing == &remote_name) {
                ranked.push(remote_name);
            }
        }

        for (remote_name, _) in supported.into_iter().skip(1) {
            if !ranked.iter().any(|existing| existing == &remote_name) {
                ranked.push(remote_name);
            }
        }

        return ranked;
    }

    unsupported
}

/// Provider order for an optional file extension; always includes `onedrive` as fallback.
pub fn providers_for_extension(
    provider_priority_by_extension: &HashMap<String, Vec<String>>,
    extension: Option<&str>,
) -> Vec<String> {
    let normalized = extension
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty());

    let mut providers = normalized
        .as_deref()
        .and_then(|value| provider_priority_by_extension.get(value))
        .cloned()
        .unwrap_or_default();

    if !providers.iter().any(|provider| provider == "onedrive") {
        providers.push("onedrive".to_string());
    }

    providers.dedup();
    providers
}

/// Resolve category folder under a provider; default `cloud-weave/{category}`.
pub fn category_base_path(
    category_path_by_provider: &HashMap<String, HashMap<String, String>>,
    provider: &str,
    category: &str,
) -> String {
    category_path_by_provider
        .get(provider)
        .and_then(|paths| paths.get(category))
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("cloud-weave/{category}"))
        .trim_matches('/')
        .replace('\\', "/")
}

/// Default upload routing tables (extension → providers, provider → category paths).
pub fn default_upload_routing_tables() -> (
    HashMap<String, Vec<String>>,
    HashMap<String, HashMap<String, String>>,
) {
    let mut provider_priority_by_extension = HashMap::<String, Vec<String>>::new();

    for extension in ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf"] {
        provider_priority_by_extension.insert(extension.to_string(), vec!["onedrive".to_string()]);
    }

    for extension in ["jpg", "jpeg", "png", "heic", "heif", "raw", "mp4", "mov"] {
        provider_priority_by_extension.insert(
            extension.to_string(),
            vec![
                "icloud".to_string(),
                "dropbox".to_string(),
                "onedrive".to_string(),
            ],
        );
    }

    for extension in ["txt", "md", "csv", "json", "zip"] {
        provider_priority_by_extension.insert(extension.to_string(), vec!["onedrive".to_string()]);
    }

    let categories = ["documents", "photos", "videos", "audio", "other"];
    let mut category_path_by_provider = HashMap::<String, HashMap<String, String>>::new();

    for provider in ["onedrive", "gdrive", "dropbox", "icloud"] {
        let mut provider_paths = HashMap::new();

        for category in categories {
            provider_paths.insert(category.to_string(), format!("cloud-weave/{category}"));
        }

        category_path_by_provider.insert(provider.to_string(), provider_paths);
    }

    (provider_priority_by_extension, category_path_by_provider)
}

fn normal_path_component(component: Component<'_>) -> Option<String> {
    match component {
        Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// Leaf file name for transfers: prefer last component of `display_name`, then `source_path`.
pub fn select_leaf_file_name(display_name: &str, source_path: &str) -> String {
    let display_candidate = Path::new(display_name)
        .components()
        .rev()
        .find_map(normal_path_component);
    let source_candidate = Path::new(source_path)
        .components()
        .rev()
        .find_map(normal_path_component);

    display_candidate
        .or(source_candidate)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "downloaded-file".to_string())
}

/// Sanitize a file stem for open-cache file names (alphanumeric + `-_.`, max 48 chars).
pub fn sanitize_open_cache_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();

    if sanitized.is_empty() {
        "open-file".to_string()
    } else {
        sanitized
    }
}

/// Stable hex suffix from remote + path (for cache file naming).
pub fn open_cache_key_suffix(source_remote: &str, source_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_remote.hash(&mut hasher);
    source_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// How to open a local file for preview (`preview-image`, `preview-pdf`, `system-default`).
pub fn select_preview_open_mode(
    mime_type: Option<&str>,
    extension: Option<&str>,
) -> Option<&'static str> {
    let normalized_mime = mime_type.unwrap_or_default().trim().to_ascii_lowercase();
    let normalized_extension = extension
        .unwrap_or_default()
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();

    if normalized_mime.starts_with("image/")
        || matches!(
            normalized_extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
        )
    {
        Some("preview-image")
    } else if normalized_mime == "application/pdf" || normalized_extension == "pdf" {
        Some("preview-pdf")
    } else if matches!(
        normalized_mime.as_str(),
        "text/plain"
            | "text/markdown"
            | "text/csv"
            | "application/json"
            | "application/msword"
            | "application/vnd.ms-excel"
            | "application/vnd.ms-powerpoint"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) || matches!(
        normalized_extension.as_str(),
        "txt" | "md" | "csv" | "json" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx"
    ) {
        Some("system-default")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_remote_path_normalizes_segments() {
        assert_eq!(
            join_remote_path("cloud-weave/documents", "reports/file.pdf"),
            "cloud-weave/documents/reports/file.pdf"
        );
    }

    #[test]
    fn completion_progress_uses_total_bytes() {
        assert_eq!(completion_progress(Some(25), Some(100)), Some(25.0));
        assert_eq!(completion_progress(Some(0), Some(0)), Some(100.0));
        assert_eq!(completion_progress(Some(50), None), None);
    }

    #[test]
    fn select_leaf_file_name_prefers_leaf_name() {
        assert_eq!(
            select_leaf_file_name("folder/report.pdf", "docs/report.pdf"),
            "report.pdf"
        );
        assert_eq!(
            select_leaf_file_name("", "nested/photos/image.png"),
            "image.png"
        );
    }

    #[test]
    fn providers_for_extension_falls_back_to_onedrive() {
        let (priority, _) = default_upload_routing_tables();

        assert_eq!(
            providers_for_extension(&priority, Some(".docx")),
            vec!["onedrive".to_string()]
        );
        assert_eq!(
            providers_for_extension(&priority, Some(".unknown")),
            vec!["onedrive".to_string()]
        );
    }

    #[test]
    fn rank_upload_remotes_by_capacity_prefers_largest_supported_remote() {
        let remotes = vec![
            "onedrive-main".to_string(),
            "onedrive-archive".to_string(),
            "onedrive-fallback".to_string(),
        ];
        let capacities = HashMap::from([
            (
                "onedrive-main".to_string(),
                UploadRemoteCapacity::Supported { free_bytes: 100 },
            ),
            (
                "onedrive-archive".to_string(),
                UploadRemoteCapacity::Supported { free_bytes: 300 },
            ),
            (
                "onedrive-fallback".to_string(),
                UploadRemoteCapacity::Unsupported,
            ),
        ]);

        assert_eq!(
            rank_upload_remotes_by_capacity(&remotes, &capacities, 50),
            vec![
                "onedrive-archive".to_string(),
                "onedrive-fallback".to_string(),
                "onedrive-main".to_string()
            ]
        );
    }

    #[test]
    fn rank_upload_remotes_by_capacity_falls_back_to_unsupported_when_needed() {
        let remotes = vec!["onedrive-main".to_string(), "onedrive-archive".to_string()];
        let capacities = HashMap::from([
            (
                "onedrive-main".to_string(),
                UploadRemoteCapacity::Supported { free_bytes: 10 },
            ),
            (
                "onedrive-archive".to_string(),
                UploadRemoteCapacity::Unsupported,
            ),
        ]);

        assert_eq!(
            rank_upload_remotes_by_capacity(&remotes, &capacities, 50),
            vec!["onedrive-archive".to_string()]
        );
    }

    #[test]
    fn category_base_path_uses_default_when_missing() {
        let (_, categories) = default_upload_routing_tables();

        assert_eq!(
            category_base_path(&categories, "onedrive", "documents"),
            "cloud-weave/documents"
        );
        assert_eq!(
            category_base_path(&categories, "unknown-provider", "other"),
            "cloud-weave/other"
        );
    }

    #[test]
    fn sanitize_open_cache_stem_preserves_safe_characters() {
        assert_eq!(sanitize_open_cache_stem("report.v1"), "report.v1");
        assert_eq!(sanitize_open_cache_stem("bad name/?"), "bad-name");
    }

    #[test]
    fn open_cache_key_suffix_is_stable() {
        let first = open_cache_key_suffix("onedrive-main", "folder/file.pdf");
        let second = open_cache_key_suffix("onedrive-main", "folder/file.pdf");
        let third = open_cache_key_suffix("onedrive-main", "folder/other.pdf");

        assert_eq!(first, second);
        assert_ne!(first, third);
    }

    #[test]
    fn select_preview_open_mode_prefers_previewable_types() {
        assert_eq!(
            select_preview_open_mode(Some("image/jpeg"), Some("jpg")),
            Some("preview-image")
        );
        assert_eq!(
            select_preview_open_mode(Some("application/pdf"), Some("pdf")),
            Some("preview-pdf")
        );
        assert_eq!(
            select_preview_open_mode(
                Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                Some("docx")
            ),
            Some("system-default")
        );
        assert_eq!(
            select_preview_open_mode(Some("application/zip"), Some("zip")),
            None
        );
    }
}
