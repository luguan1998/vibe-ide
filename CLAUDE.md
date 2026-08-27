# CLAUDE.md

Vibe IDE — Electron-based desktop IDE with native terminal, git, file diff/edit, content search, and session management. Built with electron-vite, React, TypeScript, Tailwind CSS.
- 使用sonnet搜索网上方案，sonnet才有搜索能力。
- 不要加注释，除非是反复修改的问题。
- ui交互相关的修改只需要人类验证，ai只负责检查基本语法。

## UI Coding Rules

1. **抄骨不凭记** — 凡言"跟XX一样"，先 Read 模板代码，类名逐个对照，不得凭记忆自创
2. **同级同骨架** — 同级菜单/列表项，容器结构（padding/margin/分隔线）必须一致，写完 grep 同类 className 验证
3. **细节照抄** — 圆点、图标等视觉细节照搬模板写法，不变种
4. **颜色用主题色** — 新增颜色用 `var(--ide-xxx)` 或 Tailwind token `text-ide-xxx` / `bg-ide-xxx`，不硬编码 `rgb()` / `#hex`
5. **遍历交互态** — 改完后脑中过一遍 hover/选中/空态/中英文/分隔线覆盖范围
6. **信息不过二** — 同一份数据出现两次以上，立刻抽共享常量，不种重复因
7. **禁用同步弹窗** — 严禁使用 `confirm()`、`prompt()`、`alert()` 等同步阻塞式浏览器原生弹窗。确认/输入类交互统一使用异步 Modal 模式（参考 `confirmAction` 状态 + fixed 定位弹窗，或内联 `<input>` 编辑）
8. **被调先于主调** — `const` 声明（含 `useCallback`）不提升，被调函数必须在调用方之前定义。违反会触发 `ReferenceError: Cannot access 'xxx' before initialization`
9. **ESC 按注册顺序分层**（均为 window capture）：
   - App.tsx 最先：NavBar → history → callGraph → codeSearch → exploreResult → focus return(`centerView === 'terminal'`)
   - DiffViewer：关 diff（capture 因 Monaco 会抢清选区）
   - MarkdownPreview / ImagePreview：关预览
   上层命中即 `stopImmediatePropagation()`，下层不再执行
10. **Modal/Overlay 按键拦截用 capture + stopImmediatePropagation** — xterm.js 冒泡阶段会消费按键，capture 阶段拦截方可阻止泄漏。参考 `TerminalView.tsx` filePicker handler
11. **Caps Lock 安全** — 字母键判断必须 `.toLowerCase()`：`e.key.toLowerCase() === 's'`，不得直接 `e.key === 's'`。Caps Lock 时 `e.key` 为大写，直接比较会漏匹配

## Commands

```bash
npm run dev           # electron-vite dev，热更新
npm run build         # gen-dsh-client-plugins.mjs（扫描 dsh 依赖生成插件清单）+ electron-vite build → ./out/
npm run typecheck     # tsc -b（本机大工程易 OOM；小验证用 esbuild 单文件转译）
npm run build:win:7z  # build + electron-builder 打包 win 7z（镜像走 npmmirror）
npm test              # node --test test/**/*.test.mjs
npm run test:perf     # 性能测试：自动 build + 启动 + 快速文件切换 + 采集 CPU/内存 + 关闭
npm version patch     # 0.11.4 → 0.11.5  修bug
npm version minor     # 0.11.4 → 0.12.0  新功能
```

## Architecture

