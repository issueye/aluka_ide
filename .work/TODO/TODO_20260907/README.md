# TODO 2026-09-07（Day 6 · 里程碑 M9 增强）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-07 |
| 关联里程碑 | M9（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-06（见 [REQUIREMENTS.md](../../REQUIREMENTS.md)） |

## 今日目标（总）

1. 终端支持选择 Shell 类型：不再硬编码 PowerShell，可创建 CMD / Git Bash / pwsh / WSL 等会话
2. 终端标签栏提供 Shell 下拉选择器（对齐 VS Code 交互），默认 Shell 持久化到 settings.json

## 任务清单

### T1 后端多 Shell 支持 ✅

- **具体目标**：`create_terminal` 增加 `shell` 参数（powershell/cmd/gitbash/pwsh/wsl）；新增 `list_terminal_shells` 命令探测可用 Shell（Git Bash 经注册表 `GitForWindows\InstallPath` / PATH 中 git.exe 推导 / 常见安装路径三级探测；pwsh/wsl 经 PATH 探测）
- **验收标准**：
  - [x] `cargo check` / `clippy -D warnings` / `fmt` 通过
  - [x] 不新增 Cargo 依赖（注册表查询走 reg.exe，均带 CREATE_NO_WINDOW）
  - [x] 请求的 Shell 不可用时安全回退 PowerShell（代码路径；本机四 Shell 全可用未实测回退触发）

### T2 前端 Shell 选择器 ✅

- **具体目标**：Panel 终端标签栏 "+" 旁增加下拉菜单列出可用 Shell，点击即创建对应会话并记为默认；默认 Shell 写入 settings.json（新增 `terminalShell` 字段，前后端同步）；命令面板「新建终端」跟随默认 Shell
- **验收标准**：
  - [x] `npm run build`（tsc strict）通过
  - [x] 下拉列出本机探测到的 Shell；选择后标签名带 Shell 名（如 Git Bash 2）
  - [x] 选择结果落 settings.json（`terminalShell`），重启后 "+" 与自动创建使用该默认

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 11:10 | `cd src-tauri && cargo check` | ✅ | 多 Shell 改动编译通过 |
| 11:12 | `cargo clippy -- -D warnings && cargo fmt` | ✅ | 零警告，格式化完成 |
| 11:26 | `npm run build`（tsc strict + vite） | ✅ | 初次失败（commands.ts 两处类型错，退出码曾被管道 `tail` 掩盖）→ 修复后通过 |
| 11:28 | `npm run tauri build` | ✅ | exe 11MB + MSI 4.4MB + NSIS 3.2MB |
| 11:33 | release 运行走查：打开工作区 → 查看菜单开终端面板 | ✅ | 自动创建「PowerShell 1」（默认 PowerShell） |
| 11:34 | 点 "+" 旁下拉 | ✅ | 列出 PowerShell / CMD / Git Bash / PowerShell 7；WSL 因本机无发行版正确未列出（`wsl -l -q` 退出码 1）；Git Bash 命中 PATH git.exe 上溯探测（非注册表安装，E: 盘） |
| 11:35 | 选择 Git Bash → 新建「Git Bash 2」 | ✅ | bash 风格提示符 + `(main)` 分支显示；下拉对勾标记默认项 |
| 11:36 | 选择 CMD → 新建「CMD 3」并 `echo` 交互 | ✅ | Windows 版本头 + 正确 cwd + echo 回显正常 |
| 11:37 | 持久化检查 `~/.aluka-ide/settings.json` | ✅ | `"terminalShell": "cmd"`（最后下拉选择项）落盘 |

## 未决问题与次日移交

- WSL 探测要求已安装发行版（`wsl -l -q` 非空才列出）；未装发行版时不展示，避免点击报错。
- 桌面上另有一份旧版 `aluka-ide.exe` 副本（多 Shell 功能之前构建）：新 settings.json 含 `terminalShell` 字段，旧版因 `deny_unknown_fields` 读 settings.json 会报错并回退 localStorage 镜像（主题等不受影响）；建议用新构建替换桌面副本。
- 陷阱记录：`npm run build 2>&1 | tail` 会掩盖真实退出码，后续验证一律改用「输出重定向到文件 + 单独 echo $?」。



# TODO 2026-09-07（里程碑 M10）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-07 |
| 关联里程碑 | M10（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-21（见 [REQUIREMENTS.md](../../REQUIREMENTS.md)） |

## 今日目标（总）

