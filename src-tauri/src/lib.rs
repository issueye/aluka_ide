//! Aluka IDE Rust 后端。
//! 模块划分：文件系统（目录树/CRUD）、系统对话框、工作区文件监听、
//! search.rs（M5 全局搜索）、terminal.rs（M5 终端会话）。
//! 后续模块：vsix.rs（M6 扩展安装）。

pub mod git;
pub mod search;
pub mod terminal;
pub mod vsix;

/// 子模块命令在 generate_handler 中需以裸名引用（宏可见性）
use git::{
    git_checkout, git_commit, git_create_branch, git_discard, git_get_file_content, git_init,
    git_list_branches, git_pull, git_push, git_stage, git_status, git_unstage,
};
use search::search_workspace;
use terminal::{create_terminal, kill_terminal, reap_terminal, resize_terminal, write_terminal};
use vsix::{
    install_vsix, list_extensions, pick_vsix_dialog, read_extension_file, uninstall_extension,
};

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 资源管理器树节点（单层懒加载）。字段名对齐前端 camelCase 约定。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 资源管理器默认隐藏的重目录 / 构建产物（vscode 默认也排除这些）。
/// 搜索（search.rs）与快速打开共用同一排除规则。
pub(crate) const EXCLUDED_DIRS: [&str; 4] = [".git", "node_modules", "target", "dist"];

/// 读取保护阈值：超过 20MB 拒绝打开，5~20MB 只读（REQUIREMENTS R5/NFR-01）
const READ_MAX_BYTES: u64 = 20 * 1024 * 1024;
const READONLY_BYTES: u64 = 5 * 1024 * 1024;

/// 文本文件读取结果。字段名对齐前端 camelCase 约定。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub content: String,
    pub is_binary: bool,
    pub size: u64,
    pub readonly: bool,
}

/// 读取文本文件：NUL 字节探测二进制（前 8KB），超限拒绝。
#[tauri::command]
fn read_file(path: String) -> Result<TextFile, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("路径不是文件: {path}"));
    }
    let size = std::fs::metadata(p)
        .map_err(|e| format!("读取元数据失败: {e}"))?
        .len();
    if size > READ_MAX_BYTES {
        return Err(format!("文件超过 20MB，拒绝打开（{size} 字节）"));
    }
    let bytes = std::fs::read(p).map_err(|e| format!("读取文件失败: {e}"))?;
    let probe_len = bytes.len().min(8192);
    let is_binary = bytes[..probe_len].contains(&0u8);
    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(TextFile {
        content,
        is_binary,
        size,
        readonly: size > READONLY_BYTES,
    })
}

/// 保存文本文件（仅允许覆盖已存在文件；"另存为"属后续里程碑）。
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("文件不存在，无法保存: {path}"));
    }
    std::fs::write(p, content).map_err(|e| format!("写入失败: {e}"))
}

/// 工作区文件监听状态：持有当前 watcher，Drop 旧 watcher 即可停止旧监听
#[derive(Default)]
pub struct WorkspaceState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// 打开系统文件夹选择对话框；取消返回 None。
/// rfd 对话框不能阻塞主线程，放入 blocking 线程池执行。
#[tauri::command]
async fn open_folder_dialog() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择工作区文件夹")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("对话框任务失败: {e}"))
}

/// 读取目录的单层子项：目录优先、名称不区分大小写排序，跳过排除目录。
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FileNode>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("路径不是目录: {path}"));
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut nodes = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let is_dir = p.is_dir();
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_dir && EXCLUDED_DIRS.contains(&name.as_str()) {
            continue;
        }
        nodes.push(FileNode {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir,
        });
    }
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

/// 新建文件（空文件）或文件夹；父目录不存在时自动补建。
#[tauri::command]
fn create_entry(path: String, is_dir: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("已存在同名文件或文件夹: {path}"));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    }
    let result = if is_dir {
        std::fs::create_dir(p)
    } else {
        std::fs::write(p, "")
    };
    result.map_err(|e| format!("创建失败: {e}"))
}

/// 重命名 / 移动；目标已存在时拒绝（不做覆盖）。
#[tauri::command]
fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    let from = Path::new(&old_path);
    if !from.exists() {
        return Err(format!("路径不存在: {old_path}"));
    }
    let to = Path::new(&new_path);
    if to.exists() {
        return Err(format!("目标已存在: {new_path}"));
    }
    std::fs::rename(from, to).map_err(|e| format!("重命名失败: {e}"))
}

/// 删除：移入系统回收站而非直接删除，保证可恢复（AGENTS.md 质量红线 4）。
#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    trash::delete(p).map_err(|e| format!("移入回收站失败: {e}"))
}

