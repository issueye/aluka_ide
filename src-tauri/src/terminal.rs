//! 终端会话（M5 / FR-06）：cmd 管道 + 读线程 emit。
//! 取舍（对齐 DEVELOPMENT_PLAN M5"cmd 管道 + 读线程 emit"）：
//! 管道模式无 ConPTY，无屏幕控制序列/光标编辑；交互以"输入行 + 回显"提供，
//! 满足 dir/git status 等常规命令实时回显的验收；真 ConPTY 留后续打磨。
//! 编码：以 `cmd /K chcp 65001` 启动，会话输出整体为 UTF-8，无需额外转码依赖。

use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command, Stdio};
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
    child: Child,
    /// 保留句柄用于写入（Drop 时随会话关闭）
    stdin: std::process::ChildStdin,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: Mutex<u32>,
}

/// 创建终端会话：在 root 下启动 cmd（未打开工作区时用用户主目录）。
/// 返回会话 id；输出经读线程以 `terminal:output` emit，EOF 时 emit `terminal:closed`。
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    root: String,
) -> Result<u32, String> {
    let id = {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        *next += 1;
        *next
    };
    let mut command = Command::new("cmd");
    command
        .args(["/K", "chcp 65001 >nul"])
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW：避免每次开终端闪控制台窗（Windows 专属，其它平台保持可移植）
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("启动 cmd 失败: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 cmd 标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 cmd 错误输出".to_string())?;

    // stdout/stderr 各一个读线程，合并为同一事件流
    spawn_reader(app.clone(), id, stdout);
    spawn_reader(app, id, stderr);

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法获取 cmd 标准输入".to_string())?;
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, Session { child, stdin });
    Ok(id)
}

/// 读线程：持续读子进程输出流并 emit `terminal:output`；EOF 时 emit `terminal:closed`。
fn spawn_reader(app: AppHandle, id: u32, mut stream: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf) {
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

/// 向会话写入输入（前端发送整行，含行尾 \r\n；read 线程异步回显输出）
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
        .stdin
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入终端失败: {e}"))?;
    session
        .stdin
        .flush()
        .map_err(|e| format!("刷新终端失败: {e}"))
}

/// 关闭会话：kill 子进程；读线程 EOF 后自行 emit terminal:closed。
#[tauri::command]
pub fn kill_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

/// 会话退出（读线程 EOF）后清理残留表项
#[tauri::command]
pub fn reap_terminal(state: tauri::State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
