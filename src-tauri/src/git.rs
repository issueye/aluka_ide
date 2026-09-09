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

/// 构造静默执行的 Git 子进程命令（在 Windows 下添加 CREATE_NO_WINDOW 避免弹出控制台黑框）
pub fn new_git_command() -> Command {
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// 查询当前仓库完整状态
#[tauri::command]
pub async fn git_status(root: String) -> Result<GitRepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 1. 验证是否为 git 仓库
        let rev_check = new_git_command()
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
        let branch_out = new_git_command()
            .args(["branch", "--show-current"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("获取分支失败: {e}"))?;
        let branch_str = String::from_utf8_lossy(&branch_out.stdout)
            .trim()
            .to_string();
        let branch = if branch_str.is_empty() {
            // 分离 HEAD 状态时显示短 commit hash
            let head_out = new_git_command()
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
        let status_out = new_git_command()
            .args(["status", "--porcelain=v1", "-uall"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("执行 git status 失败: {e}"))?;
        let status_text = String::from_utf8_lossy(&status_out.stdout);
        let (staged, unstaged) = parse_porcelain_status(&status_text);

        // 4. 获取 ahead / behind 计数
        let (ahead, behind) = if let Some(ref b) = branch {
            let ab_out = new_git_command()
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
        let mut cmd = new_git_command();
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
        let mut cmd = new_git_command();
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
            let mut reset_cmd = new_git_command();
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
            let mut cmd = new_git_command();
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
            let mut cmd = new_git_command();
            cmd.current_dir(&root).args(["restore", "--"]);
            for p in &paths {
                cmd.arg(p);
            }
            let out = cmd
                .output()
                .map_err(|e| format!("执行 git restore 失败: {e}"))?;
            if !out.status.success() {
                // 降级 checkout --
                let mut co_cmd = new_git_command();
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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
        let out = new_git_command()
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

/* ---------------- 提交记录查询（Git 历史视图） ---------------- */

/// 提交记录条目（git log 每行一条）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    /// 完整提交哈希
    pub hash: String,
    /// 短哈希（默认 7 位缩写）
    pub short_hash: String,
    /// 提交信息首行
    pub subject: String,
    /// 作者显示名
    pub author: String,
    /// 作者邮箱
    pub author_email: String,
    /// 作者时间（ISO-8601 含时区偏移，%aI 输出）
    pub date: String,
}

/// 单个提交改动的一个文件
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    /// 仓库相对路径（正斜杠分隔）
    pub path: String,
    /// 相对首父提交（根提交相对空树）的变更类型："M" | "A" | "D"
    pub status: String,
}

/// 单个提交的改动清单（供 Diff 双栏对比）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    /// 首父提交完整哈希；根提交为 None（其"修改前"内容按空处理）
    pub parent_hash: Option<String>,
    /// 首父提交短哈希（仅展示用；浅克隆父对象缺失时退化为哈希前缀）
    pub parent_short: Option<String>,
    /// 该提交改动的文件（--no-renames：重命名拆为 D + A 两项）
    pub files: Vec<GitCommitFile>,
}

/// 查询当前分支（HEAD 回看）的提交记录，最多 limit 条（收敛到 1..=1000）。
/// 空仓库（尚无提交）返回空列表，不视为错误。
#[tauri::command]
pub async fn git_log(root: String, limit: u32) -> Result<Vec<GitLogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.clamp(1, 1000);
        // 未出生分支/空仓库：rev-parse HEAD 失败 → 空列表，避免各家 git 报错文案差异
        let head_check = new_git_command()
            .current_dir(&root)
            .args(["rev-parse", "--verify", "-q", "HEAD"])
            .output()
            .map_err(|e| format!("检查仓库头提交失败: {e}"))?;
        if !head_check.status.success() {
            return Ok(Vec::new());
        }
        let out = new_git_command()
            .current_dir(&root)
            .arg("log")
            .args(["-n", &limit.to_string()])
            .arg("--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s")
            .output()
            .map_err(|e| format!("执行 git log 失败: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(parse_log_output(&String::from_utf8_lossy(&out.stdout)))
    })
    .await
    .map_err(|e| format!("提交记录查询异常: {e}"))?
}

/// 解析 `git log --pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s` 输出：
/// 每条提交一行、字段以 \x1f 分隔；空行与字段数不符的残缺行防御性跳过
fn parse_log_output(output: &str) -> Vec<GitLogEntry> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\u{1f}').collect();
            if fields.len() != 6 {
                return None;
            }
            Some(GitLogEntry {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                author: fields[2].to_string(),
                author_email: fields[3].to_string(),
                date: fields[4].to_string(),
                subject: fields[5].to_string(),
            })
        })
        .collect()
}

