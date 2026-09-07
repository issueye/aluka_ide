# Aluka IDE 需求分析文档

| 项 | 内容 |
| --- | --- |
| 文档版本 | v0.2 |
| 日期 | 2026-09-03 |
| 状态 | 基线（需求变更须更新本文档并记录变更日志） |
| 关联文档 | [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) · [TODO/](./TODO/) · [AGENTS.md](../AGENTS.md) |

---

## 1. 项目概述

### 1.1 背景

VS Code 功能全面但资源占用高（安装包 90MB+、冷启动慢、内存 500MB+）。对于"打开项目 → 浏览 → 快速修改"的高频轻量场景，需要一个秒开、低占用的编辑器。同时用户已习惯 VS Code 的界面布局与插件生态，切换成本必须足够低。

### 1.2 产品目标

1. **轻量**：冷启动 ≤ 2s；安装包 ≤ 25MB；空闲内存 ≤ 300MB。
2. **VS Code 观感**：标题栏 / 活动栏 / 侧边栏 / 编辑器组 / 面板 / 状态栏的布局、交互、快捷键与 VS Code 保持一致。
3. **插件兼容（子集）**：能安装本地 `.vsix`，兼容 VS Code 扩展清单（`package.json`）、颜色主题、命令 / 快捷键 / 代码片段（详见 §5 兼容性分级）。

### 1.3 产品定位

面向个人开发者的本地轻量 IDE："快开、快改、快查"的日常工具，以及 VS Code 插件生态的低成本入口。**不是** VS Code 的全功能替代品。

### 1.4 产品名称与标识

- 名称：**Aluka IDE**；标识符：`com.aluka.ide`；仓库目录：`aluka_ide`。

## 2. 用户与使用场景

| 画像 | 场景 | 涉及需求 |
| --- | --- | --- |
| A. 日常改配置 / 脚本的开发者 | S1 打开项目，浏览文件树，编辑并保存 | FR-01~04 |
| B. 排查问题的开发者 | S2 全局搜索关键字定位；S3 终端跑命令验证 | FR-05、FR-06 |
| C. 追求个性化的用户 | S4 换配色主题、装小插件 | FR-09、FR-10、FR-16 |
| D. 用 Git 管理代码的开发者 | S5 暂存/提交/切分支/看 Diff 后推送 | FR-11、FR-15 |

## 3. 功能需求（FR）