```
src/
├── main/                         # 主进程 (Node.js)
│   ├── index.ts                  # 应用生命周期、窗口管理、IPC 注册
│   ├── pty.ts                    # node-pty 终端会话管理
│   ├── git.ts                    # simple-git 版本控制（含 lineLog/graph）
│   ├── file.ts                   # 文件系统读写、目录树（iconv-lite/jschardet 编码探测）
│   ├── search.ts                 # ripgrep 内容搜索（grep/replace）
│   ├── watcher.ts                # chokidar 文件变动监听（fs:changed 推送）
│   ├── codegraph.ts              # CodeGraph 调用图索引（生成/查询/进度/MCP）
│   ├── ai.ts                     # Claude CLI 子进程管理（configDir → CLAUDE_CONFIG_DIR + 同目录 JSONL）
│   ├── ai-history.ts             # JSONL 会话历史读取
│   ├── ai-ask-resume.ts          # 断点续聊（resume）
│   ├── ai-plan-execute.ts        # plan 模式执行
│   ├── ai-revert.ts              # 消息回退（revert/fork，真实 user turns 为单真相源）
│   ├── dsh.ts                    # dsh（DeepSeek harness）服务：拉起/端口/会话/插件/重启
│   ├── computer-use.ts           # computer-use MCP 服务
│   ├── board.ts                  # 会话看板（kanban）记录
│   ├── ocr.ts                    # tesseract.js 图片 OCR
│   └── …                          # 其余见 git history 命名即功能
├── preload/
│   └── index.ts                  # contextBridge 桥接层（16 命名空间，见下）
├── renderer/src/
│   ├── main.tsx                  # React 挂载入口（Monaco 预载）
│   ├── App.tsx                   # 三栏布局、会话管理、全局快捷键
│   ├── shortcuts.ts              # 快捷键定义注册
│   ├── aiStore.ts                # AI 会话全局状态（zustand）
│   ├── sessionRestore.ts         # 会话恢复
│   ├── i18n.ts                   # 中英文文案
│   ├── styles/globals.css        # Tailwind + CSS 变量 + 自定义动画
│   ├── themes/                   # 15 套主题 + Monaco 主题 + ThemeProvider Context
│   ├── languages/                # 语法高亮 token 注入（jsx/python/shell）
│   ├── dsh/                      # DshView 根组件、context、动态插件、主题桥
│   └── components/
│       ├── SessionPanel.tsx      # 左侧会话列表
│       ├── NavBar.tsx            # 顶部导航栏（最近文件/新旧 UI 切换）
│       ├── TerminalView.tsx      # xterm.js 终端 (中栏)
│       ├── DiffViewer.tsx        # Monaco 编辑器/Diff (中栏)
│       ├── RightPanel.tsx        # 右侧多 tab 面板（编排器）
│       ├── GitTab.tsx / GitGraph.tsx    # Git 版本控制 + 提交图
│       ├── AuxTab.tsx            # 辅助终端 + CLAUDE.md 命令
│       ├── FileTab.tsx           # 文件浏览器
│       ├── SearchPanel.tsx       # 文件内容搜索
│       ├── AiTab/                # AI 对话（messages/markdown/permissions/tools）
│       ├── DshView.tsx / DshPluginTab.tsx # DeepSeek harness 对话（cc GUI）+ 插件管理
│       ├── HistoryView.tsx / CustomCommands.tsx   # 会话历史 / 自定义命令
│       ├── CallGraphOverlay.tsx / CodeGraphSearch.tsx / CodeGraphExploreResult.tsx  # CodeGraph 交互三件套
│       ├── BoardView.tsx         # 会话看板
│       ├── BrowserView.tsx       # AI 网页预览
│       ├── DesktopPet/           # 桌宠（webp 精灵图 + AI 语音气泡）
│       ├── GameLauncher.tsx + Game*  # 内置小游戏（2048/balatro/fruit-ninja/sandspiel/vampire）
│       ├── MarkdownPreview.tsx / ImagePreview.tsx / MarkdownCodeBlock.tsx  # 预览
│       ├── QuickOpen.tsx / OutlinePanel.tsx / KeypadConfigModal.tsx / DirectoryPicker.tsx / ModalOverlay.tsx
│       ├── SettingsPanel.tsx / AppearancePanel.tsx / WelcomeScreen.tsx / ErrorBoundary.tsx
│       ├── FileIcons.tsx / DocTree.tsx   # 文件图标映射 / CLAUDE.md 解析文档树
│       └── …
└── shared/
    ├── types.ts                  # IPC 通道常量 + 跨层类型定义
    └── encodings.ts              # 编码探测/转换

```

**IPC 频道**（`src/shared/types.ts`，preload 暴露 16 命名空间：terminal/git/file/claudeConfig/workspace/search/theme/ocr/snippets/pet/perf/system/code/ai/board/dsh）：
- **pty**：create/write/resize/rename/close/getShells/refreshEnv/data/exit
- **git**：setWorkspace/status/log/lineLog/graph/diff/add/reset/commit/amend/branches/checkout/applyBranch/stash/push/init/show/showFile/diffCommitFile/worktree/deleteBranch/setFilterRules/discard
- **file**：read/write/readEncoding/writeEncoding/list/tree/delete/rename/createDir/openExplorer/copy/move/getDrives/find/searchByName + `fs:changed` 推送
- **workspace**：open/current/pickDir；**search**：grep/replace
- **code**：setWorkspace/init/searchNodes/getCallers/getCallees/isIndexing/progress/cancelInit/getStats/installMcp/findRelevantContext/explore/setEnabled/checkAvailable
- **ai**：create/send/cancel/forceStop/destroy/checkAvailable/会话管理（list/load/delete/search，按 dir 与按 session 两套）/permissionResponse/planExecute/setPermissionMode/setModel/setContextWindow/askResume/resolveConfigDir/revert/fork/reply（init/stop/read/reply 桌宠气泡）+ 推送 streamToken/message/progress/permission/ready/modelChanged/error/fileChange
- **dsh**：start/stop/getPort/deleteSession/plugin（管理插件）/restart/ready；**board**：records/create/finish/clear/merge/mergeAbort
- **pet**：list/setActive/delete/changed；杂项：claudeConfig:dir、titlebar:update、font:adjust/list、focus:settings、startup:openPath、perf:snapshot、ocr:recognize、app:version、snippets:load/toggle

