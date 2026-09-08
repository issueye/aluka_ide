# TODO 2026-09-08（外部文件变更自动刷新编辑器）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-08 |
| 关联里程碑 | M3 增强（见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-03 / FR-04（见 [REQUIREMENTS.md](../../REQUIREMENTS.md)） |

## 今日目标（总）

1. 打开的文件被外部修改后，编辑器自动刷新为磁盘最新内容。
2. 脏文件外部变更时提供冲突选择，不静默覆盖。
3. 外部删除/重命名文件时标签不再无提示残留。
4. 提供「从磁盘重新载入」手动命令与菜单入口。

## 任务清单

### T1 后端事件负载结构化 ✅

- **具体目标**：`watch_workspace` 聚合事件由路径列表改为 `{ path, kind }` 列表，保留 create/modify/remove 语义。
- **验收标准**：
  - [x] `workspace:changed` 携带路径与变更类型
  - [x] `cargo check` / `cargo clippy -- -D warnings` 通过

### T2 editorStore 刷新链路 + 冲突提示 🔄

- **具体目标**：新增 `reloadFile`，未变脏自动刷新 Model/草稿；已变脏或文件被删时弹冲突/删除提示。
- **验收标准**：
  - [x] 代码实现完成（`reloadFile` + 冲突/删除弹窗）
  - [ ] UI 走查：干净文件外部修改自动刷新且不脏
  - [ ] UI 走查：脏文件外部修改弹冲突选择
  - [ ] UI 走查：文件外部删除弹保留/关闭提示

### T3 App 事件消费 + 手动命令/菜单/标签右键 🔄

- **具体目标**：`workspace:changed` 消费端调用 `reloadFile`；新增 `workbench.action.files.revert` 命令，接入菜单与标签右键。
- **验收标准**：
  - [x] App 事件消费调用 `reloadFile`，命令/菜单/标签右键入口已接入
  - [ ] UI 走查：命令面板可执行「从磁盘重新载入」
  - [ ] UI 走查：文件菜单与标签右键入口可用

### T4 会话恢复（工作区/标签重载后不丢） 🔄

- **具体目标**：最近工作区根与已打开标签持久化到 localStorage，刷新/重载后自动重开。
- **验收标准**：
  - [x] 代码实现完成（`getLastWorkspaceRoot` / `saveEditorSession` / 启动恢复）
  - [ ] UI 走查：外部文件更新触发刷新后，工作区与标签自动恢复
  - [ ] UI 走查：关闭文件夹后会话被清除

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 2026-09-08 | `npm run build`（tsc strict + vite） | ✅ 通过 | 含 `@xterm/addon-web-links` 依赖补齐 |
| 2026-09-08 | `cargo check` / `cargo clippy -- -D warnings` / `cargo fmt` | ✅ 通过 | — |
| 2026-09-08 | `npm run build` 复跑（预览标签固定抑制后） | ✅ 通过 | — |
| 2026-09-08 | `npm run build` 复跑（多冲突提示互斥后） | ✅ 通过 | — |
| 2026-09-08 | `npm run build` 复跑（会话恢复后） | ✅ 通过 | — |
| 2026-09-08 | REQUIREMENTS / DEVELOPMENT_PLAN 变更日志同步 | ✅ 通过 | v0.2.10 / v0.2.11 |
| 2026-09-08 | `npm run tauri dev` 人工走查 | ⛔ 未执行 | 需人工确认外部修改/冲突/删除三场景 |

## 未决问题与次日移交

- UI 走查需 `npm run tauri dev` 人工确认三个场景（外部修改自动刷新、脏文件冲突、外部删除），以及命令面板/菜单/标签右键入口。
