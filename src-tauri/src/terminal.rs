//! 终端会话（ConPTY 升级）：基于 portable-pty 实现的 Windows 原生伪控制台会话。
//! 支持完整 ANSI 转义序列、TUI 交互（vim/htop/REPL 等）、光标控制以及动态 Resize。
//! 支持多 Shell：PowerShell / CMD / Git Bash / PowerShell 7 / WSL，创建时按 id 解析。

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
#[cfg(not(windows))]
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 终端输出/关闭事件（AGENTS.md 事件名约定：terminal:output / terminal:closed）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub id: u32,
    pub data: String,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: Mutex<u32>,
}

/// Shell 候选信息（list_terminal_shells 返回给前端选择下拉）
#[derive(Serialize, Clone)]
pub struct ShellInfo {
    /// Shell 标识（创建终端时回传）
    pub id: String,
    /// 展示名（标签命名用）
    pub name: String,
    /// 可执行文件绝对路径（PowerShell/CMD 等系统内建为 null）
    pub path: Option<String>,
}

/// 在 PATH 中按名称查找可执行文件（Windows 自动补 .exe 扩展名）
fn find_in_path(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let file = if name.to_ascii_lowercase().ends_with(".exe") {
        name.to_string()
    } else {
        format!("{name}.exe")
    };
    #[cfg(not(windows))]
    let file = name.to_string();
    let paths = std::env::var("PATH").ok()?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
}

