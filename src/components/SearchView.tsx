import { useState } from "react";
import { CaseSensitive, Regex, WholeWord } from "lucide-react";
import { useAppStore } from "../store";
import { useEditorStore, requestReveal } from "../editorStore";
import { searchWorkspace, type SearchResponse } from "../tauri";

/**
 * 全局搜索视图（M5 / FR-05）：大小写/整词/正则开关；
 * 结果按文件分组，点击命中行跳转到编辑器对应行。
 */

function ToggleIcon({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded ${
        on
          ? "bg-[var(--aluka-active)] text-[var(--aluka-text-active)]"
          : "text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function SearchView() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot);
  const openFile = useEditorStore((s) => s.openFile);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resp, setResp] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    if (!workspaceRoot || !query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await searchWorkspace({
        root: workspaceRoot,
        query,
        caseSensitive,
        wholeWord,
        regex,
      });
      setResp(r);
    } catch (e) {
      setError(String(e));
      setResp(null);
    } finally {
      setSearching(false);
    }
  };

  const jumpTo = (path: string, line: number) => {
    void openFile(path).then(() => requestReveal(path, line));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      {/* 搜索输入 + 开关 */}
      <div className="flex items-center gap-1 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 py-1">
        <input
          value={query}
          placeholder="搜索"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--aluka-text)] outline-none"
        />
        <ToggleIcon on={caseSensitive} title="区分大小写" onClick={() => setCaseSensitive((v) => !v)}>
          <CaseSensitive size={14} />
        </ToggleIcon>
        <ToggleIcon on={wholeWord} title="全字匹配" onClick={() => setWholeWord((v) => !v)}>
          <WholeWord size={14} />
        </ToggleIcon>
        <ToggleIcon on={regex} title="使用正则表达式" onClick={() => setRegex((v) => !v)}>
          <Regex size={14} />
        </ToggleIcon>
      </div>
      <button
        onClick={() => void runSearch()}
        disabled={!workspaceRoot || !query.trim() || searching}
        className="mt-2 self-start rounded bg-[var(--aluka-btn-bg)] px-3 py-1 text-[12px] text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-50"
      >
        {searching ? "搜索中…" : "全部搜索"}
      </button>

      {error && (
        <div className="mt-2 rounded border border-[#5a2b1d] bg-[#3a231d] px-2 py-1 text-[12px] text-[#f48771]">
          {error}
        </div>
      )}

      {/* 结果摘要 */}
      {resp && (
        <div className="mt-2 px-1 text-[12px] text-[var(--aluka-text-dim)]">
          {resp.totalMatches === 0
            ? "无结果"
            : `${resp.results.length} 个文件中共 ${resp.totalMatches} 处命中${resp.truncated ? "（已达上限，结果截断）" : ""}`}
        </div>
      )}

      {/* 结果树：文件分组 → 命中行 */}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        {resp?.results.map((f) => {
          const name = f.path.split(/[\\/]/).pop() ?? f.path;
          return (
            <div key={f.path} className="mb-1">
              <div
                title={f.path}
                className="flex items-center gap-1.5 px-1 py-0.5 text-[12px] text-[var(--aluka-text)]"
              >
                <span className="font-medium">{name}</span>
                <span className="truncate text-[11px] text-[var(--aluka-text-dim)]">{f.path}</span>
                <span className="ml-auto rounded-full bg-[var(--aluka-input-bg)] px-1.5 text-[11px]">
                  {f.matches.length}
                </span>
              </div>
              {f.matches.map((m) => (
                <button
                  key={`${f.path}:${m.lineNumber}`}
                  onClick={() => jumpTo(f.path, m.lineNumber)}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 pl-4 text-left text-[12px] text-[var(--aluka-text-dim)] hover:bg-[var(--aluka-hover)] hover:text-[var(--aluka-text)]"
                >
                  <span className="w-8 shrink-0 text-right tabular-nums">{m.lineNumber}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{m.lineText}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
