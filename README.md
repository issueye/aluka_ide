# Aluka IDE

轻量级桌面 IDE：**Rust + Tauri 2 + React 18 + TypeScript + Monaco Editor**，VS Code 观感（Dark+），兼容 VS Code 扩展格式的**子集**（清单 / 颜色主题 / 代码片段 / 本地 VSIX 安装）。**完全不联网、不执行扩展代码**。

目标是在保留日常编辑体验（文件树 / 全局搜索 / 多标签编辑 / 终端 / 命令面板 / 主题）的同时，把安装包控制在 25MB 以内、空闲内存控制在 300MB 以内。

## 功能总览

- **工作区**：打开文件夹（系统对话框）、目录树懒加载、新建/重命名/删除（回收站）/刷新、文件变更自动刷新（notify 监听）
- **编辑器**：Monaco（本地打包，零语言 worker，按需 Monarch 高亮 20+ 语言）、多标签、脏标记、关闭确认、大文件保护（>5MB 只读、>20MB 拒绝）、文件内查找、分屏多编辑器组、预览标签页（单击斜体预览，未修改原位替换；变脏/双击/「保持打开」转常驻）
- **代码跳转**：转到定义（F12 / Ctrl+点击，单命中直跳）、查看定义 Peek（Alt+F12）、查找所有引用（Shift+F12）——多定义/引用在编辑器内 Peek 浮层呈现（按文件分组 + 代码上下文预览）；后退/前进（Alt+←/→）跳转历史；光标处符号同词高亮；工作区符号（Ctrl+T）——文本级定义索引（rust/go/python/ts/js/java 系），文件变更自动失效重建
- **Markdown 预览**：md 文件组内编辑/预览切换（Ctrl+Shift+V），零依赖安全渲染，外链点击复制地址
- **搜索**：工作区全文搜索（大小写 / 整词 / 正则；结果按文件分组，点击跳转到行）
- **终端**：cmd 管道会话（UTF-8）、多标签、流式输出、输入行回显
- **命令与快捷键**：命令注册表 + 快捷键中枢（单表分发）、命令面板（模糊匹配 + 最近使用置顶）、快速打开（Ctrl+P）
- **主题**：内置 Dark+ / Light+；主题引擎支持 VS Code 主题 JSON（colors → CSS 变量、tokenColors → Monaco rules），扩展主题即插即用
- **扩展**（声明式，不执行扩展代码）：本地 VSIX 安装（zip-slip 防护 + `publisher`/`name` 白名单 + 目标目录归属断言 + 解包体积/条目上限）、全局 + 工作区两级目录、颜色主题即装即用、代码片段注入补全、列表点击查看 README 详情（本地相对图片 base64 内联，零外联）、禁用/卸载即时清理主题与片段注册
- **设置**：主题 / 字号 / 自动保存，持久化到 `~/.aluka-ide/settings.json`

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 全部保存 |
| `Ctrl+W` | 关闭标签 |
| `Ctrl+B` | 显示 / 隐藏侧边栏 |
| ``Ctrl+` `` | 显示 / 隐藏底部面板（终端） |
| `Ctrl+Shift+E/F/X` | 资源管理器 / 搜索 / 扩展 |
| `Ctrl+Shift+G` | 源代码管理 |
| `Ctrl+Shift+V` | Markdown 预览/编辑切换 |
| `Ctrl+PageUp/PageDown` | 上一个 / 下一个标签 |
| `F12` / `Alt+F12` / `Shift+F12` / `Ctrl+T` | 转到定义 / 查看定义 Peek / 查找所有引用 / 工作区符号 |
| `Alt+←` / `Alt+→` | 后退 / 前进（跳转历史） |

## 快速开始

环境要求：Node.js ≥ 18、Rust（stable，含 MSVC 工具链）、Windows 10+（其他平台代码层可移植，验证次序靠后）。

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式（热重载窗口）
npm run tauri build  # 产物：dist/（前端）+ NSIS 安装包（src-tauri/target/release/bundle/nsis/）
```

质量检查：

```bash
npm run build                    # tsc strict + vite 构建
cd src-tauri && cargo check      # Rust 检查
cd src-tauri && cargo clippy -- -D warnings && cargo fmt
cd src-tauri && cargo test       # 搜索匹配器等单元测试
```

## 扩展开发指南

Aluka 兼容 VS Code 扩展格式的子集：一个扩展就是一个目录（VSIX 内为 `extension/` 前缀），根下放 `package.json` 清单，安装后主题从主题选择器使用、片段在编辑器中直接触发。

