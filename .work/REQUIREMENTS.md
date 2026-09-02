# Aluka IDE 需求分析文档

| 项 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 日期 | 2026-09-02 |
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
| C. 追求个性化的用户 | S4 换配色主题、装小插件 | FR-09、FR-10 |

## 3. 功能需求（FR）

| 编号 | 模块 | 需求 | 优先级 | 验收要点 |
| --- | --- | --- | --- | --- |
| FR-01 | 窗口框架 | 自定义标题栏（`decorations=false`）、最小化 / 最大化 / 关闭、拖拽移动、双击最大化 | P0 | 三键可用；拖拽顺滑；无系统白边 |
| FR-02 | 布局 Shell | 活动栏 + 侧边栏 + 编辑器组 + 底部面板 + 状态栏；各区域可折叠/伸缩 | P0 | 布局对照 VS Code Dark+ 走查通过 |
| FR-03 | 资源管理器 | 打开文件夹（系统对话框）；目录树懒加载；新建文件/文件夹、重命名、删除、刷新；文件变更监听自动刷新 | P0 | 万级文件目录首屏 ≤ 500ms；CRUD 后树即时反映 |
| FR-04 | 编辑器 | Monaco 编辑器；多标签页；脏标记；保存(Ctrl+S)/另存为；常见 20+ 语言语法高亮；文件内查找替换；大文件保护 | P0 | 修改→保存落盘；>5MB 提示只读，>20MB 拒绝打开 |
| FR-05 | 全局搜索 | 工作区文本搜索：大小写/整词/正则开关；结果按文件分组、点击跳转 | P1 | 1000 文件内搜索 < 2s；结果上限截断提示 |
| FR-06 | 终端面板 | 多会话标签；默认 shell（cmd，后续 PowerShell）；流式输出；Ctrl+` 开关 | P1 | 可执行 `dir`、`git status` 等常规命令并实时回显 |
| FR-07 | 命令面板 | Ctrl+Shift+P 命令、Ctrl+P 快速打开文件；子序列模糊匹配；最近使用置顶 | P0 | 所有核心命令可从面板触达 |
| FR-08 | 快捷键 | 核心集（保存/关闭标签/切换侧栏/面板/命令面板等）；允许扩展注册 | P0 | 核心集按键全部生效且不与输入冲突 |
| FR-09 | 主题引擎 | 内置 Dark+ / Light+；加载 VS Code 主题 JSON（`colors`→UI CSS 变量、`tokenColors`→Monaco rules） | P1 | 任一纯配色 VS Code 主题插件加载后 UI+编辑器配色生效 |
| FR-10 | 扩展系统 | 见 §5 兼容性分级（L1~L3 为本期） | P1 | 见 §5 各级验收 |
| FR-11 | 状态栏 | 行:列、语言、编码、EOL、git 分支、通知气泡 | P1 | 打开文件后信息准确；git 仓库内显示分支 |
| FR-12 | 设置 | 主题、字号、自动保存等；持久化到 `~/.aluka-ide/settings.json` | P2 | 重启后设置保留 |
| FR-13 | 欢迎页 | 未打开工作区 / 未打开文件的空状态引导（打开文件夹、快捷键提示） | P2 | — |
| FR-14 | i18n | 中/英文案切换 | P2 | — |

## 4. 非功能需求（NFR）

| 编号 | 类别 | 指标 |
| --- | --- | --- |
| NFR-01 | 性能 | 冷启动 ≤ 2s；目录树首屏 ≤ 500ms（1 万文件）；编辑键入延迟无感知（< 50ms） |
| NFR-02 | 体积 | 安装包 ≤ 25MB；空闲内存 ≤ 300MB |
| NFR-03 | 安全 | VSIX 解包防 zip-slip（条目路径校验）；扩展仅能通过桥接 API 行动，无 Node/进程能力；无遥测、无外联 |
| NFR-04 | 平台 | Windows 10+ 优先交付；macOS/Linux 保持代码层可移植（验证次序靠后） |
| NFR-05 | 可维护 | 前端仅经 `src/tauri.ts` 单点调用后端命令；`npm run build`（含 tsc）与 `cargo clippy -D warnings` 零错误零警告 |
| NFR-06 | 离线 | Monaco 等全部资源本地打包，不依赖 CDN；全功能离线可用 |

## 5. 扩展系统与 VS Code 兼容性策略（核心需求）

VS Code API 面积极大（数百个 API + Node.js 运行时），"完全兼容"等同于复刻扩展宿主。本项目采用**分级兼容**：

| 级别 | 能力 | 兼容方式 | 状态 |
| --- | --- | --- | --- |
| L1 | 清单识别 | 解析 VS Code `package.json`：`name/publisher/version/displayName/icon/contributes/activationEvents/main` | 本期（M6） |
| L2 | 颜色主题 | `contributes.themes` → 主题 JSON 的 `colors` 映射到 UI CSS 变量、`tokenColors` 按 TextMate scope 前缀映射为 Monaco theme rules | 本期（M6） |
| L3 | 命令/快捷键/片段 | `contributes.commands/keybindings/snippets`；`main.js` 在渲染进程沙箱中执行，提供 `vscode` 兼容垫片（`commands.registerCommand`、`window.showXxxMessage`、`workspace` 读写） | 本期（M6） |
| L4 | 自定义视图 | Webview 视图容器/视图（iframe 隔离承载扩展 UI） | 规划 |
| L5 | 完整 API | 独立扩展宿主进程实现 `vscode.*` 大 API 面 + Node 能力（需捆绑 Node 运行时，与"轻量"冲突，单列为可选组件） | 远期 |

**明确不承诺**：VS Marketplace 在线安装（v1 仅本地 `.vsix`）、调试器（DAP）、LSP、Remote 开发。

**安装方式**：本地 `.vsix`（zip 格式）→ Rust 端解包到 `~/.aluka-ide/extensions/<publisher>.<name>/` → 前端扫描清单并注册。

**目录约定**：全局扩展 `~/.aluka-ide/extensions/`；工作区级 `<workspace>/.aluka/extensions/`（优先级更高）。

### L2/L3 级验收标准

- 安装一个纯主题 VSIX（如 One Monokai）→ 状态栏切主题 → UI 与编辑器配色同时变化。
- 安装一个命令类示例扩展 → 命令面板可搜到并执行 `window.showInformationMessage` 弹出通知。

## 6. 范围外（Non-goals）

- VS Marketplace 在线市场、账号体系、同步
- 调试器（DAP）、LSP 智能补全（Monaco 仅 Monarch 高亮）
- Remote / 容器开发、 notebooks
- Git 完整视图（仅状态栏分支展示，源代码管理面板属后续版本）

## 7. 技术选型与架构

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 包体/内存远优于 Electron；Rust 侧承担 IO/进程/解包 |
| 前端 | React 18 + TypeScript(strict) + Vite | 生态成熟；类型安全 |
| 样式 | TailwindCSS 4（@tailwindcss/vite） | 原子化 + CSS 变量做主题 |
| 编辑器 | Monaco Editor（本地打包，仅 editor worker） | VS Code 同源，主题/高亮兼容红利最大 |
| 状态 | zustand | 轻量、无样板 |
| 图标 | lucide-react | 轻量树摇 |
| Rust crate | serde/serde_json、walkdir、notify 6、rfd、zip 2 | FS/监听/对话框/VSIX 解包 |

### 架构图

```
┌───────────────────────────────────────────────────────┐
│              WebView 前端（React + Monaco）             │
│  UI Shell：标题栏/活动栏/侧边栏/编辑器组/面板/状态栏      │
│  命令面板 · 快捷键中枢 · 主题引擎 · 设置                 │
│  扩展宿主 v0（清单解析 + 命令/主题注册 + JS 沙箱垫片）    │
└───────────────▲───────────────────────▲───────────────┘
                │  invoke（命令）         │  emit（事件：终端输出/文件变更）
