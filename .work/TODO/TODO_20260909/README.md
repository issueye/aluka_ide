# TODO 2026-09-09（拖拽调整面板/侧栏尺寸 · 修复欢迎页遮挡 · 移除账号图标）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-09 |
| 关联里程碑 | M3 增强（布局健壮性）（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-02（布局 Shell「各区域可折叠/**伸缩**」）、FR-01 / FR-04（编辑器区）、FR-06（终端面板）（活动栏属 FR-02 布局 Shell 的组成部分），见 [REQUIREMENTS.md](../../REQUIREMENTS.md) |

## 今日目标（总）

1. 编辑器组内容在可用高度不足时不得越过自身边界绘制到底部面板之上。
2. 欢迎页在窗口偏矮 / 面板打开时改为可滚动，内容不丢失。
3. 底部控制台面板顶边可拖拽调高度、左侧栏右边缘可拖拽调宽度，尺寸持久化（补齐 FR-02「各区域可伸缩」）。
4. 移除活动栏左下角无功能的「账号」图标。

## 任务清单

### T1 修复欢迎页溢出遮挡终端面板 ✅

- **具体目标**：定位并修复「快捷键列表盖住 PowerShell 面板标签栏」的布局缺陷。
- **根因**：
  1. `App.tsx` 的 `<main>`（编辑器区 + 面板的纵向容器）缺 `min-h-0`，flex 子项默认 `min-height:auto` 使其无法被压缩；
  2. `EditorArea.tsx` 中 `Welcome` 外层同样缺 `min-h-0`，内容（10 条快捷键）高于可用高度时溢出组容器；
  3. 组容器无 `overflow-hidden`，而 `EditorArea` 的 `<section>` 是 `relative`（定位元素绘制层级高于静态的 `Panel` 背景），溢出部分因此直接压在面板上；
  4. 附带：`DiffEditor` 根节点用 `h-full`（含标签栏高度）会多出 36px 溢出。
- **改动**：
  - `src/App.tsx`：`<main>` 增加 `min-h-0`；
  - `src/components/EditorArea.tsx`：`EditorGroupView` 根节点增加 `overflow-hidden`；`Welcome` 外层改为 `min-h-0 flex-1 overflow-auto`、内层用 `m-auto` 居中（避免 flex 居中溢出时顶部被裁且无法滚到）；空组占位增加 `min-h-0`；
  - `src/components/DiffEditor.tsx`：根节点 `h-full` → `min-h-0 flex-1`。
- **验收标准**：
  - [x] 面板打开且窗口偏矮时，面板标签栏 / 终端区域命中测试均落在面板自身元素上
  - [x] 欢迎页内容超高时容器内部滚动，不再压到面板
  - [x] `npm run build`（tsc strict + vite）通过
  - [x] `npm run tauri dev` 人工走查（矮窗口 + 打开面板 + 欢迎页滚动；用户侧运行产物确认无问题）

### T2 底部控制台面板支持拖拽高度 ✅

- **具体目标**：面板顶边可上下拖拽调整高度，双击重置，尺寸持久化。
- **验收标准**：
  - [x] 新增通用手柄组件 `src/components/ResizeHandle.tsx`（`side="top"` 调高度）
  - [x] `Panel` 高度由 `store.panelHeight` 驱动（原固定 `h-64`），顶边手柄可拖
  - [x] 区间收敛：最小 96px，最大 `窗口高 - 260px`（保证编辑器区可用）
  - [x] 双击重置为默认 256px；聚焦后 ↑/↓ 每按一次 ±10px、Home 重置
  - [x] 尺寸写入 localStorage（200ms 防抖），重启后恢复

### T3 左侧栏支持拖拽宽度 ✅

- **具体目标**：侧栏右边缘可左右拖拽调整宽度，双击重置，尺寸持久化。
- **验收标准**：
  - [x] `SideBar` 宽度由 `store.sidebarWidth` 驱动（原固定 `w-60`），右边缘手柄
  - [x] 区间收敛：最小 170px，最大 `min(600, 窗口宽 - 400)`
  - [x] 双击重置 240px；←/→ 微调、Home 重置
  - [x] 与 T2 共用同一手柄组件与持久化通道

### T4 移除活动栏左下角账号图标 ✅

- **具体目标**：删除无功能的「账号（未实现）」按钮，保留「管理」。
- **验收标准**：
  - [x] `ActivityBar` 去掉 `UserRound` 按钮与无用 import，底部仅剩「管理」

### T5 视口变化后尺寸重新收敛 ✅

- **具体目标**：窗口缩小 / 取消最大化 / 换显示器后，之前持久化的大尺寸不得把编辑器区挤没或顶出窗口。
- **验收标准**：
  - [x] `store.ts` 抽出 `sidebarMax()` / `panelMax()` 作为唯一上限来源（手柄与启动收敛共用）
  - [x] `clampLayoutToViewport()`：启动时 + `window resize` 时把尺寸收回可用范围（`App.tsx` 注册监听）
  - [x] 实测：视口 720×883 下写入 600/900 → 启动收敛为 320/623，编辑器区仍保留 196px

### T6 对抗性代码审查与修正 ✅

- **具体目标**：请 code-reviewer 子代理只读审查 T2/T3/T5 改动，按缺陷分级修正。
- **审查发现并已修**：
  - **严重**：`ResizeHandle` 的拖拽遮罩在 mousedown 当帧即铺满全屏，真实指针双击时 `mouseup` 落在遮罩上 → `click` 序列不认手柄 → **双击重置实际失效**（此前用 `dispatchEvent` 直射手柄的自测绕过了命中测试，把假通过掩盖了过去）。改为「指针位移 ≥4px 才铺遮罩」，原地双击不再被抢命中。
  - 中：`onKeyDown` 未判修饰键，手柄聚焦时会吞掉全局 `Alt+←/→`（后退/前进）命令 → 加 ctrl/alt/meta 早退。
  - 中：`mousedown` 的 `preventDefault()` 抑制了默认聚焦，宣称的键盘微调其实进不去 → 显式 `currentTarget.focus()`。
  - 中：可聚焦 `role=separator` 缺 `aria-valuenow/valuemin/valuemax` → 补上（新增 `value` 属性由调用方传入）。
  - 中：手柄 hover/focus 硬编码 `#0078d4`，违反 AGENTS.md §样式且不随亮色主题变 → 改 `--aluka-btn-hover`。
  - 中：`loadLayout()` 在值为字面量 `null` 时返回 `null`，模块顶层取属性抛错 → **整个前端白屏且刷新不自愈** → 加类型守卫。
  - 轻：`setSidebarWidth/setPanelHeight` 只按绝对上下限收敛，双击重置可写回超视口尺寸 → 统一走 `sidebarMax()/panelMax()`。
  - 轻：hover 改变盒子宽高（`hover:w-1.5`）会让每次划入手柄都触发一次编辑器重排 → 固定 4px，仅变色。
  - 轻：200ms 防抖无 flush 出口，拖完立刻关窗会丢最后一次尺寸 → 加 `pagehide` 兜底（并修掉 `writeLayout` 先把 `pendingLayout` 置空再序列化的自伤）。
  - 轻：`latestRef` 间接层在上限函数收敛到 store 后已成冗余 → 删除，props 直接进依赖表。
- **验收标准**：
  - [x] 用**命中测试驱动**（`elementFromPoint` + 完整 down/up/click 序列）的真实双击复测：拖到 320 → 双击 → 回 240
  - [x] mousedown 后 `document.activeElement` 即手柄；`Alt+←` 不改宽度且不吞事件；无修饰 `←` 仍 −10
  - [x] 拖拽中遮罩接管命中、松手后手柄恢复可命中

### T7 提交记录查询（Git 历史视图，当日追加）✅ 代码完成（走查待人工）

- **具体目标**（REQUIREMENTS 新增 FR-21，v0.2.12）：独立「提交记录」侧栏视图（活动栏 History 图标入口 + 命令面板 `workbench.view.history`）；Rust 新增 `git_log` / `git_commit_detail`；列表按提交信息/作者/哈希实时过滤；条目展开显示相对首父改动文件（M/A/D 徽标，`--no-renames` 重命名拆 D+A），点击文件打开提交前后 Monaco Diff（根提交对比空树）；「加载更多」100/档 → 上限 1000；非仓库空态一键 git init。
- **实现落点**：
  - Rust `git.rs`：`GitLogEntry/GitCommitFile/GitCommitDetail` 结构 + `git_log`（rev-parse HEAD 判空仓库 → `git log --pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s` 单行 `\x1f` 解析）+ `git_commit_detail`（`hash~1` rev-parse 判首父：存在 → `git diff --name-status -z --no-renames` 对比首父；根提交 → `git show --name-status -z --format=` 对比空树；`-z` NUL 成对解析防路径转义）；解析单测 3 例；`lib.rs` 命令注册。
  - 前端：`tauri.ts` 类型与封装；`StatusBadge` 从 SourceControlView 抽为共享组件（两处共用）；新 `GitHistoryView.tsx`（entries/limit/loading/error/query/expandedHash/detailCache 组件内状态；seq 引用丢弃过期响应、切工作区重置视图态并回默认窗口；刷新按钮 + 重试路径）；`store.ts`（SidebarView + "history"）、`SideBar.tsx`、`ActivityBar.tsx`、`commands.ts` 视图接线。
- **验收标准**：
  - [x] Rust 解析单测 3 例通过（cargo test 共 13 例全绿）
  - [x] `cargo check`、`cargo clippy -- -D warnings`、`cargo fmt --check` 全绿
  - [x] `npm run build`（tsc strict + vite）通过
  - [x] 真实仓库命令行语义核对（git log 格式 / 根提交 show / diff -z 成对输出，见验证记录）
  - [x] `npm run tauri dev` 人工走查：活动栏入口、过滤、展开文件、Diff、加载更多、非仓库空态（用户侧运行产物确认无问题）
  - [x] 对抗性 code-reviewer 审查结论闭环（无严重缺陷；中 1-4 + 轻 6/8/9 已修，见验证记录与未决问题）

### T8 根目录打包脚本 build.sh ✅

- **具体目标**：根目录新增 `build.sh`，一键完成前端构建（tsc strict + vite）+ Rust release + 安装包（NSIS/MSI）。
- **实现**：`set -euo pipefail`；自动 `cd` 到脚本所在目录（不依赖调用位置）；未安装前端依赖时先 `npm install`；最终执行 `npm run tauri build`，结束后打印产物路径。
- **验收标准**：
  - [x] `build.sh` 位于仓库根目录，bash 语法检查通过（`bash -n`）
  - [x] 产物路径提示与 README 打包说明一致（`dist/` + `src-tauri/target/release/bundle/`）

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 2026-09-09 | `npm run build`（tsc strict + vite） | ✅ 通过 | 仅 chunk 体积告警（既有） |
| 2026-09-09 | 等价最小复现页 + `elementFromPoint` 命中测试（面板标签栏 / 终端区 3 点） | ✅ 通过 | 修复前：3 点中有 2 点被欢迎页元素命中（遮挡）；修复后：3 点全部命中面板自身元素，欢迎容器底边与面板顶边精确相接并可内部滚动 |
| 2026-09-09 | `npm run tauri dev` 人工走查 | ✅ 通过 | 用户侧运行产物走查确认无问题（布局 T1-T6 项） |
| 2026-09-09 | `npm run tauri build`（release + 打包） | ✅ 通过 | 前端 `tsc && vite build` → `cargo build --release`（3m46s）→ MSI + NSIS 双产物 |
| 2026-09-09 | 产物冒烟：直接运行 `aluka-ide.exe` | ✅ 通过 | 进程正常启动驻留，启动工作集 24.4MB（NFR-02 空闲 ≤300MB 达标）；测试后已关闭 |
| 2026-09-09 | 产物体积核对（NFR-01 ≤25MB） | ✅ 通过 | exe 11.00MB / MSI 4.40MB / NSIS setup 3.18MB |
| 2026-09-09 | `npm run build`（拖拽尺寸改动后复跑） | ✅ 通过 | — |
| 2026-09-09 | 浏览器实测侧栏拖拽（`vite preview` + 合成鼠标事件） | ⚠️ 部分失真 | 240 →（+80）320 →（−200）钳到下限 170 有效；**「双击回 240」是假通过**——直射手柄绕过了命中测试，真指针下被遮罩抢走（见 T6 修正与下方复测） |
| 2026-09-09 | 浏览器实测面板高度拖拽 | ⚠️ 部分失真 | 256 →（上拖 100）359、下拖钳到下限 96、猛拉钳到上限 `窗口高-260`（967 窗口下 707）均有效；「双击回 256」同属假通过 |
| 2026-09-09 | 键盘可达性（手柄聚焦后 ↑↓←→ / Home） | ⚠️ 部分失真 | 步进与 Home 重置数值正确（281→291→301→311→240），但当时靠程序化 `focus()`；鼠标点击能否聚焦尚未成立（见 T6 修正） |
| 2026-09-09 | 持久化与重启恢复 | ✅ 通过 | `localStorage["aluka.layout"]` 与实时尺寸始终一致；刷新后侧栏 291、面板 256 均按存档恢复 |
| 2026-09-09 | 拖拽性能（单次 mousemove 应用耗时） | ✅ 通过 | 0–1ms/次，无需额外 rAF 节流 |
| 2026-09-09 | 账号图标移除核对 | ✅ 通过 | 无「账号」按钮；「管理」按钮保留 |
| 2026-09-09 | `npm run tauri build` 重新出包（含本次三项改动） | ✅ 通过 | release 3m26s，MSI + NSIS 双产物 |
| 2026-09-09 | T6 修正后 `npm run build` 复跑 | ✅ 通过 | tsc strict 无错 |
| 2026-09-09 | **命中测试驱动**复测（重载新 bundle 后） | ✅ 通过 | 拖到 320 → 真实双击 → 回 240；`focusAfterMousedown=true`；`Alt+←` 宽度不变（不吞全局命令）；无修饰 `←` 仍 −10；拖拽中遮罩接管命中、松手后手柄恢复 |
| 2026-09-09 | 视口收敛复测（写入超尺寸后重启） | ✅ 通过 | 视口 720×883 下 600/900 → 320/623，编辑器区保留 196px |
| 2026-09-09 | `npm run tauri build` 最终出包（含 T6 修正） | ✅ 通过 | release 4m01s，MSI + NSIS 双产物 |
| 2026-09-09 | 语义核对（本仓库真实 git）：`git log --pretty=format:%H%x1f…` 单行输出、根提交 `git show --name-status`、`diff/show -z` NUL 成对输出、`rev-parse hash~1` 首父存在性 | ✅ 通过 | 输出与后端解析假设一致；含空格路径在 `-z` 下不成问题 |
| 2026-09-09 | `cargo test`（含新 git.rs 解析单测 3 例） | ✅ 通过 | lib 共 13 例全绿 |
| 2026-09-09 | `cargo clippy -- -D warnings` + `cargo fmt --check` | ✅ 通过 | 零警告零 diff |
| 2026-09-09 | `npm run build`（tsc strict + vite，T7 接线后复跑） | ✅ 通过 | 含 GitHistoryView/StatusBadge/视图接线 |
| 2026-09-09 | `npm run tauri dev` 人工走查（T7：活动栏入口/过滤/展开/Diff/加载更多/空态） | ✅ 通过 | 用户侧运行产物走查确认无问题（FR-21 全流程） |
| 2026-09-09 | code-reviewer 只读对抗审查（GitHistoryView / git.rs / editorStore / MenuBar 等 9 文件） | ✅ 完成 | 无严重缺陷；中 4 项：①详情拉取失败无重试死路 ②单飞守卫吞掉在途时的展开请求 ③切工作区 + limit≠100 早退绕过 seq 竞态防护 ④openDiff 复用标签不刷新标题（对比基准错位）；轻 6/8/9：完整哈希不可搜、浅克隆边界被误判为根提交、lossy 先于 NUL 切分损坏路径 |
| 2026-09-09 | 审查修复复跑：`cargo test`（14 例）/ clippy -D warnings / fmt / `npm run build` | ✅ 通过 | 修复：详情并发拉取 + 失败行内重试、seq 立即作废 + 刷新提前、detail 增 parent_hash 契约（rev-list --parents 判定父，浅克隆缺对象如实报错不装空树）、-z 解析改字节级（非 UTF-8 路径跳过）、Diff 复用标签同步名称、过滤含完整哈希、查询态可用「加载更多」、查看菜单补「提交记录」入口 |
| 2026-09-09 | `npm run tauri build`（FR-21 等 4 笔提交后重新出包） | ✅ 通过 | release 3m19s；exe 11.09MB / MSI 4.43MB / NSIS 3.20MB（NFR-01 ≤25MB 达标） |
| 2026-09-09 | `bash -n build.sh` 语法检查 | ✅ 通过 | 新增打包脚本，未改动业务代码 |

## 未决问题与次日移交

- **FR-21（T7）范围边界与移交**：仅当前分支（HEAD）线性回看——`git log --all` / 按文件历史 / 跨分支查询、提交说明全文展示与一键复制完整哈希均属后续可扩展（未扩权，需扩时先改 REQUIREMENTS FR-21 措辞）；合并提交 Diff 只对比第一父（首父语义已在 FR-21 验收写明）；同文件不同提交对的 Diff 标签共用 `diff:path` 键（后开者替换先开者，沿用既有 Diff 标签语义，复用时会同步刷新标签名）；详情缓存按提交哈希跨刷新保留（同一哈希内容恒定，无陈旧风险）。对抗性 code-reviewer 审查已完成并闭环（中 1-4 与轻 6/8/9 修复：行内详情重试、多提交并发拉取、切工作区竞态作废、父哈希回传、Diff 标签名同步、完整哈希可搜、查看菜单入口；轻 7 列表键盘可达性与轻 10 init 失败提示与 SCM 既有列表模式一致，未扩权）。UI 人工走查已由用户侧运行产物确认无问题（见 T7 验收标准与验证记录）。
- 欢迎页快捷键列表较长（10 条），矮窗口下需滚动才能看全；如需彻底避免，可考虑按高度自适应折叠或减少条目（属体验优化，未擅自扩权）。
- 用户需在自己运行的实例中重启/热更新确认遮挡消失 → 已于 2026-09-09 由用户侧运行产物确认无问题。
- **同源缺陷未一并修**：`EditorArea.tsx` 的私有 `Splitter`（编辑器分屏）与本次的 `ResizeHandle` 是同一交互的两个版本，仍带着「遮罩抢双击」「无 blur 收尾（拖到窗口外释放会卡在 dragging）」「hover 改盒尺寸」「硬编码 `#0078d4`」「无 a11y」这几条。建议后续抽 `useDragSession()` 合并（修一次两处都好），本次为控制改动面未动，需另开任务。
- 拖面板高度时 `Panel.tsx` 的 `ResizeObserver` 每帧无条件发一次 `terminal:resize` IPC（相同 cols/rows 未去重）。实测单次应用 0–1ms、无掉帧，暂不优化；若真机拖终端感觉发涩，可在 `terminalStore.resize` 里按上次 cols/rows 短路。
- 手柄命中区固定 4px（与 VS Code 同量级）。若反馈不好拖，可加透明 padding 扩命中区（勿改盒尺寸，否则会重排编辑器）。
- 三项改动仍需 `npm run tauri dev` 真指针走查：拖侧栏、拖面板、双击重置、Tab 到手柄后方向键微调、`Alt+←/→` 不被吞 → 已于 2026-09-09 由用户侧运行产物确认通过。
