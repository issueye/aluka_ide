//! VSIX 本地安装与扩展扫描（M6 / FR-10，兼容分级 L1）。
//! VSIX 即 zip 包（VS Code 布局：extension/package.json 为清单）。
//! 安全：解包走组件级 zip-slip 防护（拒绝绝对路径/盘符/父目录跳转）；
//! 扩展文件读取同样限制在其目录内。

use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 全局扩展目录：~/.aluka-ide/extensions/
fn global_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法定位用户主目录: {e}"))?
        .join(".aluka-ide")
        .join("extensions");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建扩展目录失败: {e}"))?;
    Ok(dir)
}

/// 工作区级扩展目录（优先级更高）：<workspace>/.aluka/extensions/
fn workspace_extensions_dir(root: &str) -> PathBuf {
    Path::new(root).join(".aluka").join("extensions")
}

/// zip-slip 防护：把条目相对路径拼到根下，拒绝绝对路径/盘符前缀/父目录跳转。
fn safe_target(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let mut dest = root.to_path_buf();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(c) => dest.push(c),
            Component::CurDir => {}
            _ => return Err(format!("VSIX 条目路径非法（zip-slip 防护拦截）: {rel}")),
        }
    }
    Ok(dest)
}

/// 解包后的扩展信息（清单透传 JSON，前端按 L1 契约收窄）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    /// 扩展安装目录（绝对路径）
    pub dir: String,
    /// global | workspace
    pub origin: String,
    /// VS Code package.json 原样透传（L1：name/publisher/version/displayName/contributes/...）
    pub manifest: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub dir: String,
    pub manifest: serde_json::Value,
}

/// 从 VSIX 中读取清单：支持 extension/package.json（标准）与根 package.json 两种布局。
fn read_manifest_from_zip<R: std::io::Read + std::io::Seek>(
    reader: &mut R,
) -> Result<(serde_json::Value, String), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("打开 VSIX 失败: {e}"))?;
    let mut manifest_name: Option<String> = None;
    for i in 0..archive.len() {
        let f = archive
            .by_index(i)
            .map_err(|e| format!("读取条目失败: {e}"))?;
        let name = f.name().to_string();
        if name == "extension/package.json" {
            manifest_name = Some(name);
            break;
        }
        if name == "package.json" && manifest_name.is_none() {
            manifest_name = Some(name);
        }
    }
    let name = manifest_name.ok_or("VSIX 内未找到 package.json 清单")?;
    let mut f = archive
        .by_name(&name)
        .map_err(|e| format!("读取清单失败: {e}"))?;
    let mut text = String::new();
    f.read_to_string(&mut text)
        .map_err(|e| format!("读取清单失败: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("清单 JSON 无效: {e}"))?;
    Ok((manifest, name))
}

/// 从 Reader 中解包安装 VSIX 到全局扩展目录
fn unpack_and_install<R: std::io::Read + std::io::Seek>(
    app: &AppHandle,
    mut reader: R,
) -> Result<InstallResult, String> {
    let (manifest, manifest_entry) = read_manifest_from_zip(&mut reader)?;

    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("清单缺少 name 字段")?;
    let publisher = manifest
        .get("publisher")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("扩展名非法（仅允许小写字母/数字/连字符）: {name}"));
    }
    let dest_root = global_extensions_dir(app)?.join(format!("{publisher}.{name}"));

    // 覆盖安装：先移除旧目录（程序管理的扩展目录，非用户文档）
    if dest_root.exists() {
        std::fs::remove_dir_all(&dest_root).map_err(|e| format!("清理旧版本失败: {e}"))?;
    }
    std::fs::create_dir_all(&dest_root).map_err(|e| format!("创建扩展目录失败: {e}"))?;

    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("打开 VSIX 失败: {e}"))?;
    // 清单位于 extension/ 前缀下时，所有条目整体剥掉该前缀
    let strip_prefix = manifest_entry
        .split('/')
        .next()
        .map(|p| format!("{p}/"))
        .unwrap_or_default();

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("读取条目失败: {e}"))?;
        let raw = entry.name().to_string();
        let rel = raw
            .strip_prefix(&strip_prefix)
            .map(str::to_string)
            .unwrap_or(raw.clone());
        if rel.is_empty() || rel.ends_with('/') {
            continue; // 目录条目按需创建
        }
        let dest = safe_target(&dest_root, &rel)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut out = std::fs::File::create(&dest).map_err(|e| format!("写入失败: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("解包失败: {e}"))?;
    }

    Ok(InstallResult {
        dir: dest_root.to_string_lossy().into_owned(),
        manifest,
    })
}

