//! 工作区全局文本搜索（M5 / FR-05）。
//! walkdir 遍历（跳过重目录与隐藏目录）+ 逐文件行扫描；
//! 支持大小写/整词/正则开关；结果按文件分组并带总条数截断。

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

/// 与资源管理器/快速打开一致的排除目录（lib.rs 定义）
use crate::EXCLUDED_DIRS;

/// 单文件上限：超过直接跳过（>5MB 的文件多为大产物/二进制，搜索价值低）
const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// 单文件最大命中条数（防止 minified 单行文件刷屏）
const MAX_MATCHES_PER_FILE: usize = 200;
/// 全局最大返回命中条数（超出置 truncated=true，FR-05"结果上限截断提示"）
const MAX_TOTAL_MATCHES: usize = 1000;
/// 最大遍历文件数（与快速打开一致）
const MAX_FILES: usize = 20_000;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub root: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// 单条命中（字节偏移按 UTF-8 计，前端仅用行号与文本）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line_number: u32,
    /// 命中行原文（截去行首尾空白后整行展示）
    pub line_text: String,
    /// 行内命中次数
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<FileResult>,
    pub total_matches: u32,
    pub truncated: bool,
    /// 实际扫描的文件数（诊断用）
    pub files_searched: u32,
}

enum Matcher {
    /// 普通文本。lowercased=true 表示 needle 已小写化（大小写不敏感模式），
    /// haystack 需同步小写后比较；否则双方都用原文。
    Text {
        needle: String,
        lowercased: bool,
    },
    Regex(regex::Regex),
}

impl Matcher {
    fn build(opts: &SearchOptions) -> Result<Matcher, String> {
        if opts.query.is_empty() {
            return Err("搜索内容为空".into());
        }
        if opts.regex {
            let re = regex::RegexBuilder::new(&opts.query)
                .case_insensitive(!opts.case_sensitive)
                .build()
                .map_err(|e| format!("正则表达式无效: {e}"))?;
            return Ok(Matcher::Regex(re));
        }
        Ok(Matcher::Text {
            lowercased: !opts.case_sensitive,
            needle: if opts.case_sensitive {
                opts.query.clone()
            } else {
                opts.query.to_lowercase()
            },
        })
    }

    fn is_word_byte(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }

    /// 返回该行命中次数；whole_word=true 时要求命中两端均非词字符（或行首/行尾）
    fn count_in(&self, line: &str, line_lower: &str, whole_word: bool) -> u32 {
        match self {
            Matcher::Regex(re) => re.find_iter(line).count() as u32,
            Matcher::Text { needle, lowercased } => {
                // 极少数 Unicode 小写化变长的行退化为原文比较（漏匹配优于错匹配）
                let hay = if *lowercased && line_lower.len() == line.len() {
                    line_lower
                } else {
                    line
                };
                let bytes = hay.as_bytes();
                let n = needle.len();
                if n == 0 || bytes.len() < n {
                    return 0;
                }
                let mut count = 0u32;
                let mut i = 0;
                while i + n <= bytes.len() {
                    if &bytes[i..i + n] == needle.as_bytes() {
                        let head_ok = !whole_word || i == 0 || !Self::is_word_byte(bytes[i - 1]);
                        let tail_ok = !whole_word
                            || i + n == bytes.len()
                            || !Self::is_word_byte(bytes[i + n]);
                        if head_ok && tail_ok {
                            count += 1;
                            i += n.max(1);
                            continue;
                        }
                    }
                    i += 1;
                }
                count
            }
        }
    }
}

/// 读取文件为文本（NUL 探测二进制直接跳过）
fn read_text(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > SEARCH_MAX_FILE_BYTES {
        return None;
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    std::fs::File::open(path).ok()?.read_to_end(&mut buf).ok()?;
    if buf.contains(&0u8) {
        return None; // 二进制文件不搜索
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// 工作区文本搜索。走 blocking 线程，串行扫描（千文件级 <2s 达标后无需并行）。
#[tauri::command]
pub async fn search_workspace(options: SearchOptions) -> Result<SearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || search_blocking(options))
        .await
        .map_err(|e| format!("搜索任务失败: {e}"))?
}

fn search_blocking(opts: SearchOptions) -> Result<SearchResponse, String> {
    if !Path::new(&opts.root).is_dir() {
        return Err(format!("路径不是目录: {}", opts.root));
    }
    let matcher = Matcher::build(&opts)?;
    let whole_word = opts.whole_word;

    let mut results: Vec<FileResult> = Vec::new();
    let mut total: usize = 0;
    let mut truncated = false;
    let mut searched: usize = 0;

    'outer: for entry in WalkDir::new(&opts.root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir()
                && (EXCLUDED_DIRS.contains(&name.as_ref())
                    || (name.starts_with('.') && e.depth() > 0)))
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        searched += 1;
        if searched > MAX_FILES {
            break;
        }
        let Some(text) = read_text(entry.path()) else {
            continue;
        };
        let mut file_matches: Vec<SearchMatch> = Vec::new();
        for (idx, line) in text.lines().enumerate() {
            let line_lower = line.to_lowercase();
            let count = matcher.count_in(line, &line_lower, whole_word);
            if count > 0 {
                file_matches.push(SearchMatch {
                    line_number: (idx + 1) as u32,
                    line_text: line.trim_end().to_string(),
                    count,
                });
                total += count as usize;
                if total >= MAX_TOTAL_MATCHES {
                    truncated = true;
                    break;
                }
                if file_matches.len() >= MAX_MATCHES_PER_FILE {
                    truncated = true;
                    break;
                }
            }
        }
        if !file_matches.is_empty() {
            results.push(FileResult {
                path: entry.path().to_string_lossy().into_owned(),
                matches: file_matches,
            });
            if truncated {
                break 'outer;
            }
        }
    }

    Ok(SearchResponse {
        results,
        total_matches: total as u32,
        truncated,
        files_searched: searched.min(MAX_FILES) as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_matcher(query: &str, case_sensitive: bool) -> Matcher {
        Matcher::build(&SearchOptions {
            root: String::new(),
            query: query.into(),
            case_sensitive,
            whole_word: false,
            regex: false,
        })
        .unwrap()
    }

    fn count(m: &Matcher, line: &str, whole_word: bool) -> u32 {
        let lower = line.to_lowercase();
        m.count_in(line, &lower, whole_word)
    }

    #[test]
    fn case_insensitive_and_sensitive() {
        let ci = text_matcher("foo", false);
        assert_eq!(count(&ci, "Foo foo FOO", false), 3);
        let cs = text_matcher("Foo", true);
        assert_eq!(count(&cs, "Foo foo FOO", false), 1);
    }

    #[test]
    fn whole_word_boundaries() {
        let m = text_matcher("main", false);
        assert_eq!(count(&m, "main mainfoo domains main", true), 2);
        assert_eq!(count(&m, "main mainfoo domains main", false), 4);
    }

    #[test]
    fn regex_mode() {
        let m = Matcher::build(&SearchOptions {
            root: String::new(),
            query: r"func\s+\w+".into(),
            case_sensitive: false,
            whole_word: false,
            regex: true,
        })
        .unwrap();
        assert_eq!(count(&m, "func main() {", false), 1);
        assert_eq!(count(&m, "function main() {", false), 0); // func 后必须紧跟空白
    }

    #[test]
    fn regex_case_flag() {
        let m = Matcher::build(&SearchOptions {
            root: String::new(),
            query: "TODO:".into(),
            case_sensitive: false,
            whole_word: false,
            regex: true,
        })
        .unwrap();
        assert_eq!(count(&m, "// todo: fix", false), 1);
    }
}