┌───────────────┴───────────────────────┴───────────────┐
│                   Rust Core（Tauri 2）                 │
│  目录树/文件读写 · notify 监听 · walkdir 全局搜索        │
│  终端会话（cmd 管道 + 读线程） · VSIX 解包(zip)          │
│  文件夹对话框(rfd) · git 分支探测                        │
└───────────────────────────────────────────────────────┘
```

**目录约定**：`~/.aluka-ide/{extensions, settings.json, logs}`；工作区 `<workspace>/.aluka/`。

## 8. 风险与对策

| 编号 | 风险 | 对策 |
| --- | --- | --- |
| R1 | VS Code API 面巨大导致兼容泥潭 | 严格按 L1~L5 分级，本期只做 L1~L3 并明示不兼容清单 |
| R2 | Monaco 体积拖累"轻量" | 仅打 editor worker；语言 worker 不引入；资源本地化 |
| R3 | 管道终端无 TTY（无颜色/交互程序不可用） | MVP 接受；后续评估 ConPTY / portable-pty |
| R4 | rfd 对话框阻塞命令线程 | `spawn_blocking` + 异步 invoke |
| R5 | 大文件/二进制文件拖垮编辑器 | 读取前探测：>5MB 只读、>20MB 拒绝、含 NUL 判定二进制 |
| R6 | WebView2 版本差异 | Vite 固定 `target: chrome105`；关键路径人工冒烟清单 |

## 9. 验收与度量

- 每个里程碑走查对应 FR 验收要点（见 DEVELOPMENT_PLAN.md 质量门）。
- 性能指标以Release 构建 + Windows 10 实测为准，记录在当日 TODO 的"验证记录"。

## 变更日志

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-09-02 | v0.1 | 初版基线 |
