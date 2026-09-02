import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "./types";

/**
 * 后端命令统一封装（AGENTS.md §5：组件禁止直接 invoke）。
 * 新增后端命令必须在此登记类型化封装。
 */

/** 打开系统文件夹选择对话框，返回所选路径（取消返回 null） */
export async function openFolderDialog(): Promise<string | null> {
  return invoke<string | null>("open_folder_dialog");
}

/** 读取目录的单层子项（已按目录优先、名称排序，重目录已过滤） */
export async function readDir(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("read_dir", { path });
}

/** 新建空文件 / 文件夹 */
export async function createEntry(path: string, isDir: boolean): Promise<void> {
  return invoke<void>("create_entry", { path, isDir });
}

/** 重命名 / 移动（目标已存在时后端拒绝） */
export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke<void>("rename_entry", { oldPath, newPath });
}

/** 删除（移入系统回收站，可恢复） */
export async function deleteEntry(path: string): Promise<void> {
  return invoke<void>("delete_entry", { path });
}

/** 启动/重建工作区文件监听（重复调用会替换旧监听） */
export async function watchWorkspace(root: string): Promise<void> {
  return invoke<void>("watch_workspace", { root });
}

/** 文本文件读取结果 */
export interface TextFile {
  content: string;
  isBinary: boolean;
  size: number;
  readonly: boolean;
}

/** 读取文本文件（二进制探测 + 大小保护：>20MB 拒绝，>5MB 只读） */
export async function readFile(path: string): Promise<TextFile> {
  return invoke<TextFile>("read_file", { path });
}

/** 保存文本文件（仅覆盖已存在文件） */
export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

/** 批量保存（命令面板/自动保存：一次性落盘多个脏文件） */
export async function saveAll(items: { path: string; content: string }[]): Promise<void> {
  return invoke<void>("save_all", { items });
}

/** 用户设置（~/.aluka-ide/settings.json；null = 尚无文件） */
export interface UserSettings {
  theme: string;
  fontSize: number;
  autoSave: "off" | "afterDelay";
}

/** 读取持久化设置 */
export async function getSettings(): Promise<UserSettings | null> {
  return invoke<UserSettings | null>("get_settings");
}

/** 写入持久化设置 */
export async function setSettings(settings: UserSettings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

/** 列出工作区全部文件（快速打开用；后端跳过重目录/隐藏目录，上限 2 万） */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  return invoke<string[]>("list_workspace_files", { root });
}

/* ---------------- M5：全局搜索 / 终端 / git 分支 ---------------- */

/** 搜索选项（FR-05：大小写/整词/正则开关） */
export interface SearchOptions {
  root: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** 单条命中 */
export interface SearchMatch {
  lineNumber: number;
  lineText: string;
  count: number;
}

/** 按文件分组的搜索结果 */
export interface FileSearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
  filesSearched: number;
}

/** 工作区文本搜索（后端 walkdir + 截断保护） */
export async function searchWorkspace(options: SearchOptions): Promise<SearchResponse> {
  return invoke<SearchResponse>("search_workspace", { options });
}

/** 创建终端会话，返回会话 id（输出经 terminal:output 事件流式回传） */
export async function createTerminal(
  root: string,
  cols?: number,
  rows?: number,
): Promise<number> {
  return invoke<number>("create_terminal", { root, cols, rows });
}

/** 向终端写入原始按键数据/控制序列 */
export async function writeTerminal(id: number, data: string): Promise<void> {
  return invoke<void>("write_terminal", { id, data });
}

/** 动态调整终端尺寸（cols, rows） */
export async function resizeTerminal(
  id: number,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("resize_terminal", { id, cols, rows });
}

/** 关闭终端会话 */
export async function killTerminal(id: number): Promise<void> {
  return invoke<void>("kill_terminal", { id });
}

/** 会话已退出（前端收到 terminal:closed 后调用，清理后端残留） */
export async function reapTerminal(id: number): Promise<void> {
  return invoke<void>("reap_terminal", { id });
}