| 编号 | 模块 | 需求 | 优先级 | 验收要点 |
| --- | --- | --- | --- | --- |
| FR-01 | 窗口框架 | 自定义标题栏（`decorations=false`）、最小化 / 最大化 / 关闭、拖拽移动、双击最大化 | P0 | 三键可用；拖拽顺滑；无系统白边 |
| FR-02 | 布局 Shell | 活动栏 + 侧边栏 + 编辑器组 + 底部面板 + 状态栏；各区域可折叠/伸缩 | P0 | 布局对照 VS Code Dark+ 走查通过 |
| FR-03 | 资源管理器 | 打开文件夹（系统对话框）；目录树懒加载；新建文件/文件夹、重命名、删除、刷新；文件变更监听自动刷新 | P0 | 万级文件目录首屏 ≤ 500ms；CRUD 后树即时反映 |
| FR-04 | 编辑器 | Monaco 编辑器；多标签页；脏标记；保存(Ctrl+S)/另存为；常见 20+ 语言语法高亮；文件内查找替换；大文件保护；**分屏多编辑器组**（向右/向下拆分、拖拽调节、可关闭组） | P0 | 修改→保存落盘；>5MB 提示只读，>20MB 拒绝打开；分屏后两组独立标签/视图态 |
| FR-05 | 全局搜索 | 工作区文本搜索：大小写/整词/正则开关；结果按文件分组、点击跳转 | P1 | 1000 文件内搜索 < 2s；结果上限截断提示 |
| FR-06 | 终端面板 | ConPTY 原生伪控制台 + xterm 交互终端；多会话标签；默认 PowerShell（Windows）；ANSI 真彩/TUI/Tab 补全；动态 resize；Ctrl+` 开关 | P1 | 可执行常规命令并实时回显；vim 等 TUI 可交互；窗口缩放不乱版 |
| FR-07 | 命令面板 | Ctrl+Shift+P 命令、Ctrl+P 快速打开文件、Ctrl+G 转到行；子序列模糊匹配；最近使用置顶 | P0 | 所有核心命令可从面板触达 |
| FR-08 | 快捷键 | 核心集（保存/关闭标签/切换侧栏/面板/命令面板等）；允许扩展注册 | P0 | 核心集按键全部生效且不与输入冲突 |
| FR-09 | 主题引擎 | 内置 Dark+ / Light+；加载 VS Code 主题 JSON（`colors`→UI CSS 变量、`tokenColors`→Monaco rules） | P1 | 任一纯配色 VS Code 主题插件加载后 UI+编辑器配色生效 |
| FR-10 | 扩展系统 | 见 §5 兼容性分级（L1~L3 为本期） | P1 | 见 §5 各级验收 |
| FR-11 | 状态栏 | 行:列、语言、编码、EOL、git 分支（点击切换/新建分支、ahead/behind 显示）、通知气泡 | P1 | 打开文件后信息准确；git 仓库内显示分支并可切换 |
| FR-12 | 设置 | 主题、字号、自动保存等；持久化到 `~/.aluka-ide/settings.json` | P2 | 重启后设置保留 |
| FR-13 | 欢迎页 | 未打开工作区 / 未打开文件的空状态引导（打开文件夹、快捷键提示） | P2 | — |
| FR-14 | i18n | 中/英文案切换 | P2 | — |
| FR-15 | 源代码管理（Git） | SCM 侧栏：暂存区/工作区两级列表、M/A/D/U/R 状态徽标、暂存/取消暂存/放弃更改、提交框（Ctrl+Enter，空暂存区时自动全量暂存再提交）；变更文件点击开启 Monaco Diff 双栏对比；活动栏未提交数徽标；Ctrl+Shift+G；非仓库工作区可一键 `git init`；push/pull（凭证走系统 git 配置） | P1 | 暂存→提交→状态清零闭环；Diff 双栏正确；分支切换生效 |
| FR-16 | 插件市场（在线） | Open VSX 在线查询/热门推荐/一键下载，经 Rust 端安全解包安装（与本地 VSIX 同管线）；已安装/插件市场双 Tab、安装态识别、卸载；列表点击进入详情页（头部 + README 渲染：已安装读本地文件，市场经详情 API 在线拉取）；JSONC 解析兼容带注释的主题/片段文件；离线时核心编辑能力不受影响 | P2 | 在线可搜到并安装主题/命令扩展且即装即用；点击扩展可查看 README；离线仅市场 Tab 报错 |
| FR-17 | 标题栏菜单栏 | 文件/编辑/选择/查看/转到/运行/终端/帮助八个下拉菜单，全部复用命令注册表；编辑/选择菜单以活动 Monaco 编辑器为执行目标 | P0 | 八菜单可用；未打开工作区时新建/运行给出引导提示 |
| FR-18 | 运行活动文件 | 按扩展名映射运行命令（python/node/go run/cargo run/bash/powershell/cmd 等）：先保存脏文件，再开终端会话写入命令 | P2 | Python/Node 等主流文件一键运行并回显输出 |
| FR-19 | Markdown 预览 | md 文件组内编辑/预览切换（`markdown.showPreview`，Ctrl+Shift+V；组右上预览按钮；查看菜单入口）；零依赖自研渲染（标题/代码块/引用/列表/表格/行内样式）；先转义后渲染、危险 scheme 降级、图片零外联；外链点击复制地址提示 | P2 | md 文件可切换预览；编辑键入实时刷新；XSS 向量转义 |
| FR-20 | 代码跳转（文本级） | 转到定义（F12 / Ctrl+点击 / 转到菜单，单命中直跳）；查找所有引用（Shift+F12）；查看定义 Peek（Alt+F12，单命中也浮层）；工作区符号搜索（Ctrl+T）；实现为无 LSP 的定义模式索引：Rust 端按扩展名应用各语言定义正则（rust/go/python/ts/js/java/c 系）扫描工作区，`workspace:changed` 时失效重建；多定义/引用在**编辑器内 Peek 浮层**呈现（锚定光标行、按文件分组、代码上下文预览、键盘选择），命中打开并定位行列；跳转历史**后退/前进**（Alt+←/→）；光标处符号同词高亮（wordHighlighter）；LSP 级语义导航仍属范围外 | P1 | 对常见语言（rust/ts/py/go）的函数/类型符号可跳转定义；多定义 Peek 可选可跳；引用列表点击可定位；Alt+←/→ 可在跳转历史间移动；符号面板模糊过滤 |

## 4. 非功能需求（NFR）

| 编号 | 类别 | 指标 |
| --- | --- | --- |
| NFR-01 | 性能 | 冷启动 ≤ 2s；目录树首屏 ≤ 500ms（1 万文件）；编辑键入延迟无感知（< 50ms） |
| NFR-02 | 体积 | 安装包 ≤ 25MB；空闲内存 ≤ 300MB |
| NFR-03 | 安全 | VSIX 解包防 zip-slip（条目路径校验）；扩展仅能通过桥接 API 行动，无 Node/进程能力；无遥测、无外联 |
| NFR-04 | 平台 | Windows 10+ 优先交付；macOS/Linux 保持代码层可移植（验证次序靠后） |
| NFR-05 | 可维护 | 前端仅经 `src/tauri.ts` 单点调用后端命令；`npm run build`（含 tsc）与 `cargo clippy -D warnings` 零错误零警告 |
| NFR-06 | 离线 | Monaco 等全部资源本地打包，不依赖 CDN；**核心编辑能力（打开/编辑/保存/搜索/终端/本地 VSIX 安装）全功能离线可用；在线市场 Tab 为在线增值能力，离线时仅该 Tab 报错重试** |

## 5. 扩展系统与 VS Code 兼容性策略（核心需求）

VS Code API 面积极大（数百个 API + Node.js 运行时），"完全兼容"等同于复刻扩展宿主。本项目采用**分级兼容**：

| 级别 | 能力 | 兼容方式 | 状态 |
| --- | --- | --- | --- |
| L1 | 清单识别 | 解析 VS Code `package.json`：`name/publisher/version/displayName/icon/contributes/activationEvents/main` | 本期（M6） |
| L2 | 颜色主题 | `contributes.themes` → 主题 JSON 的 `colors` 映射到 UI CSS 变量、`tokenColors` 按 TextMate scope 前缀映射为 Monaco theme rules | 本期（M6） |
| L3 | 命令/快捷键/片段 | `contributes.commands/keybindings/snippets`；`main.js` 在渲染进程沙箱中执行，提供 `vscode` 兼容垫片（`commands.registerCommand`、`window.showXxxMessage`、`workspace` 读写） | 本期（M6） |
| L4 | 自定义视图 | Webview 视图容器/视图（iframe 隔离承载扩展 UI） | 规划 |
| L5 | 完整 API | 独立扩展宿主进程实现 `vscode.*` 大 API 面 + Node 能力（需捆绑 Node 运行时，与"轻量"冲突，单列为可选组件） | 远期 |

**明确不承诺**：调试器（DAP）、LSP、Remote 开发。

**安装方式**：本地 `.vsix`（zip 格式）→ Rust 端解包到 `~/.aluka-ide/extensions/<publisher>.<name>/` → 前端扫描清单并注册；**在线市场（FR-16）下载的 VSIX 字节流经 `install_vsix_bytes` 走同一安全解包管线**。

**目录约定**：全局扩展 `~/.aluka-ide/extensions/`；工作区级 `<workspace>/.aluka/extensions/`（优先级更高）。

### L2/L3 级验收标准

- 安装一个纯主题 VSIX（如 One Monokai）→ 状态栏切主题 → UI 与编辑器配色同时变化。
- 安装一个命令类示例扩展 → 命令面板可搜到并执行 `window.showInformationMessage` 弹出通知。

## 6. 范围外（Non-goals）

- VS Marketplace 账号体系、同步
- 调试器（DAP）、LSP 智能补全（Monaco 仅 Monarch 高亮）
- Remote / 容器开发、 notebooks
- 转到定义/引用等 **LSP 语义级**导航（依赖语言服务；FR-20 的文本级定义索引不算语义导航）

## 7. 技术选型与架构

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 包体/内存远优于 Electron；Rust 侧承担 IO/进程/解包 |
| 前端 | React 18 + TypeScript(strict) + Vite | 生态成熟；类型安全 |
| 样式 | TailwindCSS 4（@tailwindcss/vite） | 原子化 + CSS 变量做主题 |
| 编辑器 | Monaco Editor（本地打包，仅 editor worker） | VS Code 同源，主题/高亮兼容红利最大 |
| 终端 | ConPTY 原生伪控制台（portable-pty）+ xterm.js 交互前端 | TUI/真彩/补全必需 |
| 状态 | zustand | 轻量、无样板 |
| 图标 | lucide-react | 轻量树摇 |
| Rust crate | serde/serde_json、walkdir、notify 6、rfd、zip 2、portable-pty 0.8、trash、regex | FS/监听/对话框/VSIX 解包/伪终端/回收站/搜索 |

### 架构图

```
┌───────────────────────────────────────────────────────┐
│              WebView 前端（React + Monaco）             │
│  UI Shell：标题栏菜单栏/活动栏/侧边栏/编辑器组/面板/状态栏 │
│  命令面板 · 快捷键中枢 · 主题引擎 · 设置                 │
│  扩展宿主 v0（清单解析 + 命令/主题注册 + JS 沙箱垫片）    │
│  SCM 视图 + Diff 对比 · xterm 终端 · Open VSX 市场面板   │
└───────────────▲───────────────────────▲───────────────┘
                │  invoke（命令）         │  emit（事件：终端输出/文件变更）