/// 读取 Windows 注册表值（经 reg.exe 子进程，避免引入 winreg 依赖）
#[cfg(windows)]
fn reg_query_value(key: &str, value: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("reg.exe")
        .args(["query", key, "/v", value])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // 行格式："    InstallPath    REG_SZ    C:\Program Files\Git"
    let line = text.lines().find(|l| l.contains("REG_SZ"))?;
    let pos = line.find("REG_SZ")? + "REG_SZ".len();
    let val = line[pos..].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

/// 探测 Git Bash 安装路径：注册表 → PATH 中 git.exe 逐级上溯 → 常见安装路径
#[cfg(windows)]
fn detect_git_bash() -> Option<PathBuf> {
    // 1) Git for Windows 安装时写入的注册表项（HKLM / HKCU）
    for key in [
        "HKLM\\SOFTWARE\\GitForWindows",
        "HKCU\\SOFTWARE\\GitForWindows",
    ] {
        if let Some(install) = reg_query_value(key, "InstallPath") {
            let bash = PathBuf::from(&install).join("bin").join("bash.exe");
            if bash.is_file() {
                return Some(bash);
            }
        }
    }
    // 2) PATH 里的 git.exe（含 scoop 等绿色安装）：逐级向上找 <根>\bin\bash.exe
    if let Some(git) = find_in_path("git.exe") {
        for ancestor in git.ancestors().skip(1) {
            let bash = ancestor.join("bin").join("bash.exe");
            if bash.is_file() {
                return Some(bash);
            }
        }
    }
    // 3) 常见安装路径兜底
    let mut candidates = vec![
        PathBuf::from("C:\\Program Files\\Git\\bin\\bash.exe"),
        PathBuf::from("C:\\Program Files (x86)\\Git\\bin\\bash.exe"),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs\\Git\\bin\\bash.exe"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// 探测 WSL 是否装有发行版（wsl.exe -l -q 输出非空列表才算可用）
#[cfg(windows)]
fn detect_wsl() -> bool {
    use std::os::windows::process::CommandExt;
    let Some(exe) = find_in_path("wsl.exe") else {
        return false;
    };
    let Ok(output) = std::process::Command::new(exe)
        .args(["-l", "-q"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    // wsl.exe 输出为 UTF-16LE：剔除 \0 后存在非空白内容即视为装有发行版
    String::from_utf8_lossy(&output.stdout)
        .chars()
        .filter(|c| *c != '\0')
        .any(|c| !c.is_whitespace())
}

#[cfg(windows)]
fn list_shells_impl() -> Vec<ShellInfo> {
    let mut shells = vec![
        ShellInfo {
            id: "powershell".to_string(),
            name: "PowerShell".to_string(),
            path: None,
        },
        ShellInfo {
            id: "cmd".to_string(),
            name: "CMD".to_string(),
            path: None,
        },
    ];
    if let Some(bash) = detect_git_bash() {
        shells.push(ShellInfo {
            id: "gitbash".to_string(),
            name: "Git Bash".to_string(),
            path: Some(bash.to_string_lossy().into_owned()),
        });
    }
    if let Some(pwsh) = find_in_path("pwsh.exe") {
        shells.push(ShellInfo {
            id: "pwsh".to_string(),
            name: "PowerShell 7".to_string(),
            path: Some(pwsh.to_string_lossy().into_owned()),
        });
    }
    if detect_wsl() {
        shells.push(ShellInfo {
            id: "wsl".to_string(),
            name: "WSL".to_string(),
            path: None,
        });
    }
    shells
}

#[cfg(not(windows))]
fn list_shells_impl() -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    for (id, name) in [
        ("bash", "Bash"),
        ("zsh", "Zsh"),
        ("fish", "Fish"),
        ("sh", "sh"),
    ] {
        if let Some(path) = find_in_path(id) {
            shells.push(ShellInfo {
                id: id.to_string(),
                name: name.to_string(),
                path: Some(path.to_string_lossy().into_owned()),
            });
        }
    }
    if shells.is_empty() {
        shells.push(ShellInfo {
            id: "sh".to_string(),
            name: "sh".to_string(),
            path: None,
        });
    }
    shells
}

/// 列出本机可用的 Shell（供前端选择下拉；探测含子进程调用，放阻塞线程池执行）
#[tauri::command]
pub async fn list_terminal_shells() -> Result<Vec<ShellInfo>, String> {
    let shells = tauri::async_runtime::spawn_blocking(list_shells_impl)
        .await
        .map_err(|e| format!("Shell 探测任务失败: {e}"))?;
    Ok(shells)
}

/// Windows：按 Shell id 构造子进程命令；目标不可用时回退默认 PowerShell
#[cfg(windows)]
fn build_shell_command(shell: Option<&str>) -> CommandBuilder {
    match shell {
        Some("cmd") => CommandBuilder::new("cmd.exe"),
        Some("wsl") => CommandBuilder::new("wsl.exe"),
        Some("pwsh") => match find_in_path("pwsh.exe") {
            Some(p) => {
                let mut c = CommandBuilder::new(p);
                c.arg("-NoLogo");
                c
            }
            None => default_powershell(),
        },
        Some("gitbash") => match detect_git_bash() {
            Some(p) => {
                let mut c = CommandBuilder::new(p);
                c.arg("--login");
                c.arg("-i");
                c
            }
            None => default_powershell(),
        },
        // powershell 与未知 id 均走默认
        _ => default_powershell(),
    }
}

/// Windows 默认 Shell：powershell.exe -NoLogo
#[cfg(windows)]
fn default_powershell() -> CommandBuilder {
    let mut c = CommandBuilder::new("powershell.exe");
    c.arg("-NoLogo");
    c
}

/// 非 Windows：按 id 在 PATH 中解析；解析不到回退用户默认 shell
#[cfg(not(windows))]
fn build_shell_command(shell: Option<&str>) -> CommandBuilder {
    let default = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let program = shell
        .filter(|id| ["bash", "zsh", "fish", "sh"].contains(id))
        .and_then(find_in_path)
        .map_or(default, |p| p.to_string_lossy().into_owned());
    CommandBuilder::new(program)
}

/// 创建 ConPTY 伪控制台终端会话。
/// 初始行列可选（默认为 80x24）；shell 可选（id 由 list_terminal_shells 返回，缺省为系统默认）。
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    root: String,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<u32, String> {
    let id = {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        *next += 1;
        *next
    };

    let pty_system = native_pty_system();
    let pty_size = PtySize {
        rows: rows.unwrap_or(24).max(1),
        cols: cols.unwrap_or(80).max(1),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("创建 PTY 失败: {e}"))?;

    let mut cmd = build_shell_command(shell.as_deref());

    if !root.is_empty() {
        cmd.cwd(&root);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动终端进程失败: {e}"))?;

    // 释放 slave 句柄，保持只有 child 持有 slave 端
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("获取 PTY 读取器失败: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("获取 PTY 写入器失败: {e}"))?;

    // 启动独立读线程
    spawn_pty_reader(app, id, reader);

    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    Ok(id)
}

/// 读线程：持续读取 PTY 输出并发送给前端
fn spawn_pty_reader(app: AppHandle, id: u32, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit("terminal:output", TerminalEvent { id, data });
                }
            }
        }
        let _ = app.emit(
            "terminal:closed",
            TerminalEvent {
                id,
                data: String::new(),
            },
        );
    });
}

/// 向终端写入原始按键数据与控制序列
#[tauri::command]
pub fn write_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("终端会话不存在: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入终端失败: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("刷新终端失败: {e}"))
}

/// 调整终端窗口行列尺寸
#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("终端会话不存在: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整终端尺寸失败: {e}"))
}

/// 递归杀死整个进程树（Windows 用 taskkill /T，Unix 用 kill 负 PID 发至进程组）。
fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
    }
    #[cfg(not(windows))]
    {
        // 负 PID 发信号至进程组（portable-pty 创建子进程时默认设 setpgid）
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .output();
        // 等 500ms 让子进程有机会优雅退出，仍未退出的强制 SIGKILL
        std::thread::sleep(Duration::from_millis(500));
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .output();
    }
}

/// 关闭终端会话（同时杀死进程树中的所有子进程）。
#[tauri::command]
pub fn kill_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        // process_id 为 Option：None（已退出）时无进程树可杀
        if let Some(pid) = session.child.process_id() {
            // 先杀死整个进程树（含子进程），再清理僵尸
            kill_process_tree(pid);
        }
        let _ = session.child.wait();
    }
    Ok(())
}

/// 会话退出后清理残留表项（同时杀死进程树中的残留子进程）。
#[tauri::command]
pub fn reap_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        if let Some(pid) = session.child.process_id() {
            kill_process_tree(pid);
        }
        let _ = session.child.wait();
    }
    Ok(())
}
