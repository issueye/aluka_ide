# TODO 2026-09-03（Day 2 · 文档收口 M8 超基线）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-03 |
| 关联里程碑 | M8 超基线收口（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-04/06/11/15/16/19、NFR-06（见 [REQUIREMENTS.md](../../REQUIREMENTS.md)） |

## 今日目标（总）

1. 将已落地的 5 项超基线能力回写需求与计划基线，消除"代码超前、文档停留 v0.1.0"漂移。
2. 明确范围边界：Git SCM 与在线市场转正为正式需求；调试器/LSP/Remote 仍为范围外。
3. 质量门：两份基线文档相互引用一致，当日 TODO 闭环。
4. 新增 Markdown 文档预览模式（FR-19）：组内编辑/预览切换、零依赖安全渲染。

## 任务清单

### T1 建立今日 TODO ✅

- **具体目标**：复制模板建立 `TODO_20260903/README.md`，列出文档收口目标与验收标准。
- **验收标准**：
  - [x] 本文件创建并关联 M8 与 FR/NFR 编号

### T2 回写 REQUIREMENTS.md（v0.1 → v0.2）✅

- **具体目标**：Git SCM（FR-15）与在线市场（FR-16）转正；FR-04 补分屏、FR-06 补 ConPTY+xterm、FR-11 补分支菜单、新增菜单栏/运行文件需求；NFR-06 明确在线市场为"在线增值、离线核心可用"；§6 范围外同步收缩；架构图与风险表补齐。
- **验收标准**：
  - [x] 文档版本升为 v0.2，变更日志追加转正条目
  - [x] FR-15/FR-16 新增且验收要点可测
  - [x] §6 不再把"Git 完整视图/在线市场"列为范围外
  - [x] NFR-06 离线口径与市场 Tab 行为一致

### T3 回写 DEVELOPMENT_PLAN.md（补 M8）✅

- **具体目标**：新增 M8 超基线里程碑（分屏/ConPTY/Git/市场/菜单五项），更新总体状态、MVP 定义说明、变更管理表。
- **验收标准**：
  - [x] 里程碑总表含 M8 且状态 ✅ 09-03
  - [x] M8 拆分小节与验收标准齐全
  - [x] 变更管理追加 v0.2 条目

### T4 一致性验证 ✅

- **具体目标**：交叉核对三处一致：REQUIREMENTS FR 编号 ↔ DEVELOPMENT_PLAN M8 ↔ 本 TODO 关联需求；确认无新增代码改动（纯文档任务）。
- **验收标准**：
  - [x] `git status` 仅三份文档变更（本文件 + 两份基线）
  - [x] 两份基线相互引用版本号一致（均为 v0.2，日期 2026-09-03）

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 2026-09-03 | `git status --short` | ✅ | 仅 `.work/REQUIREMENTS.md`、`DEVELOPMENT_PLAN.md` 修改 + `TODO_20260903/` 新增，无代码改动（纯文档任务） |
| 2026-09-03 | FR 编号交叉核对 | ✅ | REQUIREMENTS FR-15~18 ↔ PLAN M8 拆分 ↔ 本 TODO T2/T3 目标一致；两份基线均为 v0.2 |
| 2026-09-03 | T11 质量门 | ✅ | `npm run build`（tsc strict）通过；`cargo clippy -- -D warnings` 零代码警告（仅增量缓存环境噪音）；`cargo fmt` 干净；`cargo test` 10/10（含 6 例符号定义正则） |
| 2026-09-03 | T11 UI 走查（部分） | ✅ | dev 实测：转到菜单三项（转到定义 F12 / 查找所有引用 Shift+F12 / 转到工作区中的符号 Ctrl+T）渲染与快捷键提示正确；打开本项目工作区联动正常（标题/状态栏/活动栏 14 变更徽标） |
| 2026-09-03 | T11 UI 走查（键盘链路） | ✅ | 桌面解锁后复测：Ctrl+T 过滤 "gotoDefinition" → 回车跳转 commands.ts:332 列 23（符号名首字符）；Shift+F12 列出 4 处引用 → 回车跳 CodeEditor.tsx:15；两个缺陷（索引高频清空/扫描未剪枝）修复后复验通过；F12/Ctrl+点击同链路复用留日常复核 |
| 2026-09-03 | T11 走查期间数据安全核查 | ✅ | 自动化按键一次落空引发疑虑，`git diff` 全量核查 13 个变更文件：无任何误插入/误改（含空行级检查），diff 全部为本次功能有意改动 |

## 未决问题与次日移交

- Git push/pull 无凭证 UI、市场 Tab 离线无缓存降级、大仓库 status 性能：已记入 REQUIREMENTS 风险/未决，不在本次文档收口解决。

## 追加任务（Markdown 预览模式 · FR-19）

