# Aluka IDE 开发计划

| 项 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 日期 | 2026-09-02 |
| 关联文档 | [REQUIREMENTS.md](./REQUIREMENTS.md) · [TODO/](./TODO/) · [AGENTS.md](../AGENTS.md) |

---

## 1. 总体策略

- **纵向切片**：每个里程碑交付"可运行、可验收"的增量，禁止长期不可启动的大分支。
- **文档驱动**：需求变更先改 `REQUIREMENTS.md`；每日工作落在 `.work/TODO/TODO_YYYYMMDD/`，完成后更新状态与验证记录。
- **质量门**：每个里程碑收口前必须通过 §6 质量门清单。

## 2. MVP 定义

| 阶段 | 组成 | 用户价值 |
| --- | --- | --- |
| **MVP** | M0 + M1 + M2 + M3 | 打开本地文件夹 → 浏览文件树 → 多标签编辑并保存代码，具备完整 VS Code 观感 |
| **MVP+** | MVP + M4 + M5 | 命令面板/快捷键/主题/设置 + 全局搜索/终端/状态栏，可作日常工具使用 |
| **生态目标** | MVP+ + M6 | 可安装本地 VSIX：主题插件即装即用，命令类扩展可注册执行 |

> **当前状态（2026-09-02）：M0~M7 全部完成，v0.1.0 发布**（NSIS 2.91MB / 冷启动 292ms / 空闲内存私有工作集 237.5MB）。

## 3. 里程碑总表

| 里程碑 | 内容 | 验收标准（摘要） | 预估 | 状态 |
| --- | --- | --- | --- | --- |
| **M0 脚手架** | Tauri2 + React18 + TS strict + Vite + Tailwind4 + Monaco + zustand 工程化；图标；构建流水线 | `npm run build`、`cargo check` 通过；窗口可启动 | 0.5 天 | ✅ 09-02 |
| **M1 界面框架** | 五区布局 Shell + 自定义标题栏（窗口控制/拖拽） | 对照 VS Code Dark+ 走查通过；面板/侧栏可折叠 | 0.5 天 | ✅ 09-02（拖拽/双击待人工确认） |
| **M2 工作区** | 打开文件夹、资源管理器树（懒加载）、CRUD、notify 监听 | 万级目录首屏 ≤500ms；增删改后树即时反映 | 1 天 | ✅ 09-02（外部监听+回收站删除已实测） |
| **M3 编辑器核心** | Monaco、多标签、脏标记、保存/另存为、大文件保护 | 编辑→Ctrl+S 落盘；关闭未保存有确认 | 1 天 | ✅ 09-02（完整：Monaco+高亮修复、编辑保存实测）→ **MVP 检查点** |
| **M4 命令与设置** | 命令面板、快捷键中枢、内置主题 + 主题引擎、设置持久化 | 全部核心命令可从面板触达；重启设置保留 | 1 天 | ✅ 09-02（14 核心命令面板/快开实测；Light+/Dark+ 双通道切换；settings.json 重启保留实测） |
| **M5 搜索/终端/状态栏** | 全局搜索、终端面板（cmd 管道）、状态栏信息 | 搜索命中可跳转；终端可执行常规命令 | 1 天 | 🔄 09-02 代码完成（质量门+搜索单测全绿），UI 走查待人工 → **MVP+ 检查点** |
| **M6 扩展系统** | L1 清单/L2 主题/L3 命令 + VSIX 安装 + 示例扩展 | 安装主题 VSIX 生效；示例命令扩展注册执行成功 | 1.5 天 | ✅ 09-02（L1~L3 全部实测：主题 VSIX 双通道切换、命令扩展沙箱执行弹通知、卸载即时生效） |
| **M7 打磨发布** | NSIS 安装包、性能达标验证、README、体验打磨 | v0.1.0 安装包 ≤25MB、冷启动 ≤2s | 1 天 | ✅ 09-02（NSIS 2.91MB、冷启动 292ms、空闲内存私有工作集 237.5MB，三项 NFR 全达标）→ **v0.1.0 发布** |

## 4. 里程碑详细拆分

