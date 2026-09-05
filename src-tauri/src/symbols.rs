//! 工作区符号索引（FR-20 代码跳转，M9）。
//! 无 LSP 的文本级"定义模式"扫描：walkdir 遍历（跳过重目录/隐藏目录/大文件），
//! 按扩展名应用各语言定义正则，返回 path/line/col/name/kind。
//! 明确边界：不做类型解析/重载区分/import 解析；同名多定义由前端列表呈现。

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

/// 与资源管理器/快速打开/搜索一致的排除目录（lib.rs 定义）
use crate::EXCLUDED_DIRS;

/// 单文件上限：定义索引只关心源码，>1MB 的多为产物/数据文件
const SYMBOL_MAX_FILE_BYTES: u64 = 1024 * 1024;
/// 全局最大返回条数（空查询构建索引时的安全上限）
const MAX_SYMBOLS: usize = 4000;
/// 最大遍历文件数（与搜索/快速打开一致）
const MAX_FILES: usize = 20_000;

/// 单条符号命中。字段名对齐前端 camelCase 约定。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolMatch {
    pub path: String,
    /// 1-based 行号
    pub line: u32,
    /// 1-based 列号（符号名首字符，按字符计）
    pub col: u32,
    pub name: String,
    /// function/class/struct/enum/interface/trait/type/const/var/module/macro/method
    pub kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolQuery {
    pub root: String,
    /// 名称过滤（大小写不敏感子串）；空 = 返回全部（受 limit 截断）
    pub query: Option<String>,
    pub limit: Option<usize>,
}

/// 一条定义规则：正则（第 1 捕获组 = 符号名）+ 符号类型标签
struct Rule {
    re: Regex,
    kind: &'static str,
}

/// 按扩展名分组的语言规则集。模式均为"定义形态"（声明关键词 + 名称捕获），
/// 非 \b 包裹的引用形态；正则编译失败不应发生（字面量），失败时跳过该规则。
fn compile_rules(ext: &str) -> Vec<Rule> {
    let defs: &[(&str, &str)] = match ext {
        "rs" => &[
            (r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)", "function"),
            (r"\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)", "struct"),
            (r"\benum\s+([A-Za-z_][A-Za-z0-9_]*)", "enum"),
            (r"\btrait\s+([A-Za-z_][A-Za-z0-9_]*)", "interface"),
            (
                r"\b(?:const|static)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:",
                "const",
            ),
            (r"\bmod\s+([A-Za-z_][A-Za-z0-9_]*)", "module"),
            (r"\btype\s+([A-Za-z_][A-Za-z0-9_]*)", "type"),
            (r"\bmacro_rules!\s*([A-Za-z_][A-Za-z0-9_]*)", "macro"),
        ],
        "go" => &[
            (
                r"\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(",
                "function",
            ),
            (
                r"\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b",
                "type",
            ),
            (r"\b(?:var|const)\s+([A-Za-z_][A-Za-z0-9_]*)", "var"),
        ],
        "py" => &[
            (r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)", "function"),
            (r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)", "class"),
        ],
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => &[
            (r"\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)", "function"),
            (r"\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)", "class"),
            (r"\binterface\s+([A-Za-z_$][A-Za-z0-9_$]*)", "interface"),
            (r"\benum\s+([A-Za-z_$][A-Za-z0-9_$]*)", "enum"),
            (r"\btype\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=", "type"),
            (
                r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)",
                "function",
            ),
        ],
        "java" | "kt" | "cs" | "swift" => &[
            (r"\b(?:class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)", "class"),
            (r"\benum\s+([A-Za-z_][A-Za-z0-9_]*)", "enum"),
        ],
        "c" | "h" | "cpp" | "hpp" | "cc" => &[
            (r"\b(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)", "struct"),
            (r"\benum\s+([A-Za-z_][A-Za-z0-9_]*)", "enum"),
            (
                r"^\s*[A-Za-z_][A-Za-z0-9_:<>,&*\s]*?[\s&*]([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{)]*\)\s*(?:const\s*)?\{",
                "function",
            ),
        ],
        _ => &[],
    };
    defs.iter()
        .filter_map(|(pattern, kind)| Regex::new(pattern).ok().map(|re| Rule { re, kind }))
        .collect()
}