/// 监听工作区文件变更：每次调用会停掉旧监听并新建；
/// 事件由汇总线程聚合（300ms 空闲 + 150ms 吸收窗口）后 emit `workspace:changed`（路径列表）。
#[tauri::command]
fn watch_workspace(
    app: AppHandle,
    state: tauri::State<'_, WorkspaceState>,
    root: String,
) -> Result<(), String> {
    let dir = Path::new(&root);
    if !dir.is_dir() {
        return Err(format!("路径不是目录: {root}"));
    }
    // 丢弃旧监听（Drop 关闭事件通道，旧汇总线程随之退出）
    *state.watcher.lock().map_err(|e| e.to_string())? = None;

    let (tx, rx) = mpsc::channel();
    let mut watcher =
        notify::recommended_watcher(tx).map_err(|e| format!("创建文件监听失败: {e}"))?;
    watcher
        .watch(dir, RecursiveMode::Recursive)
        .map_err(|e| format!("启动文件监听失败: {e}"))?;
    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);

    std::thread::spawn(move || loop {
        match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(Ok(event)) => {
                let mut paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                // 继续吸收 150ms 内的后续事件，合并为一次刷新
                while let Ok(next) = rx.recv_timeout(Duration::from_millis(150)) {
                    if let Ok(ev) = next {
                        paths.extend(ev.paths.iter().map(|p| p.to_string_lossy().into_owned()));
                    }
                }
                paths.sort();
                paths.dedup();
                let _ = app.emit("workspace:changed", paths);
            }
            Ok(Err(_)) => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    });
    Ok(())
}

/// 保存一组文件（Ctrl+S 全量保存：脏标签一次性落盘）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveItem {
    pub path: String,
    pub content: String,
}

#[tauri::command]
fn save_all(items: Vec<SaveItem>) -> Result<(), String> {
    for it in &items {
        write_file(it.path.clone(), it.content.clone())?;
    }
    Ok(())
}

/// 用户设置结构体（FR-12）。字段 camelCase 对齐前端；未知字段忽略以向前兼容。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub font_size: u32,
    pub auto_save: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark-plus".to_string(),
            font_size: 14,
            auto_save: "off".to_string(),
        }
    }
}

/// ~/.aluka-ide/settings.json 路径（FR-12）
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法定位用户主目录: {e}"))?
        .join(".aluka-ide");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// 读取设置；文件不存在返回 None（前端回退 localStorage/默认）。
#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Option<Settings>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取设置失败: {e}"))?;
    let parsed =
        serde_json::from_str::<Settings>(&text).map_err(|e| format!("设置 JSON 无效: {e}"))?;
    Ok(Some(parsed))
}

/// 写入设置（格式化 JSON，便于人工编辑）。
#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写入设置失败: {e}"))
}

/// 列出工作区内所有文件（快速打开 Ctrl+P 用）。
/// 跳过重目录与隐藏目录（. 前缀），限制最大条目防卡死。
#[tauri::command]
fn list_workspace_files(root: String) -> Result<Vec<String>, String> {
    if !Path::new(&root).is_dir() {
        return Err(format!("路径不是目录: {root}"));
    }
    const MAX_FILES: usize = 20_000;
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // 跳过重目录、隐藏目录（. 前缀，工作区根除外）与常见构建产物
            !(e.file_type().is_dir()
                && (EXCLUDED_DIRS.contains(&name.as_ref())
                    || (name.starts_with('.') && e.depth() > 0)))
        })
        .flatten()
    {
        if entry.file_type().is_file() {
            files.push(entry.path().to_string_lossy().into_owned());
            if files.len() >= MAX_FILES {
                break;
            }
        }
    }
    Ok(files)
}

/// 当前 git 分支名（FR-11 状态栏）：shell out `git branch --show-current`。
/// 非 git 仓库 / git 不可用时返回 None（状态栏隐藏分支段）。
#[tauri::command]
async fn get_git_branch(root: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("执行 git 失败: {e}"))?;
        if !output.status.success() {
            return Ok(None); // 非 git 仓库等场景，静默隐藏
        }
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if name.is_empty() { None } else { Some(name) })
    })
    .await
    .map_err(|e| format!("git 分支任务失败: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkspaceState::default())
        .manage(terminal::TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            read_dir,
            create_entry,
            rename_entry,
            delete_entry,
            watch_workspace,
            read_file,
            write_file,
            save_all,
            get_settings,
            set_settings,
            list_workspace_files,
            search_workspace,
            create_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            reap_terminal,
            get_git_branch,
            git_status,
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_get_file_content,
            git_list_branches,
            git_checkout,
            git_create_branch,
            git_push,
            git_pull,
            git_init,
            install_vsix,
            list_extensions,
            pick_vsix_dialog,
            read_extension_file,
            uninstall_extension
        ])
        .run(tauri::generate_context!())
        .expect("Aluka IDE 启动失败");
}