/// 安装本地 VSIX 文件
#[tauri::command]
pub async fn install_vsix(app: AppHandle, vsix_path: String) -> Result<InstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&vsix_path);
        if !path.is_file() {
            return Err(format!("文件不存在: {vsix_path}"));
        }
        let file = std::fs::File::open(path).map_err(|e| format!("打开 VSIX 失败: {e}"))?;
        unpack_and_install(&app, file)
    })
    .await
    .map_err(|e| format!("安装任务失败: {e}"))?
}

/// 从二进制字节流安装 VSIX（用于开源插件市场在线下载安装）
#[tauri::command]
pub async fn install_vsix_bytes(app: AppHandle, bytes: Vec<u8>) -> Result<InstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cursor = std::io::Cursor::new(bytes);
        unpack_and_install(&app, cursor)
    })
    .await
    .map_err(|e| format!("安装任务失败: {e}"))?
}

/// 弹出系统文件对话框选择 .vsix；取消返回 None。
#[tauri::command]
pub async fn pick_vsix_dialog() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择 VSIX 扩展包")
            .add_filter("VSIX 扩展包", &["vsix"])
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("对话框任务失败: {e}"))
}

/// 扫描已安装扩展：全局目录 + 工作区 .aluka/extensions/（后者 origin=workspace）。
/// 清单解析失败的目录跳过（不中断整体扫描）。
#[tauri::command]
pub async fn list_extensions(
    app: AppHandle,
    workspace_root: Option<String>,
) -> Result<Vec<InstalledExtension>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Vec::new();
        let global = global_extensions_dir(&app)?;
        result.extend(scan_dir(&global, "global"));
        if let Some(root) = workspace_root {
            let ws = workspace_extensions_dir(&root);
            if ws.is_dir() {
                result.extend(scan_dir(&ws, "workspace"));
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("扫描任务失败: {e}"))?
}

fn scan_dir(dir: &Path, origin: &str) -> Vec<InstalledExtension> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let manifest_path = p.join("package.json");
        let Ok(text) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        out.push(InstalledExtension {
            dir: p.to_string_lossy().into_owned(),
            origin: origin.to_string(),
            manifest,
        });
    }
    out
}

/// 读取扩展目录内文件（主题 JSON / 片段 / main.js 等）。
/// 路径逃逸防护与 zip-slip 同规则。
#[tauri::command]
pub fn read_extension_file(dir: String, rel: String) -> Result<String, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err(format!("扩展目录不存在: {dir}"));
    }
    let dest = safe_target(root, &rel)?;
    if !dest.is_file() {
        return Err(format!("扩展文件不存在: {rel}"));
    }
    std::fs::read_to_string(&dest).map_err(|e| format!("读取扩展文件失败: {e}"))
}

/// 卸载扩展（仅限全局目录；工作区扩展由用户自行管理文件）。
#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, dir: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let global = global_extensions_dir(&app)?;
        let target = Path::new(&dir);
        // 只允许删除全局扩展目录内的路径
        let canonical = target
            .canonicalize()
            .map_err(|e| format!("路径无效: {e}"))?;
        let global_canonical = global.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(&global_canonical) || canonical == global_canonical {
            return Err("仅允许卸载全局扩展目录内的扩展".into());
        }
        std::fs::remove_dir_all(&canonical).map_err(|e| format!("卸载失败: {e}"))
    })
    .await
    .map_err(|e| format!("卸载任务失败: {e}"))?
}