> **能力边界**：扩展是**纯声明式数据**，应用**不执行任何扩展 JavaScript**。
> 因此 `main`、`contributes.commands`、`contributes.keybindings` 均被忽略。

### 清单（L1）

```jsonc
// extension/package.json
{
  "name": "monokai-theme",
  "displayName": "Monokai 主题示例",
  "description": "…",
  "version": "0.0.1",
  "publisher": "aluka-samples",
  "contributes": {
    "themes":   [{ "label": "Monokai（Aluka 示例）", "path": "./themes/monokai.json" }],
    "snippets": [{ "language": "javascript", "path": "./snippets/javascript.json" }]
  }
}
```

### 颜色主题（L2）

主题 JSON 使用 VS Code 形状：`type`（dark/light）+ `colors`（workbench 色映射到 UI CSS 变量）+ `tokenColors`（TextMate scope → Monaco rules）。参考 `examples/extensions/monokai-theme`。

色值与 `tokenColors` 会先经白名单校验再写入样式：`url(...)` 等可触发外联或注入的取值一律丢弃；损坏条目跳过而不中断激活。

### 代码片段

`contributes.snippets` 指向 VS Code 片段 JSON（`前缀 → { body, description }`，支持 JSONC），注册为 Monaco 补全项，键入前缀即触发。

### 打包与安装

```bash
# 零依赖打包脚本（stored ZIP，正斜杠条目名）
node scripts/make-vsix.mjs examples/extensions/monokai-theme aluka-monokai-0.0.1.vsix
```

应用内：扩展视图 → 「从 VSIX 安装」。全局扩展位于 `~/.aluka-ide/extensions/`，工作区级 `<workspace>/.aluka/extensions/` 优先级更高。禁用/卸载后重开应用生效。

### 兼容性分级与明确不承诺

| 级别 | 能力 | 状态 |
| --- | --- | --- |
| L1 | 清单识别 | ✅ 本期 |
| L2 | 颜色主题 | ✅ 本期 |
| — | 代码片段（`contributes.snippets`） | ✅ 本期 |
| L3 | 命令 / 快捷键 + `main.js` 沙箱 | ❌ **已移除**（见下） |
| L4 | Webview 自定义视图 | 规划 |
| L5 | 完整 vscode.* + Node 宿主 | 远期（与"轻量"目标冲突） |

**L3 为何移除**：在缺少文档同步、编辑器访问与事件派发的条件下，`main.js` 沙箱只能支撑「注册一个弹通知的命令」，却要付出执行任意 JS 的全部安全代价与最重的维护成本；同时会在命令面板留下「可点但无实现」的死命令，体验上比不支持更差。故整体移除，扩展退化为不可执行的声明式数据。

**同时移除在线市场（Open VSX）**：它是唯一需要联网的功能。移除后应用**零网络依赖**（NFR-03/NFR-06 完全达成），VSIX 仅来自用户本地文件。

明确不承诺：VS Marketplace / Open VSX 在线安装、账号体系与同步、调试器（DAP）、LSP 语义级导航与补全（代码跳转为文本级定义索引，非语义分析）、Remote 开发、扩展 Webview 视图（L4 规划中）。

## 架构速览

```
src/
├── commands.ts        # 命令注册表 + 快捷键中枢（单表分发）
├── theme.ts           # 主题引擎：colors→CSS 变量、tokenColors→Monaco rules
├── settingsStore.ts   # 设置持久化（~/.aluka-ide/settings.json + localStorage 兜底）
├── editorStore.ts     # Monaco model/标签/脏标记/行跳转信号
├── terminalStore.ts   # 终端会话 + terminal:output/closed 事件
├── extHost/           # 扩展宿主：清单收窄、激活管线、vscode 垫片
├── tauri.ts           # 后端命令唯一封装层（组件禁止直接 invoke）
└── components/        # TitleBar/ActivityBar/SideBar/EditorArea/Panel/StatusBar/
                       # CommandPalette/SearchView/ExtensionsView/Notifications
src-tauri/src/
├── lib.rs             # 文件系统命令、设置、git 分支、命令注册
├── search.rs          # 工作区搜索（大小写/整词/正则 + 截断）
├── terminal.rs        # cmd 管道会话 + 读线程 emit
└── vsix.rs            # VSIX 解包（zip-slip 防护）与扩展扫描
```

约定：前端仅经 `src/tauri.ts` 调用后端；主题色一律用 `--aluka-*` CSS 变量（供主题引擎覆盖）；新增命令须"Rust 实现 → invoke_handler 注册 → tauri.ts 类型化封装"三件套。协作规范见 [AGENTS.md](AGENTS.md)，需求与计划见 `.work/`。
