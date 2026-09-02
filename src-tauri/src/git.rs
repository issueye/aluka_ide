//! Git 源码管理模块（SCM）：基于系统 git 命令的异步操作。
//! 所有可失败操作均通过 spawn_blocking 隔离在后台线程，保证前端 UI 零卡顿。

use serde::Serialize;
use std::process::Command;

/// 单个文件变更项
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    /// 工作区相对路径（正斜杠分隔）
    pub path: String,
    /// 变更类型代码: "M" (修改), "A" (新增), "D" (删除), "U" (未跟踪), "R" (重命名)
    pub status: String,
    /// 是否已暂存
    pub staged: bool,
}

/// 仓库整体状态
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    /// 是否为有效 Git 仓库
    pub is_repo: bool,
    /// 当前分支名
    pub branch: Option<String>,
    /// 暂存区变更
    pub staged: Vec<GitFileChange>,
    /// 工作区变更（含未暂存与未跟踪）
    pub unstaged: Vec<GitFileChange>,
    /// 领先上游提交数
    pub ahead: u32,
    /// 落后上游提交数
    pub behind: u32,
}

/// 解析 git status --porcelain=v1 -uall 输出
fn parse_porcelain_status(output: &str) -> (Vec<GitFileChange>, Vec<GitFileChange>) {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for line in output.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = &line[0..1];
        let worktree_status = &line[1..2];
        let path = line[3..].trim().replace('\\', "/");

        // 暂存区判断 (X 栏不为空且非 '?' 且非 ' ')
        if index_status != " " && index_status != "?" {
            staged.push(GitFileChange {
                path: path.clone(),
                status: match index_status {
                    "M" => "M",
                    "A" => "A",
                    "D" => "D",
                    "R" => "R",
                    _ => "M",
                }
                .to_string(),
                staged: true,
            });
        }

        // 工作区判断 (Y 栏不为空且非 ' ') 或未跟踪 '??'
        if index_status == "?" && worktree_status == "?" {
            unstaged.push(GitFileChange {
                path,
                status: "U".to_string(),
                staged: false,
            });
        } else if worktree_status != " " {
            unstaged.push(GitFileChange {
                path,
                status: match worktree_status {
                    "M" => "M",
                    "D" => "D",
                    _ => "M",
                }
                .to_string(),
                staged: false,
            });
        }
    }

    (staged, unstaged)
}

/// 查询当前仓库完整状态
#[tauri::command]
pub async fn git_status(root: String) -> Result<GitRepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 1. 验证是否为 git 仓库
        let rev_check = Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(&root)
            .output();

        let is_repo = match rev_check {
            Ok(out) => out.status.success(),
            Err(_) => false,
        };

        if !is_repo {
            return Ok(GitRepoStatus {
                is_repo: false,
                branch: None,
                staged: Vec::new(),
                unstaged: Vec::new(),
                ahead: 0,
                behind: 0,
            });
        }

        // 2. 获取当前分支名
        let branch_out = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("获取分支失败: {e}"))?;
        let branch_str = String::from_utf8_lossy(&branch_out.stdout)
            .trim()
            .to_string();
        let branch = if branch_str.is_empty() {
            // 分离 HEAD 状态时显示短 commit hash
            let head_out = Command::new("git")
                .args(["rev-parse", "--short", "HEAD"])
                .current_dir(&root)
                .output()
                .ok();
            head_out.and_then(|h| {
                let s = String::from_utf8_lossy(&h.stdout).trim().to_string();
                if s.is_empty() {
                    None
                } else {
                    Some(format!("HEAD ({s})"))
                }
            })
        } else {
            Some(branch_str)
        };

        // 3. 获取变更列表 (porcelain v1)
        let status_out = Command::new("git")
            .args(["status", "--porcelain=v1", "-uall"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("执行 git status 失败: {e}"))?;
        let status_text = String::from_utf8_lossy(&status_out.stdout);
        let (staged, unstaged) = parse_porcelain_status(&status_text);

        // 4. 获取 ahead / behind 计数
        let (ahead, behind) = if let Some(ref b) = branch {
            let ab_out = Command::new("git")
                .args([
                    "rev-list",
                    "--left-right",
                    "--count",
                    &format!("{b}...@{{u}}"),
                ])
                .current_dir(&root)
                .output();
            if let Ok(out) = ab_out {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout);
                    let parts: Vec<&str> = s.split_whitespace().collect();
                    let a = parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);
                    let b = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
                    (a, b)
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        Ok(GitRepoStatus {
            is_repo: true,
            branch,
            staged,
            unstaged,
            ahead,
            behind,
        })
    })
    .await
    .map_err(|e| format!("Git 状态任务执行异常: {e}"))?
}