### T5 Markdown 预览 ✅

- **具体目标**：md/markdown 文件组内编辑/预览切换——`editorStore.previewPaths` 存预览态 + `togglePreview`/`isMarkdownPath`；`MarkdownPreview.tsx` 订阅 model 内容实时刷新；命令 `markdown.showPreview`（Ctrl+Shift+V）+ 组右上预览按钮 + 查看菜单入口；`src/markdown.ts` 零依赖安全渲染；`index.css` 预览排版跟随主题变量。
- **安全取舍**：先转义 HTML 再应用行内规则；链接仅 http(s)/mailto 可点击（点击复制地址 + toast，不直接跳转，零依赖不引入 opener 插件）；`javascript:` 等危险 scheme 降级纯文本；图片零外联仅占位。
- **验收标准**：
  - [x] `npm run build`（tsc strict + vite）通过；`cargo check` 通过（零 Rust 改动）
  - [x] 渲染器冒烟测试：标题/任务列表/表格/代码块/引用/XSS 转义/危险链接降级全部正确
  - [x] REQUIREMENTS 新增 FR-19 + v0.2.1 变更日志；README 功能总览与快捷键表同步
- **过程中修复的缺陷**：链接正则 `[^)\s]+` 截断含括号 href（如 `javascript:alert(1)`、wiki 词条），改为支持一层括号的 `(?:[^()\s]|\([^()]*\))+`，复测通过。

### T6 扩展 JSONC 解析修复 ✅

- **背景**：安装 Mermaid 扩展（`mermaidchart.vscode-mermaid-chart`）后报"激活失败：SyntaxError: Unexpected token '/'"。根因 = 扩展主题 `mermaid-dark-color-theme.json` 含 `//` 行尾注释（VS Code 生态惯例的 JSONC），激活流程 `registry.ts` 直接 `JSON.parse` 导致整扩展激活中断。
- **修复**：`manifest.ts` 新增 `parseJsonc`（状态机扫描：字符串内原样保留，字符串外剥离 `//` 与 `/* */` 注释、删除尾逗号）；`registry.ts` 主题与片段两处解析切换为 `parseJsonc`，主题文件损坏时跳过该主题不中断激活。
- **验收标准**：
  - [x] 冒烟测试：原生 `JSON.parse` 在 Mermaid 真实主题文件上复现报错；`parseJsonc` 成功解析（tokenColors 20 条）；字符串内 `//` 与尾逗号形内容原样保留
  - [x] `npm run build`（tsc strict + vite）通过

### T7 扩展详情页（点击看 README）✅

- **具体目标**：扩展侧栏列表 → 详情两级视图。新增 `MarkdownBody.tsx`（静态 md 渲染，复用 `renderMarkdown` 与外链复制语义）、`ExtensionDetail.tsx`（头部图标/名称/版本/来源 + 启用/禁用/卸载/安装操作 + 返回）；`ExtensionsView` 列表项可点击进入（操作按钮 stopPropagation 防误触，Tab 切换/卸载后自动退回列表）；已安装读本地 README（大小写变体兜底），市场经 Open VSX 详情 API（`fetchReadme`）在线拉取。
- **验收标准**：
  - [x] `npm run build`（tsc strict + vite）通过
  - [x] REQUIREMENTS FR-16 补详情页描述 + v0.2.2 变更日志
- **人工走查待确认**：点击已安装 Mermaid 扩展看 README 渲染；点击市场扩展看在线 README；详情页安装/卸载/启用操作正常。

### T8 扩展沙箱 CommonJS 兼容 ✅

- **背景**：JSONC 修复后 Mermaid 仍报"激活失败：ReferenceError: module is not defined"。根因 = 其 `main`（`out/extension.js`）是 esbuild 打包的 CommonJS bundle，使用 `module.exports.activate` 入口，而沙箱 `new Function("vscode", …)` 只注入 `vscode`，无 `module/exports`。
- **修复**：`runSandboxed` 补 `module = {exports:{}}` / `exports` 垫片，执行后取 `module.exports`；若存在 `activate` 函数则以扩展上下文调用之（返回 Promise 时 catch 转 warning 通知）；入口执行/activate 异常分别包装为"入口执行失败"/"activate 失败"可读错误。
- **验收标准**：
  - [x] 冒烟测试：老风格直调（示例 hello-command）不受影响；CJS bundle 的 `activate` 被调用；空入口静默通过；`require("vscode")` 风格明确抛错（下一步兼容点）
  - [x] `npm run build`（tsc strict + vite）通过
- **遗留**：`require("vscode")` 风格的扩展仍不支持（需沙箱注入 `require` 垫片），遇到的扩展可按个案加白名单；Mermaid 的图表渲染/Webview 能力属 L4，本期仅主题/命令可用。