**关键依赖：** `node-pty`（external from Rollup）、`@xterm/xterm`、`@monaco-editor/react`、`simple-git`、`@vscode/ripgrep`、`chokidar`、`tesseract.js`（OCR）、`iconv-lite`/`jschardet`（编码）、`sharp`、`koffi`、`@deepseek-ai/dsh harness`（vendored 于 `vendor/harness`，含 cordis 运行时，通过 `scripts/patch-*.mjs` 在 postinstall 打补丁，升级 vendor 会丢补丁需重打）
- 渲染层：`@xterm/xterm` + addons（fit/webgl/search/clipboard/unicode-graphemes/web-links）、`@monaco-editor/react`、`react-markdown` + `shiki` + `katex` + micromark 系（AI 消息渲染）、`mermaid` + `dagre`（调用图/流程图）、`lucide-react`、`zustand` + `immer`、`@tanstack/react-virtual`、`turndown`（网页→markdown）、`@modelcontextprotocol/sdk`、`@earendil-works/pi-ai`
- **终端背景图 (`--terminal-bg-image`)**：xterm.js >= 6.1.0-beta 已修复 CSS 黑底 + WebGL 透明问题（`.xterm:not(.allow-transparency) .xterm-viewport` 条件化 + PR #5561）。背景图 CSS 变量由主进程 `resolveCssUrls()` 将 `url()` 转 base64 以绕过 dev 模式跨域。详见 `terminal-bg-image` 记忆
- **xterm 自绘滚动条**：xterm.js 6.x 使用自定义 DOM 滚动条（`.xterm-scrollable-element > .xterm-scrollbar > .xterm-slider`），而非浏览器原生滚动条。`::-webkit-scrollbar-*` 伪元素对其无效。xterm 运行时动态注入 `<style>` 设置 `.xterm-slider` 的 `background`，snippets CSS 需 `!important` 覆盖。原生 `.xterm-viewport` 滚动条应 `display: none` 隐藏，否则底部会露出多余轨道空隙

**路径别名：** `@renderer/*` → `src/renderer/src/*`、`@shared/*` → `src/shared/*`

## Session Independence

Each terminal session owns its RightPanel/GitTab state independently — **no global singletons in renderer state.**

- RightPanel/GitTab state tied to active session **must** be keyed by `activeSessionId` (e.g. `Record<string, ...>`), never a single value.
- The main-process `git.ts` uses a global `gitInstance` + `currentWorkspace`. The renderer compensates via `git.setWorkspace()` in `useEffect` on the per-session effective path.
- Do NOT rely on `workspacePath` prop changes alone to detect session switches — two sessions can share the same cwd.
- **`pendingPathRef` 防 stale 模式**：异步加载路径相关数据（git status、CLAUDE.md commands）时，`await` 后必须对比 `pendingPathRef.current !== targetPath`，路径已变则丢弃结果。参考 `GitTab.tsx:513-539`、`AuxTab.tsx:47-67`。

## Navigation & Focus Design

| 快捷键 | 行为 |
|--------|------|
| `Ctrl+ArrowLeft/Right` | 切换右侧 panel tab 并聚焦新 tab（Git/Aux→容器，Search→input） |
| `Ctrl+ArrowUp/Down` | blur 右侧 panel → 切换 session → 聚焦新终端 |
| `Ctrl+F` | 切到 Search tab 并聚焦输入框 |

**规则：**

1. 切 tab 聚焦用 `focus({ preventScroll: true })`，避免浏览器滚动干扰内部容器
2. 各 tab 键盘导航 idx 独立（`focusedIndex` / `selectedCommandIndex`），切 tab 或切 session 时必须复位为 `null`
3. tab 内全局 `keydown` 监听器（`window.addEventListener('keydown', ..., true)`）必须检查 `isActiveRef.current` 和修饰键（`e.ctrlKey/e.metaKey/e.altKey`），非活动 tab 或有修饰键时直接 return

**实现位置：** `App.tsx`（全局快捷键 + session 切换）、`RightPanel.tsx`（tab 切换聚焦）、`GitTab.tsx`（文件列表导航）、`AuxTab.tsx`（命令列表导航）

## CSS Snippets 系统

```
{exeDir}/
└── snippets/          # CSS 片段目录，重启生效
    ├── snippets.json  # 启用/禁用状态（自动生成）
    └── *.css          # 任意 CSS 文件
```

- **覆盖主题色变量必须加 `!important`** — `ThemeProvider` 用 `setProperty` 写内联样式（优先级 1000），普通 `:root` 规则无效。例：
  ```css
  :root { --ide-accent: 255 179 0 !important; }
  ```
- BEM 语义类名（`.session-item--active`、`.git-tab__section-header` 等）无需 `!important`，它们选择的是具体元素而非变量
- 颜色值必须写成 `R G B` 空格分隔（如 `22 22 18`），不要 `#hex` 或 `rgb()`，否则 Tailwind 透明度修饰符 `/50` 会失效
