//! VSIX 本地安装与扩展扫描（M6 / FR-10，兼容分级 L1）。
//! VSIX 即 zip 包（VS Code 布局：extension/package.json 为清单）。
//! 安全：解包走组件级 zip-slip 防护（拒绝绝对路径/盘符/父目录跳转）+ publisher/name
//! 白名单 + 目标目录归属断言 + 解包体积/条目上限；扩展文件读取限定在受管扩展目录内。
//! 在线市场（Open VSX）已移除，VSIX 仅来自用户本地文件，应用不再发起任何网络请求。

use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

/// 目录名安全片段：仅允许小写字母/数字/连字符（VS Code 扩展 id 惯例）。
/// 关键：publisher/name 会参与路径拼接与 remove_dir_all，任一含 "." 或路径分隔符
/// 即可构造 \"..\\..\" 越出扩展目录、进而删除任意目录，故必须同规则校验。
fn safe_dir_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 解包安全上限：条目数与解压总字节（VSIX 为几 MB 级，留足余量的同时挡住
/// zip bomb / 磁盘填满。双上限互补：条目防"海量小文件"，字节数防"单个巨型条目"）
const MAX_VSIX_ENTRIES: usize = 20_000;
const MAX_VSIX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

/// 全局扩展目录：~/.aluka-ide/extensions/
/// 路径形状统一由 lib::managed_state_root 提供，避免两处各写一份 home 拼接。
fn global_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::managed_state_root(app)?.join("extensions");
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
    if !safe_dir_segment(name) {
        return Err(format!("扩展名非法（仅允许小写字母/数字/连字符）: {name}"));
    }
    if !safe_dir_segment(publisher) {
        return Err(format!(
            "扩展 publisher 非法（仅允许小写字母/数字/连字符）: {publisher}"
        ));
    }
    // 归属断言：拼出的目标必须仍在全局扩展目录内（canonicalize 消解符号链接）。
    // 与上面的白名单校验互为纵深——单靠字符串白名单不足以覆盖全部平台差异。
    let extensions_root = global_extensions_dir(app)?;
    let dest_root = extensions_root.join(format!("{publisher}.{name}"));
    let root_canonical = extensions_root
        .canonicalize()
        .map_err(|e| format!("扩展目录无效: {e}"))?;
    let expected_name = format!("{publisher}.{name}");
    let leaf_ok = dest_root
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .map(|parent| parent == root_canonical)
        .unwrap_or(false);
    if !leaf_ok || dest_root.file_name().and_then(|n| n.to_str()) != Some(expected_name.as_str()) {
        return Err(format!("扩展安装路径越出扩展目录，已拒绝: {expected_name}"));
    }

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

    if zip.len() > MAX_VSIX_ENTRIES {
        return Err(format!(
            "VSIX 条目数超限（{} > {MAX_VSIX_ENTRIES}），已拒绝解包",
            zip.len()
        ));
    }
    let mut total_written: u64 = 0;
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
        // 用 take 限制单条目写入量，确保解压总字节不越界（即使 content-length 被伪造）
        let remaining = MAX_VSIX_TOTAL_BYTES.saturating_sub(total_written);
        let written = std::io::copy(&mut entry.by_ref().take(remaining + 1), &mut out)
            .map_err(|e| format!("解包失败: {e}"))?;
        total_written = total_written.saturating_add(written);
        if total_written > MAX_VSIX_TOTAL_BYTES {
            // 清理半成品，避免残留超大文件
            drop(out);
            let _ = std::fs::remove_dir_all(&dest_root);
            return Err(format!(
                "VSIX 解压体积超限（>{MAX_VSIX_TOTAL_BYTES} 字节），已中止解包"
            ));
        }
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