### T9 扩展沙箱"宽容兜底"升级（Mermaid 全量激活）✅

- **背景**：`require("vscode")` 垫片后 Mermaid 仍逐层报错——`Class extends value undefined`（esbuild `__toCommonJS` 键快照 + Proxy `ownKeys` 未通告 → `ha.TreeItem` 字面 undefined）、`randomUUID`（same，Node 内建模块）、`vscode.chat.createChatParticipant`（名单缺新命名空间）、`this.xxx.onDidChangeDirty is not a function`（construct 返回普通 {} 实例链 undefined）、`tabGroups.all is not iterable`（宽容对象无 Symbol.iterator）、`source is not a string`（宽容对象流入 antlr 解析器）。
- **修复**（`src/extHost/registry.ts`）：
  - `withFallback` 递归宽容 Proxy（真实现优先、未知成员返回可调用/可构造/可迭代的宽容对象，coercion 得空串）；`construct` 返回宽容对象；`Symbol.iterator` 空迭代；
  - `ownKeys`/`getOwnPropertyDescriptor` 通告 VS Code 稳定 API 导出名（150+）与 Node 内建常用成员（90+），打通 esbuild/webpack 互操作快照；`__esModule`/`default` 自引用；
  - `require` 垫片：vscode→真垫片、process→真实 shim（env/platform/nextTick），其余 Node 内建→宽容兜底；
  - 真实最小桩替代宽容对象：`stubDocument`（getText→""）、`activeTextEditor: null`、`tabGroups.all: []`、showInputBox/QuickPick→undefined、registerXxx→DisposableStub；
  - 降级计数上报：激活后 toast 提示"N 个不受支持的 API 以空实现兜底（相关功能不可用）"。
- **验收标准**：
  - [x] **真实 Mermaid bundle 端到端**：入口执行通过、`activate` 无拒真、59 个 `mermaidChart.*` 命令注册成功、35 个 API 降级（跳式 churn 全灭，含 antlr 解析器存活）
  - [x] `npm run build`（tsc strict + vite）通过
- **边界说明**：宽容兜底保"激活与命令可用"，未实现 API（Webview 预览、git 集成、chat 等）对应功能不可用并如实提示；完整隔离/L5 仍在 REQUIREMENTS 范畴外。

### T10 扩展功能优化批次（六项）✅

- **具体目标**：
  1. **VSIX 在线安装原始 IPC 载荷**：`install_vsix_bytes` 改收 `tauri::ipc::Request`（Raw body），JS 侧 `invoke(cmd, bytes)` 直传 Uint8Array——5MB 包不再膨胀成几十 MB JSON 数组；同时兼容旧 JSON 数组格式；
  2. **下载进度**：fetch 流式读取 + `downloadProgress` store 字段，安装按钮显示"安装中 xx%"（content-length 缺失时不显示百分比）；
  3. **更新检测**：`isNewerVersion` 语义化比较（忽略 v 前缀/预发布后缀），市场列表/详情页对已安装且过期的扩展显示 `v旧 → v新 + 更新` 按钮（覆盖安装管线一键升级）；
  4. **卸载热清理**：`registry.ts` 按扩展追踪命令/主题/片段 provider，新增 `unloadExtension(extId)`——卸载即时反注册命令面板条目、摘除 completion provider、允许重装重新激活，不再残留到重启；
  5. **片段触发修复**：去掉硬编码 `triggerCharacters: ["@","#"]`，Monaco 键入即按 prefix 过滤触发，贴近 VS Code 行为；
  6. **README 本地图片内联**：新 Rust 命令 `read_extension_file_bytes`（二进制安全 + zip-slip 同防护），`ExtensionDetail` 把 README 中扩展目录内相对图片转 base64 data-URL，`markdown.ts` 对 `data:image/*` 渲染真实 `<img>`（零外联），其余仍占位。
- **验收标准**：
  - [x] `npm run build`（tsc strict + vite）通过；`cargo check` 通过（新命令已注册 invoke_handler）
  - [x] 冒烟测试：markdown data-URL 内联/外链占位/危险 data:text/html 拒绝 ✓；isNewerVersion 6 例 ✓
  - [x] REQUIREMENTS 变更日志 v0.2.4；README 扩展条目同步
- **人工走查待确认**：安装 Mermaid 观察下载百分比；市场列表找已安装扩展看更新按钮；卸载扩展后命令面板即时消失；打开带图片的扩展 README 看内联渲染。

## 追加任务（代码跳转 · FR-20 / M9）

### T11 代码跳转（转到定义 / 查找引用 / 工作区符号）🔄

