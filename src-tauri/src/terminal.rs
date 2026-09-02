//! 终端会话（ConPTY 升级）：基于 portable-pty 实现的 Windows 原生伪控制台会话。
//! 支持完整 ANSI 转义序列、TUI 交互（vim/htop/REPL 等）、光标控制以及动态 Resize。

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
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

/// 创建 ConPTY 伪控制台终端会话。
/// 初始行列可选（默认为 80x24）。
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    root: String,
    cols: Option<u16>,
    rows: Option<u16>,
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

    // 在 Windows 下默认使用 powershell.exe，非 Windows 使用用户默认 shell
    #[cfg(windows)]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        CommandBuilder::new(shell)
    };

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

/// 关闭终端会话
#[tauri::command]
pub fn kill_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

/// 会话退出后清理残留表项
#[tauri::command]
pub fn reap_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