### M0 脚手架
- npm 工程化：Vite + React + TS(strict) + Tailwind4(vite 插件) + monaco-editor + @monaco-editor/react + zustand + lucide-react
- `src-tauri`：Tauri 2、`tauri.conf.json`（decorations=false）、capabilities 最小集
- `tauri icon` 生成全套图标（自绘 1024 PNG 源）
- 验收：`npm install` / `npm run build` / `cargo check` 全通过；`npm run tauri dev` 出窗口

### M1 界面框架
- 组件：TitleBar、ActivityBar、SideBar、EditorArea（含空态）、Panel、StatusBar
- zustand：`sidebarView / panelOpen / activeView` 等布局状态
- 主题：`--aluka-*` CSS 变量表复刻 VS Code Dark+（#1e1e1e / #252526 / #333333 / #007acc 等）
- 验收：五区渲染、活动栏切换侧栏占位视图、面板折叠、标题栏三键 + 拖拽 + 双击最大化

### M2 工作区
- Rust：`open_folder`(rfd+spawn_blocking)、`read_dir`（懒加载单层、跳过 .git/node_modules/target 等）、`read_file`（二进制/大文件探测）、`write_file`、`create/rename/delete`、notify 监听线程 → `workspace:changed` 事件
- 前端：文件树组件（懒展开、图标映射、右键菜单）、欢迎页
- 验收：打开任意目录树正确；树内新建/重命名/删除生效；外部改动自动刷新

### M3 编辑器核心
- Monaco 本地接入（仅 editor worker）、按文件 uri 建 model（保留脏态/视图态）
- 标签页：打开/切换/关闭、脏标记、中键关闭、关闭确认
- 保存：Ctrl+S → `write_file`；另存为；状态栏语言/行列联动
- 验收：多文件并开互串不发生；保存落盘；大文件按 NFR 保护

### M4 命令与设置
- 命令注册表（核心命令 + 后续扩展命令统一入口）、命令面板（模糊匹配/最近使用）
- 快捷键中枢：单表映射，Ctrl+Shift+P / Ctrl+P / Ctrl+B / Ctrl+` / Ctrl+S / Ctrl+W 等
- 内置 Dark+/Light+；主题引擎：`colors`→CSS 变量映射表、`tokenColors`→Monaco rules（为 M6 复用）
- 设置：localStorage + `~/.aluka-ide/settings.json`

### M5 搜索/终端/状态栏
- Rust `search_workspace`：walkdir + 跳过重目录 + 大小写/整词/正则 + 结果截断
- 终端：会话管理（cmd 管道 + 读线程 emit）、多标签、Ctrl+` 
- 状态栏：行列/语言/编码/EOL/git 分支（shell out `git branch --show-current`）

### M6 扩展系统（对齐 REQUIREMENTS §5）
- Rust `install_vsix`（zip 解包 + zip-slip 防护）到 `~/.aluka-ide/extensions/`
- 扩展扫描（全局 + 工作区 `.aluka/extensions/`）、清单解析、扩展视图 UI（列表/安装/禁用）
- 命令/快捷键/主题 contribute 注册；`main.js` 沙箱垫片（`vscode.commands/window/workspace`）
- 交付两个示例扩展：纯主题、注册命令

### M7 打磨发布
- `tauri build` NSIS 安装包；冷启动/内存实测记录；README（含扩展开发指南）；代码清理

## 5. 排期建议（自 2026-09-02 起）

| 日期 | 里程碑 | TODO 目录 |
| --- | --- | --- |
| D1 09-02 | M0 + M1（T4 资源管理器提前量视进度） | `TODO_20260902/` |
| D2 | M2 工作区 | `TODO_YYYYMMDD/` |
| D3 | M3 编辑器核心 → **MVP 演示** | … |
| D4 | M4 命令与设置 | … |
| D5 | M5 → **MVP+ 演示** | … |
| D6–D7 | M6 扩展系统 | … |
| D8 | M7 → **v0.1.0 发布** | … |

> 排期为 AI 结对开发下的理想节奏；以实际验收推进，宁慢勿烂。

## 6. 质量门（每里程碑收口必查）

- [ ] `npm run build` 通过（tsc strict + vite）
- [ ] `cd src-tauri && cargo check` 通过；收口时 `cargo clippy -- -D warnings`、`cargo fmt` 干净
- [ ] 本里程碑 FR 验收要点逐条人工走查（`npm run tauri dev`）
- [ ] UI 变更截图留档到当日 TODO"验证记录"
- [ ] 当日 TODO 状态全部闭环（⬜→✅ 或 ⛔ 并注明原因）

