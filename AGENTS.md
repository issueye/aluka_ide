# AGENTS.md — Aluka IDE 开发协作指南

本文件是 AI 代理（Agent）在本仓库工作的**最高约定**。开工前必读；与本文件冲突的操作须先修改本文件。

## 1. 项目简介

**Aluka IDE**：基于 Rust + Tauri 2 + React 18 + TypeScript + TailwindCSS 4 + Monaco Editor 的轻量级 IDE。界面遵循 VS Code 设计语言（Dark+），提供与 VS Code 扩展格式**子集兼容**的插件系统（清单 / 主题 / 命令 / 快捷键 / 片段 / 本地 VSIX 安装）。

- 需求事实来源：[.work/REQUIREMENTS.md](.work/REQUIREMENTS.md)
- 计划与里程碑：[.work/DEVELOPMENT_PLAN.md](.work/DEVELOPMENT_PLAN.md)
- 兼容性分级（L1~L5）：REQUIREMENTS §5 —— **任何"提升兼容级别"的需求都是范围变更**，须先走文档变更。

## 2. 技术栈与目录结构（规划基线）

```
aluka_ide/
├── AGENTS.md              # 本文件
├── .work/                 # 需求/计划/每日TODO（见 .work/README.md）
├── index.html
├── package.json / vite.config.ts / tsconfig.json
├── src/                   # React 前端
│   ├── main.tsx / App.tsx / index.css   # 入口、布局、主题 CSS 变量
│   ├── types.ts / store.ts / tauri.ts   # 类型 / zustand / 后端命令单点封装
│   ├── components/        # TitleBar、ActivityBar、SideBar、Explorer、
│   │                      # EditorArea、CodeEditor、Panel、Terminal、
│   │                      # StatusBar、CommandPalette、ExtensionsView…
│   └── ext-host/          # 扩展宿主 v0：清单解析、vscode 垫片、主题映射
└── src-tauri/             # Rust 后端
    ├── tauri.conf.json / capabilities/default.json
    └── src/               # lib.rs(命令)、terminal.rs、search.rs、vsix.rs
```

## 3. 常用命令

| 场景 | 命令 |
| --- | --- |
| 安装依赖 | `npm install` |
| 开发（带热重载窗口） | `npm run tauri dev` |
| 前端构建 + 类型检查 | `npm run build` |
| Rust 检查 | `cd src-tauri && cargo check` |
| Rust 收口检查 | `cargo clippy -- -D warnings && cargo fmt` |
| 打安装包 | `npm run tauri build` |

## 4. 标准工作流（每个工作日 / 每个任务）

```
读文档 → 建当日 TODO → 实现 → 验证 → 记录 → 收口
```

1. **读文档**：开工先读 `.work/REQUIREMENTS.md` 与 `DEVELOPMENT_PLAN.md` 的当前里程碑。
2. **建当日 TODO**：复制 `.work/TODO/TEMPLATE.md` → `.work/TODO/TODO_YYYYMMDD/README.md`，列出任务、具体目标、验收标准（格式与状态标记见 [.work/README.md](.work/README.md)）。
3. **实现**：小步提交式推进；每个任务独立可验证；状态标记随时更新（⬜→🔄→✅/⛔）。
4. **验证**（Definition of Done，缺一不可）：
   - `npm run build` 通过（含 tsc strict）；
   - `cd src-tauri && cargo check` 通过；里程碑收口加 `cargo clippy -- -D warnings`、`cargo fmt`；
   - 涉及 UI：`npm run tauri dev` 启动后按当日 TODO 验收标准逐条人工走查；
   - 走查结果与截图路径写入当日 TODO 的"验证记录"表。
5. **收口**：里程碑完成时更新 `DEVELOPMENT_PLAN.md` 里程碑状态与变更日志；需求变化同步 `REQUIREMENTS.md`。

> 禁止：跳过验证直接宣告完成；在未更新 .work 文档的情况下改变需求或计划范围；引入本文件未登记的新重型依赖。

## 5. 编码规范

**通用**
- 注释、文档、提交信息**中文优先**；标识符用英文。
- 不确定的设计决策：先查 REQUIREMENTS 的目标/分级，仍不明确则写入当日 TODO"未决问题"，不擅自扩权。

**Rust（src-tauri）**
- 可失败路径返回 `Result`，禁止 `unwrap()`（测试代码除外）；命令函数一律 `async fn` + 必要时 `spawn_blocking`（对话框/大 IO）。
- 前端事件名约定：`workspace:changed`、`terminal:output`、`terminal:closed`。
- 新增命令必须同时：实现于 `lib.rs`（或子模块）→ `invoke_handler` 注册 → `src/tauri.ts` 补类型化封装 → 涉及窗口/能力时补 `capabilities/default.json`。

**TypeScript / React（src）**
- `strict: true` 全量类型，禁 `any`（边界处 `unknown` + 收窄）。
- 函数组件 + hooks；跨组件状态收敛到 zustand（`store.ts`），不层层 props 钻透。
- 后端调用只经 `src/tauri.ts`，组件内禁止直接 `invoke()`。
- 文件命名：组件 PascalCase.tsx，其余 camelCase.ts。

**样式**
- TailwindCSS 工具类为主；主题色一律用 `--aluka-*` CSS 变量（供扩展主题引擎动态覆盖），禁止硬编码颜色与内联 style（主题变量注入除外）。
- 目标观感：VS Code Dark+（editor #1e1e1e、sidebar #252526、activity #333333、statusbar #007acc、边框 #2b2b2b）。

## 6. Git 约定（git init 后生效）

- 主分支 `main`；大功能开 `feature/<名称>` 分支。
- 提交信息：`feat|fix|docs|refactor|chore: 中文简述`（例：`feat: 资源管理器懒加载目录树`）。
- `.gitignore` 必含：`node_modules/`、`dist/`、`src-tauri/target/`、`.work/**/assets/`。

## 7. 扩展系统工作约定（摘要）

- 只实现 REQUIREMENTS §5 当前级别（本期 L1~L3）；不引入 Node 扩展宿主。
- VSIX 解包必须在 Rust 端做 zip-slip 防护；扩展 JS 只运行在前端沙箱垫片内，仅暴露 `commands/window/workspace` 桥接面。
- 每次扩展系统改动，须用"示例主题扩展 + 示例命令扩展"两个用例回归。

## 8. 质量红线

1. 构建/检查不过不交付。
2. 不引入遥测、运行时外联（离线可用是 NFR-06 硬指标）。
3. 不为兼容性破坏"轻量"目标（安装包 ≤25MB、空闲内存 ≤300MB，见 NFR-01/02）。
4. 删除/覆盖用户文件的操作（资源管理器删除、保存覆盖）必须有确认或可撤销路径。
