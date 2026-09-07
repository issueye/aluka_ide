import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useLanguageStore } from "../languageStore";

/**
 * 语言管理器（FR-09 动态语法高亮）：
 * 列出自定义 Monarch 语言 + 添加表单（ID/显示名/扩展名/语法 JSON）。
 * 打开：命令面板「语言: 管理语言高亮」/ 状态栏语言选择（后续可接）。
 * 语法格式：Monarch tokenizer JSON（monaco.languages.IMonarchLanguage.tokenizer 的
 * 序列化形状，与 VS Code basic-languages 同源格式）。
 */
export default function LanguageManager({ onClose }: { onClose: () => void }) {
  const defs = useLanguageStore((s) => s.defs);
  const add = useLanguageStore((s) => s.add);

  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [extensions, setExtensions] = useState("");
  const [grammar, setGrammar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const exts = extensions
      .split(/[\s,]+/)
      .map((e) => e.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    let tokenizer: unknown;
    try {
      tokenizer = JSON.parse(grammar);
    } catch {
      setError("语法 JSON 解析失败（必须为合法 JSON；如带注释请先去除）");
      return;
    }
    setBusy(true);
    const err = await add({ id, label, extensions: exts, tokenizer });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // 成功：清空表单，保留弹窗便于连续添加
    setId("");
    setLabel("");
    setExtensions("");
    setGrammar("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[80vh] w-[620px] flex-col overflow-hidden rounded-md border border-[var(--aluka-border)] bg-[var(--aluka-overlay-bg)] shadow-2xl">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--aluka-border)] px-3">
          <span className="text-[13px] font-semibold">语言高亮管理</span>
          <button
            title="关闭"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-hover)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* 已注册列表 */}
          <div className="mb-3">
            <div className="mb-1 text-[12px] text-[var(--aluka-text-dim)]">
              自定义语言（持久化于 ~/.aluka-ide/languages.json，重启后自动加载）
            </div>
            {defs.length === 0 ? (
              <div className="px-1 py-2 text-[12px] text-[var(--aluka-text-dim)]">
                暂无自定义语言
              </div>
            ) : (
              defs.map((d) => (
                <div
                  key={d.id}
                  className="group flex items-center gap-2 px-1 py-1 text-[12px] hover:bg-[var(--aluka-hover)]"
                >
                  <span className="text-[var(--aluka-text)]">{d.label}</span>
                  <span className="text-[var(--aluka-text-dim)]">
                    {d.id} · {d.extensions.map((e) => "." + e).join(" ")}
                  </span>
                  <button
                    title="移除（重启后完全生效）"
                    onClick={() => void useLanguageStore.getState().remove(d.id)}
                    className="ml-auto hidden h-5 w-5 items-center justify-center rounded hover:bg-[var(--aluka-active)] group-hover:flex"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 添加表单 */}
          <div className="border-t border-[var(--aluka-border)] pt-3">
            <div className="mb-1 text-[12px] text-[var(--aluka-text-dim)]">添加语言</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="语言 ID（如 dockerfile）"
                className="h-8 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 text-[12px] text-[var(--aluka-text)] outline-none focus:border-[var(--aluka-btn-bg)]"
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="显示名（如 Dockerfile）"
                className="h-8 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 text-[12px] text-[var(--aluka-text)] outline-none focus:border-[var(--aluka-btn-bg)]"
              />
              <input
                value={extensions}
                onChange={(e) => setExtensions(e.target.value)}
                placeholder="扩展名（空格/逗号分隔，如 dockerfile docker）"
                className="col-span-2 h-8 rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 text-[12px] text-[var(--aluka-text)] outline-none focus:border-[var(--aluka-btn-bg)]"
              />
              <textarea
                value={grammar}
                onChange={(e) => setGrammar(e.target.value)}
                placeholder={`Monarch 语法 JSON（tokenizer 对象），示例：\n{"tokenizer": {"root": [["\\\\d+", "number"], ["\\"[^\\"]*\\"", "string"]]}}`}
                className="col-span-2 h-40 resize-none rounded border border-[var(--aluka-border)] bg-[var(--aluka-input-bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--aluka-text)] outline-none focus:border-[var(--aluka-btn-bg)]"
              />
            </div>
            {error && <div className="mt-1 text-[12px] text-[#f48771]">{error}</div>}
            <div className="mt-2 flex justify-end gap-2">
              <button
                disabled={busy || !id || !label || !extensions || !grammar}
                onClick={() => void submit()}
                className="flex items-center gap-1 rounded bg-[var(--aluka-btn-bg)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--aluka-btn-hover)] disabled:opacity-40"
              >
                <Plus size={12} />
                添加
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
