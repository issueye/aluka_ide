import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, History, RefreshCw, Search } from "lucide-react";
import { useAppStore } from "../store";
import { useGitStore } from "../gitStore";
import { useEditorStore } from "../editorStore";
import StatusBadge from "./StatusBadge";
import { gitCommitDetail, gitGetFileContent, gitLog } from "../tauri";
import type { GitCommitDetail, GitCommitFile, GitLogEntry } from "../tauri";

/** 把 ISO-8601 时间显示为中文相对时间（未来时间按 0 处理） */
function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const minutes = Math.floor(Math.max(0, now - t) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 查询命中：提交信息 / 作者 / 邮箱 / 哈希（短或完整）任一子串命中（大小写不敏感） */
function matchesQuery(entry: GitLogEntry, query: string): boolean {
  if (!query) return true;
  const kw = query.toLowerCase();
  return (
    entry.subject.toLowerCase().includes(kw) ||
    entry.author.toLowerCase().includes(kw) ||
    entry.authorEmail.toLowerCase().includes(kw) ||
    entry.shortHash.toLowerCase().includes(kw) ||
    entry.hash.toLowerCase().includes(kw)
  );
}

/** 单条提交的展开区（改动文件清单） */
function CommitDetail({
  entry,
  detail,
  onOpenFile,
}: {
  entry: GitLogEntry;
  detail: GitCommitDetail;
  onOpenFile: (file: GitCommitFile) => void;
}) {
  if (detail.files.length === 0) {
    return (
      <div className="px-6 py-1.5 text-[11px] text-[var(--aluka-text-dim)]">
        该提交没有文件改动
      </div>
    );
  }
  return (
    <div className="pb-1">
      <div className="px-6 pb-0.5 text-[10px] text-[var(--aluka-text-dim)]">
        {detail.files.length} 个文件改动（点击文件查看提交前后对比）
      </div>
      {detail.files.map((file) => (
        <div
          key={`${entry.hash}:${file.path}`}
          onClick={() => onOpenFile(file)}
          title="点击对比提交前后"
          className="group flex h-6 cursor-pointer items-center gap-2 px-6 pr-3 text-[12px] hover:bg-[var(--aluka-hover)]"
        >
          <StatusBadge status={file.status} staged={false} />
          <span className="truncate text-[var(--aluka-text)]">{file.path}</span>
          <span className="ml-auto shrink-0 text-[10px] text-[var(--aluka-text-dim)] opacity-0 group-hover:opacity-100">
            查看对比
          </span>
        </div>
      ))}
    </div>
  );
}

export default function GitHistoryView() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const { status, loading: gitBusy, refresh, initRepo } = useGitStore();
  const openDiff = useEditorStore((s) => s.openDiff);

  /** null = 尚未成功加载（首次加载 / 出错后清空） */
  const [entries, setEntries] = useState<GitLogEntry[] | null>(null);
  /** 回看条数窗口（每档 +100，后端上限 1000） */
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** 当前展开的提交完整哈希（null = 全部收起） */
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  /** 提交改动清单缓存：hash → 详情 | "error"（成功缓存不重复请求；error 允许重试） */
  const [detailCache, setDetailCache] = useState<Record<string, GitCommitDetail | "error">>({});
  /** 改动清单拉取中（允许多个提交并发拉取，互不阻塞） */
  const [detailLoading, setDetailLoading] = useState<ReadonlySet<string>>(() => new Set());
  /** 过期响应丢弃：切换工作区/连点刷新时旧结果不得覆盖新结果 */
  const loadSeqRef = useRef(0);
  /** 记录上次拉取的工作区根，识别工作区切换以重置视图状态 */
  const lastRootRef = useRef<string | null>(null);

  const loadLog = useCallback(async (root: string, lim: number) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await gitLog(root, lim);
      if (seq !== loadSeqRef.current) return;
      setEntries(list);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setEntries(null);
      setError(String(e));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  // 工作区变化 → 重置列表/详情/展开并回到默认窗口；窗口变化 → 只重新拉取。
  // 作废序号在重置时立即 +1：上一个工作区在途的 git_log 响应必须失效，
  // 否则在 limit 回落生效前旧结果可能通过 seq 校验污染新工作区列表。
  useEffect(() => {
    if (!workspaceRoot) return;
    const rootChanged = lastRootRef.current !== workspaceRoot;
    lastRootRef.current = workspaceRoot;
    if (rootChanged) {
      loadSeqRef.current += 1;
      setEntries(null);
      setDetailCache({});
      setExpandedHash(null);
      setError(null);
      void refresh(workspaceRoot);
      if (limit !== 100) {
        setLimit(100);
        return; // limit 回落后 effect 再次触发，由下方统一执行加载
      }
    }
    void loadLog(workspaceRoot, limit);
  }, [workspaceRoot, limit, loadLog, refresh]);

  /** 拉取单个提交的改动清单并写入缓存（调用方可并发多个不同提交） */
  const loadDetail = async (root: string, hash: string) => {
    setDetailLoading((prev) => new Set(prev).add(hash));
    try {
      const detail = await gitCommitDetail(root, hash);
      setDetailCache((prev) => ({ ...prev, [hash]: detail }));
    } catch (e) {
      console.error("拉取提交详情失败:", e);
      setDetailCache((prev) => ({ ...prev, [hash]: "error" }));
    } finally {
      setDetailLoading((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  };

  /** 展开/收起提交；展开时按需拉取改动清单（缓存失败态在重新展开时自动重试） */
  const toggleExpand = (entry: GitLogEntry) => {
    if (!workspaceRoot) return;
    const willExpand = expandedHash !== entry.hash;
    setExpandedHash(willExpand ? entry.hash : null);
    if (!willExpand) return;
    const cached = detailCache[entry.hash];
    if (cached && cached !== "error") return; // 已有成功缓存，直接展示
    if (detailLoading.has(entry.hash)) return; // 拉取在途，不重复发
    void loadDetail(workspaceRoot, entry.hash);
  };

  /** 打开某文件在该提交（相对首父）的前后对比 Diff */
  const openFileDiff = async (entry: GitLogEntry, file: GitCommitFile) => {
    if (!workspaceRoot) return;
    const detail = detailCache[entry.hash];
    if (!detail || detail === "error") return;
    try {
      const absPath = `${workspaceRoot.replace(/[\\/]+$/, "")}/${file.path}`;
      // 修改前 = 首父版本（根提交无父为空）；修改后 = 该提交版本。
      // A（本提交新增）与 D（本提交删除）一侧必为空串，跳过注定失败的内容拉取。
      const isAdded = file.status === "A";
      const isDeleted = file.status === "D";
      const original =
        detail.parentHash && !isAdded
          ? await gitGetFileContent(workspaceRoot, file.path, detail.parentHash)
          : "";
      const modified = isDeleted
        ? ""
        : await gitGetFileContent(workspaceRoot, file.path, entry.hash);
      const baseLabel = detail.parentShort ?? "空树";
      openDiff(
        absPath,
        original,
        modified,
        `${file.path} (${baseLabel} ↔ ${entry.shortHash})`,
      );
    } catch (e) {
      console.error("打开提交 Diff 失败:", e);
    }
  };

  /** 手动重试拉取（出错后 / 非仓库初始化后） */
  const retryLoad = () => {
    if (!workspaceRoot) return;
    void refresh(workspaceRoot);
    void loadLog(workspaceRoot, limit);
  };

  const handleInitRepo = async () => {
    if (!workspaceRoot) return;
    await initRepo(workspaceRoot);
    void loadLog(workspaceRoot, limit);
  };

  if (!workspaceRoot) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-[var(--aluka-text-dim)]">
        打开工作区以查看当前分支的提交记录
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <History size={36} className="mb-3 text-[var(--aluka-text-dim)]" />
        <p className="mb-4 text-[13px] text-[var(--aluka-text-dim)]">
          当前工作区尚未启用 Git 源代码管理
        </p>
        <button
          onClick={() => void handleInitRepo()}
          disabled={gitBusy}
          className="rounded bg-[var(--aluka-btn-bg)] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
        >
          初始化 Git 仓库
        </button>
      </div>
    );
  }

  const filtered = (entries ?? []).filter((entry) => matchesQuery(entry, query));

  return (
    <div className="flex h-full flex-col text-[12px]">
      {/* 顶部工具栏：当前分支 + 刷新 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--aluka-border)] px-3 text-[var(--aluka-text-dim)]">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--aluka-text)]">
          <History size={13} className="shrink-0 text-[#007acc]" />
          <span className="truncate">{status?.branch ?? "提交记录"}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="刷新提交记录"
            onClick={retryLoad}
            disabled={loading || gitBusy}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)] disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 查询框：提交信息 / 作者 / 哈希 子串过滤 */}
      <div className="shrink-0 border-b border-[var(--aluka-border)] px-3 py-2">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--aluka-text-dim)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="过滤提交信息 / 作者 / 哈希"
            spellCheck={false}
            className="w-full rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] py-1 pl-7 pr-2 font-mono text-[12px] text-[var(--aluka-text)] placeholder-[var(--aluka-text-dim)] outline-none focus:border-[#007acc]"
          />
        </div>
      </div>

      {/* 提交列表滚动区 */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="break-all text-[12px] text-[var(--aluka-text-dim)]">{error}</p>
            <button
              onClick={retryLoad}
              className="rounded bg-[var(--aluka-btn-bg)] px-3 py-1 text-[12px] font-medium text-white hover:bg-[var(--aluka-btn-hover)]"
            >
              重试
            </button>
          </div>
        )}
        {!error && entries === null && (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--aluka-text-dim)]">
            正在加载提交记录…
          </div>
        )}
        {!error && entries !== null && entries.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--aluka-text-dim)]">
            暂无提交记录
          </div>
        )}
        {!error && entries !== null && entries.length > 0 && (
          <>
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-[var(--aluka-text-dim)]">
                没有匹配「{query}」的提交
              </div>
            ) : (
              filtered.map((entry) => {
                const isExpanded = expandedHash === entry.hash;
                const detail = detailCache[entry.hash];
                const isDetailBusy = detailLoading.has(entry.hash);
                return (
                  <div
                    key={entry.hash}
                    className="border-b border-[var(--aluka-border)] last:border-b-0"
                  >
                    <div
                      onClick={() => void toggleExpand(entry)}
                      title={isExpanded ? "收起改动清单" : "展开改动清单"}
                      className="flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 hover:bg-[var(--aluka-hover)]"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isExpanded ? (
                          <ChevronDown size={12} className="shrink-0 text-[var(--aluka-text-dim)]" />
                        ) : (
                          <ChevronRight
                            size={12}
                            className="shrink-0 text-[var(--aluka-text-dim)]"
                          />
                        )}
                        <span className="truncate text-[12px] text-[var(--aluka-text)]">
                          {entry.subject}
                        </span>
                        <span
                          className="ml-auto shrink-0 font-mono text-[10px] text-[var(--aluka-text-dim)]"
                          title={`完整哈希：${entry.hash}`}
                        >
                          {entry.shortHash}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 pl-[18px] text-[11px] text-[var(--aluka-text-dim)]">
                        <span className="truncate">
                          {entry.author}
                          {entry.authorEmail ? ` <${entry.authorEmail}>` : ""}
                        </span>
                        <span
                          className="shrink-0"
                          title={new Date(entry.date).toLocaleString()}
                        >
                          {formatRelativeTime(entry.date)}
                        </span>
                      </div>
                    </div>
                    {isExpanded &&
                      (detail === "error" ? (
                        <div className="flex items-center gap-2 px-6 py-1.5 text-[11px] text-[#f48771]">
                          <span>提交详情拉取失败</span>
                          <button
                            onClick={() => {
                              if (workspaceRoot) void loadDetail(workspaceRoot, entry.hash);
                            }}
                            disabled={isDetailBusy}
                            className="rounded bg-[var(--aluka-btn-bg)] px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
                          >
                            {isDetailBusy ? "重试中…" : "重试"}
                          </button>
                        </div>
                      ) : !detail ? (
                        <div className="px-6 py-1.5 text-[11px] text-[var(--aluka-text-dim)]">
                          {isDetailBusy ? "正在加载改动文件…" : "正在准备…"}
                        </div>
                      ) : (
                        <CommitDetail
                          entry={entry}
                          detail={detail}
                          onOpenFile={(file) => void openFileDiff(entry, file)}
                        />
                      ))}
                  </div>
                );
              })
            )}
            {filtered.length > 0 && entries.length === limit && limit < 1000 && (
              <button
                onClick={() => setLimit(Math.min(limit + 100, 1000))}
                disabled={loading}
                className="w-full py-2 text-center text-[11px] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)] disabled:opacity-50"
              >
                {loading ? "加载中…" : "加载更多提交"}
              </button>
            )}
            {filtered.length > 0 && entries.length < limit && (
              <div className="py-2 text-center text-[10px] text-[var(--aluka-text-dim)]">
                已显示全部 {entries.length} 条提交
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
