# TODO 2026-09-11（终端 IO 调试工具：发送管道 + 侧栏调试视图）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-11 |
| 关联里程碑 | M8 增强（终端调试工具）（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-06（终端面板），见 [REQUIREMENTS.md](../../REQUIREMENTS.md) |

## 今日目标（总）

1. 在 xterm → Rust `write_terminal` 之间注入可插拔调试管道，统一捕获/拦截/改写前端发往终端工具的数据。
2. 提供常驻侧栏「终端 IO 调试」视图：会话模式控制（放行/丢弃/规则改写）、双向记录（输入 + 输出）、手动发送、历史重发。
3. 调试状态不持久化、默认不影响输入，避免调试功能残留破坏正常终端使用。

## 任务清单

### T1 终端 IO 调试管道（terminalIo.ts） ✅

- **具体目标**：新增 `src/terminalIo.ts`：记录（seq/会话/时间/原始/已发送/判定）、环形缓冲（上限 1000 条）、会话级模式（放行/丢弃/规则改写）、替换规则（字面量/正则）、手动发送与历史重发、输出方向旁路记录；转义显示/解析/UTF-8 十六进制工具函数。
- **验收标准**：
  - [x] 所有写入统一经 `proxyWrite`；丢弃模式不调用 `write_terminal`；改写模式应用规则后发送并记录 rewritten
  - [x] 手动发送绕过会话拦截直接送入终端并记录（含转义 `\x1b`、`\r` 解析）
  - [x] 输出方向记录可在视图按类型筛选
  - [x] `npm run build` 通过（tsc strict + vite）

### T2 terminalStore 接入管道 ✅

- **具体目标**：`terminalStore.write` 改走管道；输出订阅旁路记录；会话关闭清理调试状态；真实发送函数与存活检查经注入回调解耦，避免循环依赖。
- **验收标准**：
  - [x] 键盘输入 / 右键粘贴 / `run.activeFile` / `openTerminalAt` 全部经调试管道
  - [x] `terminal:output` 到达时同步写入输出记录
  - [x] `npm run build` 通过

### T3 侧栏调试视图与入口接线 ✅

> 注：此处"三入口"设计已于 2026-09-14 由 T5 收敛为「顶端菜单唯一入口 + 活动栏图标随开随显」，见下文。

- **具体目标**：新增 `TerminalDebugView.tsx`；SidebarView/ActivityBar/SideBar/commands/MenuBar 接线。
- **验收标准**：
  - [x] 活动栏图标、侧栏标题、终端菜单项三入口均可打开调试视图
  - [x] 视图：会话模式切换、规则编辑、记录列表（时间/会话/判定/payload 转义）、复制原始数据、重发、手动发送、清空记录
  - [x] 打开视图自动开启录制；录制开关 / 暂停记录可随时控制
  - [x] `npm run build` 通过

### T4 验证与收口 🔄

- **验收标准**：
  - [x] `npm run build`（tsc strict + vite）通过
  - [x] `cd src-tauri && cargo check` 不受影响通过
  - [ ] 人工走查记录写入验证记录表

### T5 入口收敛与「用后即弃」关闭（2026-09-14） ✅

- **具体目标**：终端 IO 调试入口唯一化到顶端「终端」菜单；活动栏图标改为「打开后才显示、关闭即隐藏、启动不显示」；侧栏标题右上角新增 × 关闭按钮；点击 × 彻底关闭（停录 + 复位会话拦截/改写 + 清空已跟踪记录 + 收起侧栏与图标）；保证可反复开关。
- **改动文件**：`store.ts`（新增内存态 `terminalDebugOpen` 与 `openTerminalDebug` / `closeTerminalDebug`）、`terminalIo.ts`（新增 `resetTerminalDebugConfig`）、`ActivityBar.tsx`（图标条件渲染）、`SideBar.tsx`（标题行 × 按钮）、`commands.ts`（`terminal.debugIo` 改指新动作）。`MenuBar.tsx` / `TerminalDebugView.tsx` 无改动。
- **验收标准**：
  - [x] 启动后活动栏不显示该图标（`terminalDebugOpen` 仅内存态，刻意不写入 localStorage / settings.json）
  - [x] 顶端「终端 → 终端 IO 调试」为唯一入口；打开后视图形态与改造前完全一致（仍是侧栏视图）
  - [x] 侧栏标题右上角 × 为叉形图标；点击后：停止录制 → 复位各会话拦截/改写 → 清空已跟踪记录 → 视图消失 → 图标消失 → 侧栏整体收起
  - [x] 关闭即清空 `records`（不残留已捕获的输入/输出 payload），重开视图为空白记录列表
  - [x] 未关闭时点击活动栏图标仍支持侧栏收起/展开（VS Code 行为保持不变）
  - [x] 反复开关（菜单打开 → × 关闭 → 菜单再打开）流程不变，状态互不残留
  - [x] `npm run build` 通过（tsc strict + vite）

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 2026-09-11 | `npm run build`（tsc strict + vite） | ✅ 通过 | 新增 terminalIo 管道 + 调试视图后构建全绿 |
| 2026-09-11 | `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过 | Rust 侧无改动，检查不受影响 |
| 2026-09-11 | 新增 `run.sh` 启动脚本 | ✅ 通过 | 依赖缺失时自动 `npm install`，随后 `npm run tauri dev`（LF 行尾，与 build.sh 同风格）|
| 2026-09-14 | `npm run build`（tsc strict + vite） | ✅ 通过 | 入口收敛 + × 关闭改造后构建全绿 |
| 2026-09-14 | 代码走查：`terminal.debugIo` → `openTerminalDebug` → 活动栏图标条件渲染 → `closeTerminalDebug` 状态收敛 | ✅ 通过 | 反复开关状态表已逐条核对；UI 手测待 T4 |
| 2026-09-14 | `npm run build`（tsc strict + vite） | ✅ 通过 | × 关闭时追加「清空已跟踪记录」后构建全绿 |
| 2026-09-14 | 代码走查：`resetTerminalDebugConfig` 清空 `records` + `sessions` 复位 + `recording=false` | ✅ 通过 | 关闭后 `recordTerminalOutput` / `proxyWrite` 因 `recording=false` 不再写入新记录，列表保持为空 |

## 未决问题与次日移交

- 调试状态当前不持久化（每次启动回到「放行/无规则 + 停止录制」），避免残留拦截状态。
- 侧栏整体收起（含活动栏图标折叠态）时无法直接点到标题栏 ×：需先点击活动栏图标展开侧栏，再点 × 关闭。
- 关闭时按「彻底关闭该功能」复位了各会话拦截/改写配置并清空记录；若后续希望反复调试时保留规则与历史现场，可把 `resetTerminalDebugConfig` 收敛为仅 `setRecording(false)`。
- T4 人工走查未完成：需 `npm run tauri dev` 打开终端与「终端 IO 调试」侧栏，验证输入记录 / 丢弃模式 / 规则改写 / 手动发送 / 历史重发 / 输出记录，并复核 T5 的反复开关路径。