┌───────────────┴───────────────────────┴───────────────┐
│                   Rust Core（Tauri 2）                 │
│  目录树/文件读写 · notify 监听 · walkdir 全局搜索        │
│  ConPTY 终端会话（portable-pty + 读线程）· VSIX 解包(zip) │
│  文件夹对话框(rfd) · git 全命令集（status/commit/分支等） │
└───────────────────────────────────────────────────────┘
```

**目录约定**：`~/.aluka-ide/{extensions, settings.json, logs}`；工作区 `<workspace>/.aluka/`。

## 8. 风险与对策

| 编号 | 风险 | 对策 |
| --- | --- | --- |
| R1 | VS Code API 面巨大导致兼容泥潭 | 严格按 L1~L5 分级，本期只做 L1~L3 并明示不兼容清单 |
| R2 | Monaco 体积拖累"轻量" | 仅打 editor worker；语言 worker 不引入；资源本地化 |
| R3 | 管道终端无 TTY（无颜色/交互程序不可用） | 已解决：ConPTY（portable-pty）+ xterm，直连 PTY 输出 |
| R4 | rfd 对话框阻塞命令线程 | `spawn_blocking` + 异步 invoke |
| R5 | 大文件/二进制文件拖垮编辑器 | 读取前探测：>5MB 只读、>20MB 拒绝、含 NUL 判定二进制 |
| R6 | WebView2 版本差异 | Vite 固定 `target: chrome105`；关键路径人工冒烟清单 |
| R7 | 扩展沙箱弱（`new Function` 可触达全局对象） | 仅暴露 commands/window/workspace 只读 API 面；写路径不开放；完整 Worker/iframe 隔离属 L4+ |
| R8 | Git 大仓库 `status -uall` 偏慢、push/pull 无凭证 UI | 后台线程执行不卡 UI；失败走通知提示；大仓库进度提示与凭证表单留后续版本 |

## 9. 验收与度量

- 每个里程碑走查对应 FR 验收要点（见 DEVELOPMENT_PLAN.md 质量门）。
- 性能指标以Release 构建 + Windows 10 实测为准，记录在当日 TODO 的"验证记录"。

## 变更日志

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-09-02 | v0.1 | 初版基线 |
| 2026-09-03 | v0.2 | 超基线转正：新增 FR-15（Git SCM）、FR-16（在线市场）、FR-17（菜单栏）、FR-18（运行活动文件）；FR-04 补分屏、FR-06 改 ConPTY 真终端、FR-11 补分支菜单；NFR-06 明确在线市场为在线增值能力；§6 范围外移除 Git 完整视图与在线市场；架构图/Rust 依赖表/风险 R7~R8 同步 |
| 2026-09-03 | v0.2.1 | 新增 FR-19（Markdown 预览）：组内编辑/预览切换、零依赖安全渲染、外链复制提示 |
| 2026-09-03 | v0.2.2 | 扩展体验补齐：T6 JSONC 解析修复（带注释主题/片段不再激活失败）；FR-16 补扩展详情页（列表点击看 README，已安装读本地/市场在线拉取） |
| 2026-09-03 | v0.2.3 | 扩展沙箱"宽容兜底"升级（T9）：`require("vscode")`/CommonJS/`process` 垫片；互操作键快照通告（VS Code API 150+ / Node 内建 90+）；未实现 API 以可调用可构造的宽容对象兜底并计数提示；文档/输入/标签组类 API 提供真实最小桩。Mermaid 真实 bundle 全量激活（59 命令，35 API 降级） |
| 2026-09-03 | v0.2.4 | 扩展优化批次（T10）：VSIX 在线安装改原始 IPC 载荷（Raw body 直传，防 JSON 数组膨胀）+ 下载进度百分比；市场更新检测（isNewerVersion）与一键升级按钮；卸载热清理（命令/主题/片段 provider 即时反注册）；片段触发去掉硬编码字符；本地 VSIX 安装即时激活；README 相对图片 base64 内联渲染（新命令 read_extension_file_bytes，零外联） |
| 2026-09-03 | v0.2.5 | 新增 FR-20 代码跳转（文本级）：Rust `find_workspace_symbols` 定义模式索引（按扩展名应用各语言定义正则，跳过重目录/隐藏目录/大文件，结果上限截断）；前端转到定义（F12 / Ctrl+点击）/查找所有引用（Shift+F12）/工作区符号面板（Ctrl+T）；多候选列表选择、命中定位行列；`workspace:changed` 失效重建。§6 范围外措辞同步（LSP 语义级导航仍范围外） |
| 2026-09-07 | v0.2.6 | FR-20 跳转重构（参考 VS Code 导航设计）+ 预览标签页：多定义/引用改编辑器内 Peek 浮层（跳转逻辑拆出 navigation.ts/navigationStore.ts/PeekView.tsx，jump 面板模式移除）；新增后退/前进（Alt+←/→）跳转历史栈、查看定义 Peek（Alt+F12）、光标处符号同词高亮（Monaco wordHighlighter 贡献，纯文本词匹配无 LSP）；引用升级列级定位；新增预览标签语义（EditorTab.preview，对齐 VS Code enablePreview：单击斜体预览、未修改原位替换、变脏/双击/「保持打开」转常驻）。FR-20 措辞同步 |