/// 查询单个提交相对其首父的改动文件清单（根提交相对空树；合并提交只对比第一父）。
/// 父判定走 `git rev-list --parents`（读提交头即可）：浅克隆边界提交在提交头里有父哈希，
/// 不能依赖 `rev-parse hash~1` —— 父对象缺失时它失败，会把边界提交误判成根提交；
/// 此时 `git diff` 会因缺对象如实报错（不假装"空树对比"）。
#[tauri::command]
pub async fn git_commit_detail(root: String, hash: String) -> Result<GitCommitDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 输出形如 `<hash> <父1> <父2>…`，首个 token 是提交自身
        let parents_out = new_git_command()
            .current_dir(&root)
            .args(["rev-list", "--parents", "-n", "1", &hash])
            .output()
            .map_err(|e| format!("解析父提交失败: {e}"))?;
        if !parents_out.status.success() {
            return Err(String::from_utf8_lossy(&parents_out.stderr).into_owned());
        }
        let parents_line = String::from_utf8_lossy(&parents_out.stdout);
        let mut tokens = parents_line.split_whitespace();
        let _self_hash = tokens.next();
        let parent_hash = tokens.next().map(|p| p.to_string());

        let (parent_short, out) = if let Some(parent) = &parent_hash {
            // 常规提交：与首父比较；短哈希用于展示，对象缺失时退化为前缀
            let ps_out = new_git_command()
                .current_dir(&root)
                .args(["rev-parse", "--short", parent])
                .output()
                .ok();
            let ps = match ps_out {
                Some(o) if o.status.success() => {
                    String::from_utf8_lossy(&o.stdout).trim().to_string()
                }
                _ => parent.chars().take(7).collect::<String>(),
            };
            let diff_out = new_git_command()
                .current_dir(&root)
                .args(["diff", "--name-status", "-z", "--no-renames", parent, &hash])
                .output()
                .map_err(|e| format!("执行 git diff 失败: {e}"))?;
            (Some(ps), diff_out)
        } else {
            // 根提交无父：git show 自动以空树为对比基准
            let show_out = new_git_command()
                .current_dir(&root)
                .args([
                    "show",
                    "--name-status",
                    "-z",
                    "--format=",
                    "--no-renames",
                    &hash,
                ])
                .output()
                .map_err(|e| format!("执行 git show 失败: {e}"))?;
            (None, show_out)
        };
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        let files = parse_name_status_z_output(&out.stdout);
        Ok(GitCommitDetail {
            parent_hash,
            parent_short,
            files,
        })
    })
    .await
    .map_err(|e| format!("提交详情查询异常: {e}"))?
}

/// 解析 `git diff/show --name-status -z` 输出（原始字节）：状态码与路径以 NUL 交替成对。
/// -z 模式不做路径引用转义，含空格等特殊字符的路径也能还原。
/// 路径必须是合法 UTF-8 才收下（非 UTF-8 路径无法作为 revspec 回传，跳过避免空对比误导）；
/// 状态码只看首个字节 M/A/D（R/C 已被 --no-renames 拆解，其余残段防御性跳过）。
fn parse_name_status_z_output(output: &[u8]) -> Vec<GitCommitFile> {
    let mut files = Vec::new();
    for pair in output.split(|&b| b == 0).collect::<Vec<_>>().chunks(2) {
        if pair.len() < 2 {
            break; // 尾随 NUL 产生的空 token 无后继
        }
        let (code, path) = (pair[0], pair[1]);
        if path.is_empty() {
            continue;
        }
        let status = match code.first() {
            Some(b'M') => "M",
            Some(b'A') => "A",
            Some(b'D') => "D",
            _ => continue,
        };
        let Ok(path_str) = std::str::from_utf8(path) else {
            continue;
        };
        files.push(GitCommitFile {
            path: path_str.to_string(),
            status: status.to_string(),
        });
    }
    files
}

#[cfg(test)]
mod log_tests {
    use super::*;

    #[test]
    fn log_output_parses_six_fields_per_record() {
        let out = "98d7d4ac727a4fac1f787c79d6337276bbb30c85\u{1f}98d7d4a\u{1f}issueye\u{1f}issueye@yeah.net\u{1f}2026-09-09T13:21:06+08:00\u{1f}fix: 溢出遮挡\njunk-line-without-separator\n";
        let entries = parse_log_output(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, "98d7d4ac727a4fac1f787c79d6337276bbb30c85");
        assert_eq!(entries[0].short_hash, "98d7d4a");
        assert_eq!(entries[0].author, "issueye");
        assert_eq!(entries[0].author_email, "issueye@yeah.net");
        assert_eq!(entries[0].date, "2026-09-09T13:21:06+08:00");
        assert_eq!(entries[0].subject, "fix: 溢出遮挡");
    }

    #[test]
    fn log_output_ignores_trailing_empty_lines() {
        let out = "a\u{1f}b\u{1f}c\u{1f}d\u{1f}e\u{1f}f\n\n";
        assert_eq!(parse_log_output(out).len(), 1);
    }

    #[test]
    fn name_status_z_parses_pairs_and_skips_junk() {
        let out = b"A\0file one.txt\0M\0src/lib.rs\0D\0\xe6\x97\xa7\xe6\x96\x87\xe4\xbb\xb6.txt\0";
        let files = parse_name_status_z_output(out);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, "A");
        assert_eq!(files[0].path, "file one.txt");
        assert_eq!(files[1].status, "M");
        assert_eq!(files[1].path, "src/lib.rs");
        assert_eq!(files[2].status, "D");
        assert_eq!(files[2].path, "旧文件.txt");
    }

    #[test]
    fn name_status_z_skips_unknown_codes_and_broken_utf8_paths() {
        // "C100"（copy）与非法 UTF-8 路径均应跳过，只留合法的 A/M
        let out = b"C\0copied.txt\0A\0ok.txt\0M\0\xff\xfe\0D\0gone.txt\0";
        let files = parse_name_status_z_output(out);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "ok.txt");
        assert_eq!(files[1].status, "D");
    }
}