/* ---------------- Git 源码管理（SCM / Diff） ---------------- */

export interface GitFileChange {
  path: string;
  status: "M" | "A" | "D" | "U" | "R";
  staged: boolean;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string | null;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  ahead: number;
  behind: number;
}

/** 查询工作区 Git 完整状态 */
export async function getGitStatus(root: string): Promise<GitRepoStatus> {
  return invoke<GitRepoStatus>("git_status", { root });
}

/** 暂存文件（空数组代表全量暂存） */
export async function gitStage(root: string, paths: string[] = []): Promise<void> {
  return invoke<void>("git_stage", { root, paths });
}

/** 取消暂存文件（空数组代表全量取消） */
export async function gitUnstage(root: string, paths: string[] = []): Promise<void> {
  return invoke<void>("git_unstage", { root, paths });
}

/** 放弃修改（已跟踪用 restore，未跟踪用 clean） */
export async function gitDiscard(
  root: string,
  paths: string[],
  isUntracked = false,
): Promise<void> {
  return invoke<void>("git_discard", { root, paths, isUntracked });
}

/** 提交暂存区变更 */
export async function gitCommit(root: string, message: string): Promise<void> {
  return invoke<void>("git_commit", { root, message });
}

/** 获取指定修订版本的文件历史内容（用于 Diff 对比） */
export async function gitGetFileContent(
  root: string,
  path: string,
  revision?: string,
): Promise<string> {
  return invoke<string>("git_get_file_content", { root, path, revision });
}

/** 列出所有本地分支 */
export async function gitListBranches(root: string): Promise<string[]> {
  return invoke<string[]>("git_list_branches", { root });
}

/** 切换分支 */
export async function gitCheckout(root: string, branch: string): Promise<void> {
  return invoke<void>("git_checkout", { root, branch });
}

/** 创建并切换到新分支 */
export async function gitCreateBranch(root: string, name: string): Promise<void> {
  return invoke<void>("git_create_branch", { root, name });
}

/** 推送当前分支 */
export async function gitPush(root: string): Promise<void> {
  return invoke<void>("git_push", { root });
}

/** 拉取当前分支 */
export async function gitPull(root: string): Promise<void> {
  return invoke<void>("git_pull", { root });
}

/** 初始化 Git 仓库 */
export async function gitInit(root: string): Promise<void> {
  return invoke<void>("git_init", { root });
}

/** 当前 git 分支（非 git 仓库返回 null） */
export async function getGitBranch(root: string): Promise<string | null> {
  return invoke<string | null>("get_git_branch", { root });
}

/* ---------------- M6：扩展系统（VSIX 本地安装 / 扫描） ---------------- */

/** 已安装扩展（清单为 VS Code package.json 原样 JSON，前端按 L1 契约收窄） */
export interface InstalledExtension {
  dir: string;
  origin: "global" | "workspace";
  manifest: unknown;
}

/** 安装结果 */
export interface InstallResult {
  dir: string;
  manifest: unknown;
}

/** 弹出文件对话框选择 .vsix；取消返回 null */
export async function pickVsixDialog(): Promise<string | null> {
  return invoke<string | null>("pick_vsix_dialog");
}

/** 安装本地 VSIX 到全局扩展目录（覆盖安装） */
export async function installVsix(vsixPath: string): Promise<InstallResult> {
  return invoke<InstallResult>("install_vsix", { vsixPath });
}

/** 扫描已安装扩展（全局 + 工作区 .aluka/extensions） */
export async function listExtensions(workspaceRoot: string | null): Promise<InstalledExtension[]> {
  return invoke<InstalledExtension[]>("list_extensions", { workspaceRoot });
}

/** 读取扩展目录内文件（主题 JSON / 片段 / main.js） */
export async function readExtensionFile(dir: string, rel: string): Promise<string> {
  return invoke<string>("read_extension_file", { dir, rel });
}

/** 卸载全局扩展 */
export async function uninstallExtension(dir: string): Promise<void> {
  return invoke<void>("uninstall_extension", { dir });
}