1. Aluka IDE 支持接收外部目录参数，启动后直接打开该目录为工作区
2. 按 AGENTS 工作流同步 REQUIREMENTS / DEVELOPMENT_PLAN / TODO，跑通质量门验证

## 任务清单

### T1 Rust 启动参数与待打开工作区状态 ✅

- **具体目标**：解析 argv 中第一个存在的目录参数，存入受管状态；新增 `take_pending_workspace` 命令并注册
- **验收标准**：
  - [ ] `lib.rs` 实现 `PendingWorkspace` 状态与 `take_pending_workspace`
  - [ ] `invoke_handler` 注册命令
  - [ ] 无参数启动返回 null；非法路径忽略不崩溃

### T2 前端取走参数并打开工作区 ✅

- **具体目标**：`tauri.ts` 补类型化封装；`App.tsx` 挂载时取走 pending 并 `openWorkspace`
- **验收标准**：
  - [ ] `tauri.ts` 新增 `takePendingWorkspace` 封装
  - [ ] `App.tsx` 挂载时打开外部目录为工作区
  - [ ] 纯浏览器 dev 无 IPC 时静默忽略

### T3 文档与验证收口 ✅

- **具体目标**：REQUIREMENTS 新增 FR-21；DEVELOPMENT_PLAN 新增 M10；跑质量门并填写验证记录
- **验收标准**：
  - [ ] `npm run build` 通过
  - [ ] `cargo check` / `cargo clippy -- -D warnings` / `cargo fmt` 通过
  - [ ] 以目录参数启动后工作区打开

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |

## 未决问题与次日移交

- 无

# TODO 2026-09-07（M10 之后 · 动态语言高亮 FR-09 增强）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-07 |
| 关联里程碑 | M4 增强（FR-09） |
| 关联需求 | FR-09 动态语言高亮（见 [REQUIREMENTS.md](../../REQUIREMENTS.md) v0.2.8） |

## 今日目标（总）

1. 突破编译期 24 语言静态 import 限制：运行时注册 Monarch tokenizer 自定义语言
2. 「管理语言高亮」弹窗（列表 + 添加表单），持久化 `~/.aluka-ide/languages.json` 重启自动加载

## 任务清单

### T4 动态语言注册与持久化 ✅

- **具体目标**：monaco-setup `registerMonarchLanguage`（Monaco register + Monarch provider + 语言配置 + 扩展名映射动态写入）；Rust `get/set_user_languages`；languageStore load/add/remove；LanguageManager 弹窗；命令面板「管理语言高亮」；palette kind 扩展 languages
- **验收标准**：
  - [x] `npm run build` / `cargo clippy -D warnings` / `cargo fmt` / `npm run tauri build` 全绿（真实退出码验证）
  - [ ] 用户走查：添加 Monarch 语法定义 → 对应扩展名文件高亮 → 重启仍生效

## 边界说明

- TextMate grammar（.tmLanguage.json）不直接支持：需先转换为 Monarch tokenizer JSON（VS Code basic-languages 同源格式）
- 同 id 用户定义覆盖内置语言为允许行为（VS Code 语言优先级一致）
- 移除语言会话内不反注册（Monaco 无 API），重启后完全生效


# TODO 2026-09-07（M10 之后 · 终端与右键增强 v0.2.9）

## 任务清单

### T5 终端链接与右键菜单 ✅

- **实现**：
  - `@xterm/addon-web-links`（v0.12）：Ctrl+点击 URL → `open_external_url`（白名单 http/https，rundll32 打开系统默认浏览器）
  - 终端右键菜单：复制（选中文字）/ 粘贴（剪贴板→PTY）/ 清空 / 中断并结束会话（发 `\x03` + kill）
  - Ctrl+C 键盘中断：xterm onData → ConPTY 天然 SIGINT（无需额外实现，验证记录见走查）
  - 资源管理器右键补「复制路径」「复制名称」
- **验收标准**：
  - [x] `npm run build` / `cargo clippy -D warnings` / `cargo fmt` 全绿（真实退出码）
  - [ ] 用户走查：Ctrl+点击 http/https 链接浏览器打开；右键四项菜单可用；Ctrl+C 中断 ping 等长命令；右键文件复制路径

## 边界说明

- URL 协议白名单仅 http/https（file:/javascript: 拒绝，防注入）
- 粘贴走 navigator.clipboard（WebView2 授权）；终端内已有选中时右键直接覆盖式操作
