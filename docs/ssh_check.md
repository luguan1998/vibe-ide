三个并行深挖审计里，内容链（EOL/编码）那个已完成，我自己的主链路核查也做完了。先给出已实锤的排查报告；另外两个后台审计（主进程互通链、渲染层路径假设）还在跑，回来后我再补充增量。

# 排查报告：Windows 本机 ↔ SSH Linux 远端互通 bug

已修的 Monaco CRLF 污染（bcda7669）属于“**跨平台默认值悄悄改写内容**”这一类。按这个类别顺藤摸瓜，实锤如下：

## A. 内容破坏类（和 EOL bug 同族，会毁数据）

**A1. 混合换行文件整篇被改写 —— EOL 修复自身残留的同类 bug** 🔴
`src/renderer/src/components/DiffViewer.tsx:746`：`if (raw.includes('\r\n')) eol = CRLF` 是**首个匹配**而非多数决。1000 行 LF + 1 行 CRLF 的文件 → `setEOL(CRLF)` → Monaco 归一把全部换行改写 → 保存时整篇变 CRLF。Monaco 自己建 model 时是按 cr/lf/crlf **计数多数决**的，这里恰好只在混合换行文件上偏离。修法：数一下 `lf` 与 `crlf` 出现次数取多数。

**A2. diff 视图读写非 UTF-8 文件即毁** 🔴
edit 视图走 `readWithEncoding`（base64 → jschardet/iconv），但 diff 视图 `loadContents` 走旧通道 `file.read`（`DiffViewer.tsx:604,623` → `src/main/file.ts:281-307`，本地 `readFile utf-8`，远端 `relay fs.readText` 也是 utf-8，`src/relay/index.ts:45`）。GBK/Big5 文件在 diff 右侧直接乱码，而右侧**可编辑且 Ctrl+S 生效**（`DiffViewer.tsx:1120-1124` → `handleSave` 用 utf-8 写回）→ 不改一个字按下 Ctrl+S 文件就毁了。文件对比入口（`App.tsx:3417`）同通道同炸。

**A3. MarkdownPreview 同款双倍炸** 🔴
`MarkdownPreview.tsx:786` 读 + `:415` 写都是 utf-8 直通。非 UTF-8 的 md 双击编辑一个块、保存 → 整篇从乱码重编码。

**A4. BOM 每次编辑保存即永久丢失** 🟠
`iconv.decode` 对 utf-8/utf-16 默认剥 BOM（`node_modules/iconv-lite/lib/index.js:131` 已核实），而 `FILE_WRITE_ENCODING` 的 `iconv.encode` 不带 `addBOM`（`file.ts:342-359`）。读路径报了 `bom:true` 但只拿去显示 "BOM UTF-8" 标签。结果：edit 模式保存一次 BOM 没了；diff 模式（`file.read` 保留 \uFEFF 字符）反而能写回——同一文件两条路径行为不一致。

**A5. AI 回退快照也是裸 utf-8** 🟠
`src/main/ai.ts:542` `readFile(absPath,'utf-8')` 存旧内容 → 渲染层回退时 `file.write` 原样写回。GBK 文件被 AI 改过再回退 = 用乱码覆盖。

**A6. search.replace 全链 UTF-8** 🟠
`src/main/search.ts:311-324`：`readFile utf-8` → 替换 → `writeFile utf-8`。GBK 文件被 rg 命中后从乱码写回；且字面 `\n` 替换串进 CRLF 文件产生混合换行。

## B. SSH 远端会话的静默失效（互通层缺口）

**B1. 内容搜索/替换完全没有远端路由** 🔴
`search.ts` 全文件无任何 relay/remote 分支（已 grep 证实）。SSH 会话下 SearchPanel（`App.tsx:4376` 传 posix cwd）和文件树内搜索（`FileTab.tsx:990`）spawn 本地 `rg`，cwd 是 `/home/...` → 失败回落 `nodeSearch` 的 `readdir` 也失败 → **静默 0 结果**。替换同样空转。远端要嘛加 `search.grep/replace` relay 方法，要嘛明确禁用提示。

**B2. 终端路径链接对远端被“反斜杠化”** 🔴
`src/renderer/src/utils/filePathUtils.ts:84` 无条件 `fullPath.replace(/\//g, '\\')`。远端终端输出的 `/home/u/p/src/a.ts:42` 被改成 `\home\u\p\...` → 本地 `stat` ENOENT → 全靠“裸文件名递归搜索”回退（relay `fs.find`）救场；一旦同名多命中靠 picker 尚可，但**超深（>5 层）/被过滤/找不到时就静默死链**，直接路径解析等于全废。修法：按 cwd 是否盘符路径决定要不要反转分隔符。AiTab 正文链接共用此函数，同病。

