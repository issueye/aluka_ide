/**
 * 零依赖 Markdown 渲染器（轻量：不引入 marked 等重型依赖，离线可用）。
 * 支持：ATX/Setext 标题、围栏代码块、引用、列表（含任务项与嵌套）、表格、分割线、段落；
 * 行内：行内代码、加粗、斜体、删除线、链接、自动链接、裸 URL。
 * 安全模型：先转义 HTML 再应用行内规则；链接仅 http/https/mailto 与 # 锚点可用，
 * 其余 scheme 降级为纯文本；图片不加载外部资源，仅渲染占位（NFR-03 无外联）。
 */

/** 占位符前后缀：私有区字符 + 序号，避免与用户文本冲突 */
const HOLD_OPEN = "md";
const HOLD_CLOSE = "";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isClickableHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

function hasScheme(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
}

/** 行内渲染：代码 span 与链接先占位，转义后再做加粗/斜体，最后还原 */
function renderInline(raw: string): string {
  const stash: string[] = [];
  const hold = (html: string): string => {
    stash.push(html);
    return `${HOLD_OPEN}${stash.length - 1}${HOLD_CLOSE}`;
  };

  // 行内代码：内容仅转义，不再参与行内规则
  let s = raw.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code) =>
    hold(`<code>${escapeHtml(code)}</code>`),
  );

  // 图片：data:URL 内联渲染（本地 base64，零外联）；其余一律占位不发网络请求
  s = s.replace(
    /!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g,
    (_m, alt, href) => {
      const safeAlt = escapeHtml(alt);
      if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(href)) {
        return hold(
          `<img class="md-img-inline" alt="${safeAlt}" src="${escapeHtml(href)}"/>`,
        );
      }
      return hold(`<span class="md-img">[图片：${safeAlt}]</span>`);
    },
  );

  // 链接 [text](href)：http(s)/mailto 渲染可点击锚点；# 锚点与相对路径渲染不可跳转文本
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g, (m, text, href) => {
    void m;
    if (isClickableHref(href)) {
      const safe = escapeHtml(href);
      return hold(`<a class="md-link" title="${safe}">${escapeHtml(text)}</a>`);
    }
    if (hasScheme(href)) return escapeHtml(text);
    return hold(
      `<span class="md-link" title="${escapeHtml(href)}">${escapeHtml(text)}</span>`,
    );
  });

  // 自动链接 <https://...> / <mailto:...>
  s = s.replace(/<(https?:\/\/[^<>\s]+|mailto:[^<>\s]+)>/g, (_m, url) =>
    hold(`<a class="md-link" title="${escapeHtml(url)}">${escapeHtml(url)}</a>`),
  );

  // 裸 URL（末尾标点不纳入链接）
  s = s.replace(/(https?:\/\/[^\s<>()[\]`"']+)/g, (m) => {
    const trail = m.match(/[.,;:!?]+$/)?.[0] ?? "";
    const url = m.slice(0, m.length - trail.length);
    if (!url) return m;
    return (
      hold(`<a class="md-link" title="${escapeHtml(url)}">${escapeHtml(url)}</a>`) +
      escapeHtml(trail)
    );
  });

  s = escapeHtml(s);

  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>");
  s = s.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");

  s = s.replace(/md(\d+)/g, (_m, idx) => stash[Number(idx)] ?? "");
  return s;
}

/* ---------------- 块级解析 ---------------- */

function splitRow(row: string): string[] {
  let t = row.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

function tryTable(
  lines: string[],
  i: number,
): { html: string; next: number } | null {
  const head = lines[i] ?? "";
  if (!head.includes("|")) return null;
  if (!isDelimiterRow(lines[i + 1] ?? "")) return null;
  const delim = splitRow(lines[i + 1] ?? "");
  const heads = splitRow(head);
  let j = i + 2;
  const rows: string[][] = [];
  while (
    j < lines.length &&
    !/^\s*$/.test(lines[j] ?? "") &&
    (lines[j] ?? "").includes("|")
  ) {
    rows.push(splitRow(lines[j] ?? ""));
    j++;
  }
  const cell = (tag: string, c: string, k: number): string => {
    const a = alignOf(delim[k] ?? "");
    return `<${tag}${a ? ` align="${a}"` : ""}>${renderInline(c)}</${tag}>`;
  };
  const thead = `<thead><tr>${heads.map((c, k) => cell("th", c, k)).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c, k) => cell("td", c, k)).join("")}</tr>`).join("")}</tbody>`;
  return { html: `<table>${thead}${tbody}</table>`, next: j };
}