/// 扫描单个文件，追加命中到 out（受 limit 截断）
fn scan_file(path: &Path, out: &mut Vec<SymbolMatch>, limit: usize) {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext.is_empty() {
        return;
    }
    let rules = compile_rules(&ext);
    if rules.is_empty() {
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if !meta.is_file() || meta.len() > SYMBOL_MAX_FILE_BYTES {
        return;
    }
    let mut text = String::new();
    if fs::File::open(path)
        .and_then(|mut f| f.read_to_string(&mut text))
        .is_err()
    {
        return; // 非 UTF-8 / 读取失败：跳过
    }
    let path_str = path.to_string_lossy().into_owned();
    for (idx, line) in text.lines().enumerate() {
        if out.len() >= limit {
            return;
        }
        for rule in &rules {
            if let Some(caps) = rule.re.captures(line) {
                if let Some(name) = caps.get(1) {
                    // 列号按 UTF-8 字符计（Monaco 列号同为字符计）
                    let col = line[..name.start()].chars().count() as u32 + 1;
                    out.push(SymbolMatch {
                        path: path_str.clone(),
                        line: idx as u32 + 1,
                        col,
                        name: name.as_str().to_string(),
                        kind: rule.kind.to_string(),
                    });
                }
            }
        }
    }
}

/// 工作区符号扫描：过滤（大小写不敏感子串）在收集阶段就地应用。
#[tauri::command]
pub async fn find_workspace_symbols(query: SymbolQuery) -> Result<Vec<SymbolMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let filter = query.query.unwrap_or_default().to_lowercase();
        let limit = query.limit.unwrap_or(MAX_SYMBOLS).min(MAX_SYMBOLS);
        let root = Path::new(&query.root);
        if !root.is_dir() {
            return Err(format!("工作区目录不存在: {}", query.root));
        }
        let mut out: Vec<SymbolMatch> = Vec::new();
        let mut scanned: usize = 0;
        'outer: for entry in WalkDir::new(root)
            .max_depth(24)
            .follow_links(false)
            .into_iter()
            // walker 层剪枝：排除目录/隐藏目录不递归（否则 node_modules 等会耗尽文件配额）
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
            scanned += 1;
            if scanned > MAX_FILES {
                break;
            }
            let before = out.len();
            scan_file(entry.path(), &mut out, MAX_SYMBOLS);
            // 非空过滤：仅保留本文件新增命中中的匹配项
            if !filter.is_empty() {
                let mut kept = out.drain(before..).collect::<Vec<_>>();
                kept.retain(|m| m.name.to_lowercase().contains(&filter));
                out.extend(kept);
            }
            if out.len() >= limit {
                out.truncate(limit);
                break 'outer;
            }
        }
        out.truncate(limit);
        Ok(out)
    })
    .await
    .map_err(|e| format!("符号扫描任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_match(rule_ext: &str, line: &str) -> Option<(String, String)> {
        compile_rules(rule_ext).iter().find_map(|rule| {
            rule.re.captures(line).and_then(|caps| {
                caps.get(1)
                    .map(|m| (m.as_str().to_string(), rule.kind.to_string()))
            })
        })
    }

    #[test]
    fn rust_definitions() {
        assert_eq!(
            first_match("rs", "pub async fn register_core_commands() {"),
            Some(("register_core_commands".into(), "function".into()))
        );
        assert_eq!(
            first_match("rs", "pub struct SymbolMatch {"),
            Some(("SymbolMatch".into(), "struct".into()))
        );
        assert_eq!(
            first_match("rs", "const MAX_SYMBOLS: usize = 4000;"),
            Some(("MAX_SYMBOLS".into(), "const".into()))
        );
    }

    #[test]
    fn ts_definitions() {
        assert_eq!(
            first_match("ts", "export function runCommand(id: string) {"),
            Some(("runCommand".into(), "function".into()))
        );
        assert_eq!(
            first_match("ts", "const gotoDefinition = () => {"),
            Some(("gotoDefinition".into(), "function".into()))
        );
        assert_eq!(
            first_match("ts", "export interface AlukaCommand {"),
            Some(("AlukaCommand".into(), "interface".into()))
        );
    }

    #[test]
    fn python_definitions() {
        assert_eq!(
            first_match("py", "def main(args: list[str]) -> None:"),
            Some(("main".into(), "function".into()))
        );
        assert_eq!(
            first_match("py", "class AppStore:"),
            Some(("AppStore".into(), "class".into()))
        );
    }

    #[test]
    fn go_definitions() {
        assert_eq!(
            first_match("go", "func (s *Store) Ensure() error {"),
            Some(("Ensure".into(), "function".into()))
        );
        assert_eq!(
            first_match("go", "type Config struct {"),
            Some(("Config".into(), "type".into()))
        );
    }

    #[test]
    fn c_like_definitions_and_noise() {
        assert_eq!(
            first_match("c", "int main(void) {"),
            Some(("main".into(), "function".into()))
        );
        // 控制流不是定义（参数列表内含 `;` 或缺少 `{` 的形态不命中）
        assert_eq!(first_match("c", "    if (x > 0) return 1;"), None);
        assert_eq!(first_match("c", "    for (int i = 0; i < n; i++) {"), None);
    }

    #[test]
    fn col_is_char_based() {
        let rules = compile_rules("rs");
        let line = "    pub fn symbol_name() {}";
        let re = &rules[0].re;
        let caps = re.captures(line).expect("应命中 fn 规则");
        let name = caps.get(1).expect("捕获组 1");
        let col = line[..name.start()].chars().count() + 1;
        assert_eq!(col, 12); // 4 空格 + "pub fn " = 11 字符，符号从第 12 列起
    }
}