/// 暂存指定文件（若 paths 为空则全量暂存）
#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("git");
        cmd.current_dir(&root).arg("add");
        if paths.is_empty() {
            cmd.arg("-A");
        } else {
            for p in &paths {
                cmd.arg(p);
            }
        }
        let out = cmd
            .output()
            .map_err(|e| format!("执行 git add 失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("暂存操作异常: {e}"))?
}

/// 取消暂存指定文件（若 paths 为空则全部取消暂存）
#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("git");
        cmd.current_dir(&root).args(["restore", "--staged"]);
        if paths.is_empty() {
            cmd.arg(".");
        } else {
            for p in &paths {
                cmd.arg(p);
            }
        }
        let out = cmd.output().map_err(|e| format!("执行取消暂存失败: {e}"))?;
        if !out.status.success() {
            // 降级使用 reset HEAD
            let mut reset_cmd = Command::new("git");
            reset_cmd.current_dir(&root).args(["reset", "HEAD", "--"]);
            if paths.is_empty() {
                reset_cmd.arg(".");
            } else {
                for p in &paths {
                    reset_cmd.arg(p);
                }
            }
            let r_out = reset_cmd
                .output()
                .map_err(|e| format!("执行 git reset 失败: {e}"))?;
            if !r_out.status.success() {
                return Err(String::from_utf8_lossy(&r_out.stderr).into_owned());
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("取消暂存操作异常: {e}"))?
}

/// 放弃工作区更改（未暂存文件还原，未跟踪文件清除）
#[tauri::command]
pub async fn git_discard(
    root: String,
    paths: Vec<String>,
    is_untracked: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if is_untracked {
            // 未跟踪文件：git clean -f -- <paths>
            let mut cmd = Command::new("git");
            cmd.current_dir(&root).args(["clean", "-f", "--"]);
            for p in &paths {
                cmd.arg(p);
            }
            let out = cmd
                .output()
                .map_err(|e| format!("执行 git clean 失败: {e}"))?;
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr).into_owned());
            }
        } else {
            // 已跟踪更改：git restore -- <paths>
            let mut cmd = Command::new("git");
            cmd.current_dir(&root).args(["restore", "--"]);
            for p in &paths {
                cmd.arg(p);
            }
            let out = cmd
                .output()
                .map_err(|e| format!("执行 git restore 失败: {e}"))?;
            if !out.status.success() {
                // 降级 checkout --
                let mut co_cmd = Command::new("git");
                co_cmd.current_dir(&root).args(["checkout", "--"]);
                for p in &paths {
                    co_cmd.arg(p);
                }
                let co_out = co_cmd
                    .output()
                    .map_err(|e| format!("执行 git checkout 失败: {e}"))?;
                if !co_out.status.success() {
                    return Err(String::from_utf8_lossy(&co_out.stderr).into_owned());
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("放弃更改操作异常: {e}"))?
}

/// 提交暂存区的更改
#[tauri::command]
pub async fn git_commit(root: String, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let msg = message.trim();
        if msg.is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        let out = Command::new("git")
            .args(["commit", "-m", msg])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("执行 git commit 失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("提交异常: {e}"))?
}

/// 获取指定版本（如 HEAD、HEAD~1）的文件内容（用于 Diff 对比）
#[tauri::command]
pub async fn git_get_file_content(
    root: String,
    path: String,
    revision: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rev = revision.unwrap_or_else(|| "HEAD".to_string());
        let spec = format!("{rev}:{path}");
        let out = Command::new("git")
            .args(["show", &spec])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("执行 git show 失败: {e}"))?;
        if !out.status.success() {
            // 新增文件在 HEAD 中不存在，返回空文本
            return Ok(String::new());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .map_err(|e| format!("获取文件历史版本异常: {e}"))?
}

/// 列出所有本地分支
#[tauri::command]
pub async fn git_list_branches(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .args(["branch", "--format=%(refname:short)"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("获取分支列表失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let branches = text
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        Ok(branches)
    })
    .await
    .map_err(|e| format!("获取分支列表异常: {e}"))?
}

/// 切换分支
#[tauri::command]
pub async fn git_checkout(root: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .args(["checkout", &branch])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("切换分支失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("切换分支异常: {e}"))?
}

/// 创建并切换到新分支
#[tauri::command]
pub async fn git_create_branch(root: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .args(["checkout", "-b", &name])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("创建分支失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("创建分支异常: {e}"))?
}

/// 推送当前分支到远端
#[tauri::command]
pub async fn git_push(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .arg("push")
            .current_dir(&root)
            .output()
            .map_err(|e| format!("推送失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("推送异常: {e}"))?
}

/// 从远端拉取当前分支
#[tauri::command]
pub async fn git_pull(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .arg("pull")
            .current_dir(&root)
            .output()
            .map_err(|e| format!("拉取失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("拉取异常: {e}"))?
}

/// 初始化 Git 仓库
#[tauri::command]
pub async fn git_init(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = Command::new("git")
            .arg("init")
            .current_dir(&root)
            .output()
            .map_err(|e| format!("初始化仓库失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("初始化仓库异常: {e}"))?
}