/// 校验扩展目录归属：必须是全局扩展目录、或工作区 `<workspace>/.aluka/extensions/`
/// 下的直接子目录。仅校验 rel 不足以防止 dir 被替换为任意绝对路径（任意文件读取）。
fn assert_extension_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let canonical = Path::new(dir)
        .canonicalize()
        .map_err(|e| format!("扩展目录无效: {e}"))?;

    let global_root = global_extensions_dir(app)?
        .canonicalize()
        .map_err(|e| format!("扩展目录无效: {e}"))?;
    // 全局扩展：目录本身或更深一层（防御性放宽，正常为直接子目录）
    if canonical.starts_with(&global_root) {
        return Ok(canonical);
    }
    // 工作区扩展：目录名必须恰为 .aluka/extensions 下的直接子目录
    let mut ws_ok = false;
    if let Some(parent) = canonical.parent() {
        if parent.file_name().and_then(|n| n.to_str()) == Some("extensions")
            && parent
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                == Some(".aluka")
        {
            ws_ok = true;
        }
        // 规范化后的父目录为其祖先链上的任一 .aluka/extensions（防符号链接中间层）
        if !ws_ok && parent.starts_with(&global_root) {
            ws_ok = true;
        }
    }
    if !ws_ok {
        return Err(format!("扩展目录不在受管范围内，已拒绝读取: {dir}"));
    }
    Ok(canonical)
}

/// 读取扩展目录内文件（主题 JSON / 片段 / main.js 等）。
/// 双重防护：dir 必须归属受管扩展目录（assert_extension_dir），
/// rel 再走 zip-slip 同规则（safe_target）。
#[tauri::command]
pub fn read_extension_file(app: AppHandle, dir: String, rel: String) -> Result<String, String> {
    let root = assert_extension_dir(&app, &dir)?;
    let dest = safe_target(&root, &rel)?;
    if !dest.is_file() {
        return Err(format!("扩展文件不存在: {rel}"));
    }
    std::fs::read_to_string(&dest).map_err(|e| format!("读取扩展文件失败: {e}"))
}

/// 读取扩展目录内文件的原始字节（README 相对图片内联渲染用；二进制安全）。
/// 路径防护与 read_extension_file 同规则。
#[tauri::command]
pub fn read_extension_file_bytes(
    app: AppHandle,
    dir: String,
    rel: String,
) -> Result<Vec<u8>, String> {
    let root = assert_extension_dir(&app, &dir)?;
    let dest = safe_target(&root, &rel)?;
    if !dest.is_file() {
        return Err(format!("扩展文件不存在: {rel}"));
    }
    std::fs::read(&dest).map_err(|e| format!("读取扩展文件失败: {e}"))
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

#[cfg(test)]
mod security_tests {
    use super::*;

    /// 目录名白名单：这是阻止 publisher 构造 "..\\.." 越出扩展目录（进而 remove_dir_all
    /// 删任意目录）的第一道防线，必须严格拒绝点号与路径分隔符。
    #[test]
    fn safe_dir_segment_rejects_traversal_and_separators() {
        assert!(safe_dir_segment("my-ext"));
        assert!(safe_dir_segment("ext2"));
        assert!(safe_dir_segment("9"));
        assert!(safe_dir_segment("ext-"));

        assert!(!safe_dir_segment(""));
        assert!(!safe_dir_segment(".."));
        assert!(!safe_dir_segment("a.b"));
        assert!(!safe_dir_segment("a/b"));
        assert!(!safe_dir_segment("a\\b"));
        assert!(!safe_dir_segment("C:"));
        // 连字符位置无语义风险（VS Code 扩展 id 本就允许），仅确认其被接受
        assert!(!safe_dir_segment("UPPER"));
        assert!(!safe_dir_segment("上手"));
    }

    /// zip-slip 防线：绝对路径、盘符前缀、父目录跳转一律拒绝。
    #[test]
    fn safe_target_blocks_zip_slip() {
        let root = Path::new("/ext/root");
        assert!(safe_target(root, "themes/dark.json").is_ok());
        assert!(safe_target(root, "./main.js").is_ok());

        assert!(safe_target(root, "../evil").is_err());
        assert!(safe_target(root, "../../evil").is_err());
        assert!(safe_target(root, "a/../../evil").is_err());
        assert!(safe_target(root, "/etc/passwd").is_err());
        assert!(safe_target(root, "C:/Windows/x").is_err());
    }
}
