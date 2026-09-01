//! Audio export source discovery for installed Android applications.

use serde::Serialize;

use super::adb_command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackageFileKind {
    Base,
    Split,
    AssetPack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackageFile {
    pub device_path: String,
    pub file_name: String,
    pub kind: PackageFileKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackageSource {
    pub package: String,
    pub files: Vec<InstalledPackageFile>,
}

/// Discover every APK path installed for a package, including configuration
/// splits and install-time asset packs exposed by Android's package manager.
pub fn discover_installed_package_source(
    device: Option<&str>,
    package: &str,
) -> Result<InstalledPackageSource, String> {
    validate_package_name(package)?;

    let mut command = adb_command();
    if let Some(serial) = device.filter(|value| !value.is_empty()) {
        command.arg("-s").arg(serial);
    }
    let output = command
        .args(["shell", "pm", "path", package])
        .output()
        .map_err(|error| format!("无法执行 adb：{error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let detail = if stderr.is_empty() {
            stdout.trim().to_string()
        } else {
            stderr
        };
        return Err(if detail.is_empty() {
            format!("无法获取应用 {package} 的安装路径")
        } else {
            format!("无法获取应用 {package} 的安装路径：{detail}")
        });
    }

    let files = parse_pm_path_output(&stdout)?;
    log::info!(
        "应用安装路径发现完成：device={:?} package={} files={}",
        device,
        package,
        files.len()
    );
    Ok(InstalledPackageSource {
        package: package.to_string(),
        files,
    })
}

fn validate_package_name(package: &str) -> Result<(), String> {
    let valid = !package.is_empty()
        && package.len() <= 255
        && package.contains('.')
        && package.split('.').all(|segment| {
            let mut characters = segment.chars();
            matches!(characters.next(), Some(first) if first.is_ascii_alphabetic())
                && characters.all(|character| {
                    character.is_ascii_alphanumeric() || character == '_'
                })
        });
    if valid {
        Ok(())
    } else {
        Err("应用包名格式无效".to_string())
    }
}

fn parse_pm_path_output(output: &str) -> Result<Vec<InstalledPackageFile>, String> {
    let mut files = Vec::new();
    for line in output.lines().map(str::trim) {
        let Some(device_path) = line.strip_prefix("package:").map(str::trim) else {
            continue;
        };
        if device_path.is_empty() || !device_path.starts_with('/') {
            continue;
        }
        let Some(file_name) = device_path.rsplit('/').next() else {
            continue;
        };
        if file_name.is_empty() || !file_name.to_ascii_lowercase().ends_with(".apk") {
            continue;
        }
        if files
            .iter()
            .any(|file: &InstalledPackageFile| file.device_path == device_path)
        {
            continue;
        }

        let normalized_name = file_name.to_ascii_lowercase();
        let kind = if normalized_name == "base.apk" {
            PackageFileKind::Base
        } else if normalized_name.contains("assetpack")
            || normalized_name.contains("asset_pack")
        {
            PackageFileKind::AssetPack
        } else {
            PackageFileKind::Split
        };
        files.push(InstalledPackageFile {
            device_path: device_path.to_string(),
            file_name: file_name.to_string(),
            kind,
        });
    }

    if files.is_empty() {
        return Err("应用未安装，或 adb 未返回任何 APK 路径".to_string());
    }
    if !files.iter().any(|file| file.kind == PackageFileKind::Base) {
        return Err("安装路径不完整：缺少 base.apk".to_string());
    }

    files.sort_by(|left, right| {
        package_file_rank(&left.kind)
            .cmp(&package_file_rank(&right.kind))
            .then_with(|| left.file_name.to_lowercase().cmp(&right.file_name.to_lowercase()))
            .then_with(|| left.device_path.cmp(&right.device_path))
    });
    Ok(files)
}

fn package_file_rank(kind: &PackageFileKind) -> u8 {
    match kind {
        PackageFileKind::Base => 0,
        PackageFileKind::AssetPack => 1,
        PackageFileKind::Split => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_splits_and_asset_packs_in_stable_order() {
        let output = concat!(
            "package:/data/app/pkg/split_config.arm64_v8a.apk\r\n",
            "package:/data/app/pkg/split_yoo_assetpack.apk\r\n",
            "package:/data/app/pkg/base.apk\r\n",
        );

        let files = parse_pm_path_output(output).unwrap();

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].kind, PackageFileKind::Base);
        assert_eq!(files[1].kind, PackageFileKind::AssetPack);
        assert_eq!(files[2].kind, PackageFileKind::Split);
        assert_eq!(files[1].file_name, "split_yoo_assetpack.apk");
    }

    #[test]
    fn ignores_noise_invalid_entries_and_duplicate_paths() {
        let output = concat!(
            "daemon started successfully\n",
            "package:/data/app/pkg/base.apk\n",
            "package:/data/app/pkg/base.apk\n",
            "package:relative/split_bad.apk\n",
            "package:/data/app/pkg/not-an-apk.txt\n",
        );

        let files = parse_pm_path_output(output).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].device_path, "/data/app/pkg/base.apk");
    }

    #[test]
    fn rejects_empty_or_incomplete_path_results() {
        assert_eq!(
            parse_pm_path_output("").unwrap_err(),
            "应用未安装，或 adb 未返回任何 APK 路径"
        );
        assert_eq!(
            parse_pm_path_output("package:/data/app/pkg/split_config.en.apk\n").unwrap_err(),
            "安装路径不完整：缺少 base.apk"
        );
    }

    #[test]
    fn validates_android_application_ids() {
        for package in ["com.example.game", "com.example_2.game3"] {
            assert!(validate_package_name(package).is_ok(), "{package}");
        }
        for package in [
            "",
            "game",
            ".com.example",
            "com..example",
            "2com.example",
            "com.example-game",
            "com.example;id",
        ] {
            assert!(validate_package_name(package).is_err(), "{package}");
        }
    }
}