**B3. AI GUI 会话能开在远端 cwd 上 → 必炸** 🟠
快捷新建把 newMode 切到 Claude/Pi 后点 "New Session"（`SessionPanel.tsx:910-912` → `App.tsx:2261`）：SSH 会话 active 时传入的是远端 posix cwd，`mode!=='term'` 分支直接建 gui 会话 → 主进程本地 spawn claude，`cwd='/home/...'` → ENOENT，会话永远起不来。DirectoryPicker 的 SSH 入口固定 `'term'` 是对的，这里漏了同样的 gate。

**B4. LSP / CodeGraph 在远端会话未隔离** 🟠
- LSP：`lsp.ts:338` 本地 spawn，`cwd` = 远端路径 → 起不来，F12/引用/defHint 永远 "warming"。
- CodeGraph 更糟：全局单例 `cg` 只在 `isInitialized(cwd)` 为真时才 `setWorkspace`（`SearchPanel.tsx:204-213`），远端恒 false → **cg 停在上一个本地仓库**。远端文件右键 "Open Call Graph"（`App.tsx:1118-1132` 无任何 gate）→ 画出**别的仓库**的图，点节点还会用 `resolveAbsPath(node.filePath, 远端cwd)` 拼出错误远端路径。跨仓数据串台。

**B5. 远端图片/HTML 预览全断** 🟠
`ImagePreview.tsx:21` 和 `MarkdownPreview.tsx:548-551` 都转本地 `file:///` URL。远端 posix 路径本机不存在 → md 内嵌图、图片 tab、html 预览（`App.tsx:1525`）全 404。要走 relay 拉字节（类似剪贴板的中转方案已有：`file.ts:494-506`）。

**B6. 远端无文件监听（架构性已知限制）** ⚪
`watcher.ts` 只挂本地；git.ts 已 gate（`git.ts:185-188`）。远端树靠 `vibe-agent-idle` / `remote-session-ready` 兜底刷新（FileTab 注释自知）。列出备档。

## C. 低危细节

- **C1** 文件树笔刷注解把远端相对路径分隔符替换为 `\\`（`FileTab.tsx:113`），插到远端会话输入框的 `src\a.ts` 在 Linux 不识别；GitTab 用的 `vibeEvents.toRelPath` 不替换——两处行为不一致，同语义两套。
- **C2** "Open Containing Folder" 等在远端已被主进程 gate（`file.ts:533,548`），但 renderer 不展示返回的 error → 点了没反应。
- **C3** SSH 克隆会话的 `initCommand` 被 `createSshTerminalSession` 静默丢弃（`pty.ts:297-350` 不消费该字段）。
- **C4** `resolveRepoFile` / 各处 `toLowerCase()` 前缀比较对大小写敏感的 Linux 文件系统理论上可误配（实际两侧同源，低危）。
- **C5** BOM 文件的 frontmatter 识别失败：`trimStart()` 不剥 `\uFEFF`（`MarkdownPreview.tsx:160-161`）。
- **C6** CodeGraphSearch 修复 `.gitignore` 排除项时把整篇换行归一成 LF（`CodeGraphSearch.tsx:92-132`）。
- **C7** `board.ts:74` / `ai-worktree.ts` 往 git exclude 追加 LF 行（git 不在乎，cosmetic）。

## 核实过没问题的（不用再查）

- **EOL 修复本身覆盖完整**：edit/diff 双 model、重开编码、单行回退、`monacoRef` 时序（@monaco-editor/react 按最新 props 建 model，空内容注入只在已 mount 时发生）都对；AiTab/tools.tsx 的 Monaco 只读不落盘，不在 bug 类内。
- **写链字节级透传**：`writeWithEncoding` → base64 → relay `fs.writeBase64` 全程不碰换行。
- **git 远端链路可用**：`remoteGit` Proxy → relay `git.call`，`core.quotePath=false` 两端一致；lineLog 的 `posix.resolve` 也对。
- **fsWalk/relay 在 Linux 侧用平台相对 `join`**，天然正确。
- **SSH 终端启动**：`cd -- '单引号'` POSIX 引用正确；本地 shell/agent 注入已被 `terminalCreateArgs` gate。
- **剪贴板/拖拽跨后端**已有临时目录中转。

## 修复优先级建议

1. **B2**（filePathUtils 按平台化分隔符，几行）—— 效果立竿见影
2. **A2/A3**（diff/markdown 读改走 readWithEncoding；顺带堵住远端非 UTF-8）
3. **A1**（EOL 多数决，一行）
4. **A4**（写回补 BOM）
5. **B3**（gui 会话 gate SSH）
6. **B1/B4**（搜索加 relay 或禁用提示；CodeGraph 加 root 校验）
7. **B5**（图片走 relay 中转，可稍后）

要我先动手修哪几个？1–5 都是小改动，可以一次做完。