- **背景**：用户提出"生成代码跳转需要的内容"。原 §6 将"转到定义"整体列为范围外，本次按 AGENTS 约定先改基线（REQUIREMENTS FR-20 + §6 措辞收缩 + PLAN M9），把 **LSP 语义级导航**留在范围外，落地**文本级定义模式索引**（符合轻量红线，零新增依赖）。
- **具体目标**：
  - Rust `symbols.rs`（新模块）：`find_workspace_symbols` —— walkdir（复用 EXCLUDED_DIRS + 隐藏目录过滤）+ 按扩展名应用各语言定义正则（rust/go/python/ts/js/java/c 系），返回 path/line/col/name/kind；>1MB 文件跳过；全局 4000 条截断；定义正则单测锁定；
  - 前端 `symbolsStore.ts`（新）：索引缓存（root 键控 + `workspace:changed` 失效重建）+ jump 候选列表状态；
  - `requestReveal` 扩展支持列号定位；`CommandPalette` 新增 symbols（Ctrl+T 模糊过滤）与 jump（多候选选择）两种模式；
  - 命令三入口：`editor.action.revealDefinition`（F12 / Ctrl+点击）、`editor.action.findReferences`（Shift+F12，复用 search_workspace 整词搜索）、`workbench.action.showWorkspaceSymbols`（Ctrl+T）；转到菜单补三项。
- **边界**：不做类型解析/重载区分/import 解析；多语言同名符号以列表呈现由用户选择；F12 在 dev 构建（devtools 开启）会同时触发 DevTools 弹出，release 无此问题（记入未决）。
- **实现**：
  - Rust `symbols.rs`：`find_workspace_symbols`（walkdir + EXCLUDED_DIRS + 隐藏目录过滤 + >1MB 跳过；按扩展名编译"定义形态"正则集 rust/go/python/ts/js/java-kt-cs/c 系；返回 path/line/col/name/kind，col 按字符计与 Monaco 对齐；全局 4000 条截断）；6 例定义正则单测（含 C 系控制流噪声排除、中文行内列号字符计）。
  - 前端 `symbolsStore.ts`（索引缓存 root 键控 + jump 候选列表）；`tauri.ts` 类型化封装；`requestReveal`/CodeEditor reveal 链路扩展列号定位；`CommandPalette` 新增 symbols（fuzzyScore 过滤）与 jump（子串过滤）两种模式；`App` 在 `workspace:changed` 时失效索引。
  - 命令：`editor.action.revealDefinition`（F12）、`editor.action.findReferences`（Shift+F12，复用 search_workspace 整词搜索）、`workbench.action.showWorkspaceSymbols`（Ctrl+T）；转到菜单补三项；CodeEditor Ctrl+点击复用 `gotoDefinitionForWord`。
- **过程中发现并修复的缺陷（2 处）**：
  - ① **符号索引被高频清空**：初版 `workspace:changed` → 直接置空索引；dev 场景（vite/target 产物持续写入工作区）下事件高频触发，面板打开后索引即刻丢失（表现为"尚未构建符号索引"）。修复：失效改为**标记 stale + 保留旧索引供查询**，下次 ensureIndex 惰性重建（连续变动天然防抖，跳转用旧索引仅可能轻微过时）。
  - ② **扫描未在 walker 层剪枝**：初版对排除目录"遍历到再 continue"，WalkDir 仍递归进入 node_modules/.git，`MAX_FILES` 配额被依赖目录耗尽，扫描返回空（第二次 dev 启动后复现）。修复：改用 `filter_entry` 在 walker 层剪枝（与 search.rs 同规则），配额只消耗在有效源码文件。
- **验收标准**：
  - [x] Ctrl+T 符号面板：输入 "gotoDefinition" 精准过滤出 gotoDefinitionForWord/gotoDefinition 两条（commands.ts:332/366），回车跳转 commands.ts:332，**状态栏"行 332，列 23"**（列号定位到符号名首字符，col 扩展生效）
  - [x] Shift+F12 查找引用：光标于 gotoDefinitionForWord 定义行 → 候选列表 4 条（CodeEditor.tsx:15 import、:146 调用、commands.ts:332 定义、:367 调用，含行内容摘要+相对路径:行号），回车第一条跳转 CodeEditor.tsx:15（状态栏"行 15"）
  - [ ] F12 / Ctrl+点击：与已验证链路共用 wordAtCursor + gotoDefinitionForWord + jumpTo（Shift+F12 已验证 wordAtCursor 取词正确）；F12 hub 分发注册正确，Ctrl+点击为同函数复用，留待日常使用复核
  - [x] 已知小瑕疵（记录不阻塞）：同一文件内二次跳转后状态栏行列偶发显示上次位置（setSelection 与视图态恢复时序），实际跳转目标文件/行正确
  - [x] `cargo test` 定义正则单测通过（10/10 全绿）；`npm run build`、`cargo clippy -D warnings`、`cargo fmt` 全绿