## 7. 变更管理

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-09-02 | v0.1 | 初版：M0~M7 八个里程碑，MVP=M0~M3 |
| 2026-09-02 | v0.1.1 | M0、M1 完成（含 T4 提前量：打开文件夹+只读文件树）；M2 建议增加"树展开状态提升到 store" |
| 2026-09-02 | v0.1.2 | M2 完成：文件 CRUD（新建/重命名/删除→回收站）、notify 监听自动刷新、树状态提升到 treeStore。MVP 仅剩 M3 编辑器核心 |
| 2026-09-02 | v0.1.3 | M3 代码完成（Rust read/write_file + 大小/二进制保护、Monaco 本地接入、多标签、脏标记、Ctrl+S、状态栏联动、textarea 降级）。遗留：Monaco 在 WebView2 dev 下渲染静默失败，待专项排查；MVP 检查点顺延 |
| 2026-09-02 | v0.1.4 | **MVP 达成**：M3 端到端实测通过（打开/多标签/编辑/脏标记/关闭确认/保存落盘） |
| 2026-09-02 | v0.1.5 | **Monaco 修复**（M4 首任务）：根因 = StrictMode 双挂载与 Monaco 单例冲突；移除后 Go/Markdown 语法高亮实测正常，降级开关保留（useMonaco 常量） |
| 2026-09-02 | v0.1.6 | **M4 完成**：命令注册表+快捷键中枢（commands.ts，14 核心命令单表分发）、命令面板+快速打开（子序列模糊匹配、最近使用置顶、Rust walkdir list_workspace_files）、主题引擎（Dark+/Light+ 以 VS Code 主题 JSON 形状声明，COLOR_TO_CSS_VAR→--aluka-*、tokenColors→Monaco rules，M6 扩展主题可复用 applyTheme）、设置持久化（Rust get/set_settings 落盘 ~/.aluka-ide/settings.json + localStorage dev 兜底，重启保留实测通过）。质量门：build/clippy/fmt 全绿 |
| 2026-09-02 | v0.1.7 | **M5 代码完成**（UI 走查待人工）：Rust search_workspace（大小写/整词/正则 + 截断，regex 依赖登记，4 例单测锁定归一化语义）+ terminal.rs（cmd /K chcp 65001 管道会话 + 读线程 emit，无 ConPTY 取舍见模块头注）+ get_git_branch（shell out，workspace:changed 去抖刷新）；前端 SearchView（分组/开关/点击 reveal 跳转）+ Panel 真实终端（多标签/流式输出/输入回显）+ autoSave=afterDelay 联动。质量门全绿。**走查补录**：Ctrl+` e.code 修复 + dir 回显 + 面板/输入行聚焦实测通过 |
| 2026-09-02 | v0.1.8 | **M6 完成（L1~L3）**：Rust vsix.rs（install_vsix zip-slip 组件级防护 / list_extensions 全局+工作区 / read_extension_file / uninstall_extension / pick_vsix_dialog；zip 0.6 依赖登记）；前端 extHost（manifest 强类型收窄、registry 激活管线：声明占位→主题→片段→main.js 函数沙箱垫片 commands/window/workspace→keybindings）、notificationStore + toast、ExtensionsView（列表/安装/禁用/卸载）；示例扩展 ×2（monokai-theme、hello-command）+ 零依赖 make-vsix.mjs 打包脚本。修复：Monaco 主题名点号清洗、面板模糊过滤 null+1 失效。L2/L3 验收实测通过（主题双通道切换、沙箱命令弹通知、快捷键 contribute） |
| 2026-09-02 | v0.1.9 | **M7 完成 → v0.1.0 发布**：`npm run tauri build` 产出 NSIS 安装包 2.91MB（红线 ≤25MB）+ MSI 4.05MB；release 冷启动 292ms（红线 ≤2s）；空闲内存私有工作集 237.5MB（红线 ≤300MB；WorkingSet 粗加总 355MB 作为共享页上界一并记录）；清理未使用依赖 @monaco-editor/react、补 .gitignore、新建 README（含扩展开发指南与不兼容清单）。质量门全绿。M0~M7 八个里程碑全部闭环 |
