# TODO 2026-09-09（修复：欢迎页快捷键列表遮挡底部面板）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-09 |
| 关联里程碑 | M3 增强（布局健壮性）（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-01 / FR-04（编辑器区与面板布局，见 [REQUIREMENTS.md](../../REQUIREMENTS.md)） |

## 今日目标（总）

1. 编辑器组内容在可用高度不足时不得越过自身边界绘制到底部面板之上。
2. 欢迎页在窗口偏矮 / 面板打开时改为可滚动，内容不丢失。

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
  - [ ] `npm run tauri dev` 人工走查（矮窗口 + 打开面板 + 欢迎页滚动）

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 2026-09-09 | `npm run build`（tsc strict + vite） | ✅ 通过 | 仅 chunk 体积告警（既有） |
| 2026-09-09 | 等价最小复现页 + `elementFromPoint` 命中测试（面板标签栏 / 终端区 3 点） | ✅ 通过 | 修复前：3 点中有 2 点被欢迎页元素命中（遮挡）；修复后：3 点全部命中面板自身元素，欢迎容器底边与面板顶边精确相接并可内部滚动 |
| 2026-09-09 | `npm run tauri dev` 人工走查 | ⛔ 未执行 | 本环境无法常驻 dev server / 拉起 Tauri 窗口，需用户侧确认 |
| 2026-09-09 | `npm run tauri build`（release + 打包） | ✅ 通过 | 前端 `tsc && vite build` → `cargo build --release`（3m46s）→ MSI + NSIS 双产物 |
| 2026-09-09 | 产物冒烟：直接运行 `aluka-ide.exe` | ✅ 通过 | 进程正常启动驻留，启动工作集 24.4MB（NFR-02 空闲 ≤300MB 达标）；测试后已关闭 |
| 2026-09-09 | 产物体积核对（NFR-01 ≤25MB） | ✅ 通过 | exe 11.00MB / MSI 4.40MB / NSIS setup 3.18MB |

## 未决问题与次日移交

- 欢迎页快捷键列表较长（10 条），矮窗口下需滚动才能看全；如需彻底避免，可考虑按高度自适应折叠或减少条目（属体验优化，未擅自扩权）。
- 用户需在自己运行的实例中重启/热更新确认遮挡消失。
