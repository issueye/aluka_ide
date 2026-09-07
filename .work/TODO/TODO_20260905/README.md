# TODO 2026-09-05（Day 12 · 里程碑 M9 增强）

> 状态标记：⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⛔ 受阻

| 项 | 内容 |
| --- | --- |
| 日期 | 2026-09-05 |
| 关联里程碑 | M9 代码跳转（增强重构，见 [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md)） |
| 关联需求 | FR-20（见 [REQUIREMENTS.md](../../REQUIREMENTS.md)）、编辑器行为基线（VS Code 观感） |

## 今日目标（总）

1. 预览标签页（VS Code 行为）：单击打开的文件以「预览」态进入标签栏（斜体显示），未修改时再次单击其他文件将**原位替换**预览标签；编辑（变脏）或双击标签/文件后转为常驻。
2. 代码跳转重构（参考 VS Code 设计）：多定义/引用改为**编辑器内 Peek 浮层**（锚定光标行，左列表右预览）；新增**后退/前进**跳转历史（Alt+←/→）；新增 Peek 定义（Alt+F12）；光标处符号自动高亮（wordHighlighter）；跳转逻辑从 commands.ts 拆分为独立 navigation 模块。

## 任务清单

### T1 预览标签页（preview tabs） 🔄

- **具体目标**：`EditorTab` 增加 `preview` 标记；`openFile` 支持 `opts.preview`（默认 true 与 VS Code `enablePreview` 一致）；打开新文件时原位替换目标组内未变脏的预览标签；变脏自动转常驻；`pinTab` 动作供双击/右键「保持打开」。
- **验收标准**：
  - [ ] 资源管理器单击打开 → 标签斜体；再单击另一文件 → 斜体标签被替换且新文件为预览态
  - [ ] 编辑预览文件（变脏）→ 斜体消失（转常驻），再单击其他文件不再替换它
  - [ ] 双击标签或右键「保持打开」→ 转常驻；双击资源管理器文件 → 直接常驻打开
  - [ ] Ctrl+P / 搜索结果 / 跳转打开同样为预览态（与 VS Code 默认一致）；分屏组内各自独立替换

### T2 代码跳转重构（VS Code 设计） 🔄

- **具体目标**：新 `navigationStore.ts`（后退/前进历史栈 + Peek 状态）与 `navigation.ts`（跳转流程单点：定位→直跳/Peek/提示 + 历史记录）；新 `PeekView.tsx`（锚定光标行、过滤输入、左候选右代码预览、Enter 跳转）；F12 单命中直跳、多命中 Peek（`gotoAndPeek` 语义）；Shift+F12 引用 Peek（按文件分组、列级定位）；Alt+F12 强制 Peek；Alt+←/→ 后退/前进；Monaco 引入 wordHighlighter 贡献实现光标词高亮。
- **验收标准**：
  - [ ] F12/Ctrl+点击：单定义直接跳转；多定义弹出光标行下方 Peek，候选可过滤、上下键选择、Enter 跳转、Esc 关闭
  - [ ] Shift+F12：引用以 Peek 呈现并按文件分组，标题含「N 个结果 · M 个文件」；单引用也可 Peek（Alt+F12 同）
  - [ ] Alt+←/→ 在跳转历史间后退/前进；跳转（定义/引用/符号/搜索结果/转到行）前记录当前位置
  - [ ] 光标停留在符号上时编辑器内同词出现高亮（wordHighlighter）
  - [ ] jump 命令面板模式移除，`PaletteKind`/symbolsStore 无残留；`npm run build` 通过

### T3 文档收口 ⬜

- **验收标准**：
  - [ ] REQUIREMENTS.md FR-20 措辞与变更日志 v0.2.6
  - [ ] DEVELOPMENT_PLAN.md 变更日志；README 快捷键表补 Alt+←/→、Alt+F12 与预览标签说明

## 验证记录

| 时间 | 验证项（命令/操作） | 结果 | 备注/截图 |
| --- | --- | --- | --- |
| 09-05 | `npm run build`（tsc strict + vite） | ✅ 通过 | 修复 5 处类型错误后绿 |
| 09-05 | `cd src-tauri && cargo check` | ✅ 通过 | 仅环境性增量缓存警告，无代码警告 |
| 09-05 | `npm run tauri dev` 走查 T1 | ✅ 4/4 | 单击斜体预览 ✓；再单击原位替换 ✓；编辑变脏转常驻（脏点+正体）✓；双击标签转常驻、常驻标签不被后续预览替换 ✓ |
| 09-05 | `npm run tauri dev` 走查 T2（部分） | 🔄 2/5 | F12 多定义 Peek 锚定光标行弹出 ✓（按文件分组 + 右侧目标行高亮预览，截图见走查）；Alt+← 后退在跳转栈间回退 ✓；Peek Enter 跳转 / Shift+F12 引用 Peek / 光标词高亮因 dev 窗口关闭未走查完成 |
| | 走查中断说明 | ⛔ | 合成输入与前后台窗口焦点竞态导致状态漂移（打开无关文件），且 dev 进程随后退出；不影响已验证项结论，剩余三项下次走查补齐 |

## 未决问题与次日移交

- Peek 浮层为轻量自绘（Monaco standalone 无 Peek Zone Widget 公开 API）；与 VS Code 原生 Peek 的差异（嵌套 Peek、Peek 内编辑）暂不承诺。
- 次日移交：补走查 Peek 候选 Enter/点击跳转目标正确性、Shift+F12 引用 Peek、wordHighlighter 光标词高亮三项（代码路径已实现并通过类型检查，仅 UI 证据未采集）。