interface ListNode {
  ordered: boolean;
  task: boolean | null;
  text: string;
  indent: number;
  children: ListNode[];
}

function renderLevel(items: ListNode[]): string {
  const groups: ListNode[][] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && (g[0]?.ordered ?? false) === it.ordered) g.push(it);
    else groups.push([it]);
  }
  return groups
    .map((g) => {
      const tag = (g[0]?.ordered ?? false) ? "ol" : "ul";
      const lis = g
        .map((it) => {
          const check =
            it.task === null
              ? ""
              : `<input type="checkbox" disabled${it.task ? " checked" : ""}/> `;
          const kids = it.children.length > 0 ? renderLevel(it.children) : "";
          return `<li>${check}${renderInline(it.text)}${kids}</li>`;
        })
        .join("");
      return `<${tag}>${lis}</${tag}>`;
    })
    .join("");
}

function parseList(
  lines: string[],
  start: number,
): { html: string; next: number } {
  const itemRe = /^(\s*)([-+*]|\d{1,9}[.)])\s+(.*)$/;
  const raws: { indent: number; ordered: boolean; task: boolean | null; text: string[] }[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line)) {
      // 松散列表：空行后仍是列表项则跳过空行继续，否则列表结束
      if (itemRe.test(lines[i + 1] ?? "")) {
        i++;
        continue;
      }
      break;
    }
    const m = line.match(itemRe);
    if (m) {
      const indent = (m[1] ?? "").replace(/\t/g, "  ").length;
      const ordered = /^\d/.test(m[2] ?? "");
      let rest = m[3] ?? "";
      let task: boolean | null = null;
      const tm = rest.match(/^\[([ xX])\]\s+(.*)$/);
      if (tm) {
        task = (tm[1] ?? "").toLowerCase() === "x";
        rest = tm[2] ?? "";
      }
      raws.push({ indent, ordered, task, text: [rest] });
      i++;
    } else {
      const last = raws[raws.length - 1];
      if (!last || /^\S/.test(line)) break;
      last.text.push(line.trim());
      i++;
    }
  }
  // 按缩进组树
  const root: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const r of raws) {
    const node: ListNode = {
      ordered: r.ordered,
      task: r.task,
      text: r.text.filter((t) => t !== "").join(" "),
      indent: r.indent,
      children: [],
    };
    while (stack.length > 0 && r.indent <= (stack[stack.length - 1]?.indent ?? 0)) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else root.push(node);
    stack.push(node);
  }
  return { html: renderLevel(root), next: i };
}

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (/^(\s*)([-+*]|\d{1,9}[.)])\s+/.test(line)) return true;
  if (line.includes("|") && isDelimiterRow(lines[i + 1] ?? "")) return true;
  return false;
}

/** Markdown 源文 → 安全 HTML（调用方经 dangerouslySetInnerHTML 呈现） */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+#-]*)\s*$/);
    if (fence) {
      const mark = fence[2] ?? "```";
      const lang = (fence[3] ?? "").toLowerCase();
      const fenceChar = mark[0] === "`" ? "`" : "~";
      const closeRe = new RegExp(`^\\s*${fenceChar}{${mark.length},}\\s*$`);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // 跳过结束围栏（未闭合时自然越过末尾，循环结束）
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : "";
      out.push(
        `<div class="md-codeblock">${label}<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre></div>`,
      );
      continue;
    }

    // ATX 标题
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = (h[1] ?? "#").length;
      out.push(`<h${level}>${renderInline(h[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }

    // 引用块（递归渲染内部）
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*> ?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // 表格
    const table = tryTable(lines, i);
    if (table) {
      out.push(table.html);
      i = table.next;
      continue;
    }

    // 列表
    if (/^(\s*)([-+*]|\d{1,9}[.)])\s+/.test(line)) {
      const r = parseList(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // 段落（单行 + ===/--- 视为 Setext 一/二级标题）
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i] ?? "") && !isBlockStart(lines, i)) {
      buf.push(lines[i] ?? "");
      i++;
    }
    if (buf.length === 1 && /^\s*=+\s*$/.test(lines[i] ?? "")) {
      out.push(`<h1>${renderInline(buf[0] ?? "")}</h1>`);
      i++;
    } else if (buf.length === 1 && /^\s*-+\s*$/.test(lines[i] ?? "")) {
      out.push(`<h2>${renderInline(buf[0] ?? "")}</h2>`);
      i++;
    } else {
      out.push(`<p>${renderInline(buf.join("\n"))}</p>`);
    }
  }
  return out.join("\n");
}
