# Vibe IDE 使用手册

> 为 AI Agent 与人协作而生的桌面终端 IDE。
>
> 左侧管多个会话（终端 / Claude / Pi / dsh），中间看终端 / 编辑文件 / 和 AI 对话，右侧操作文件树、Git、辅助终端和一堆小工具。三栏一体，不用来回切窗口。

---

## 快速上手

### 初次安装

解压 7z(同一个路径能继承之前的配置) → 运行 `Vibe IDE.exe`（绿色免安装，可能有未知程序提示，点继续执行）。推荐右键管理员运行 `register-context-menu.bat` 注册右键菜单，之后任意文件/目录上点右键 → "Open with Vibe IDE"可快速打开。

---

### 外观配置

app左上角**外观**按钮, 支持设定主题css(支持多选,序号大的覆盖序号小的) 和 右侧底色配合, 自定义主题(例如codex.css + github light底色)。支持自定义css，宠物界面同理。

个人喜好**外观**->**右面面**->**md渲染**, 字体可以改成 霞鹜文楷(需要从github搜索下载字体)。

---

### 高频操作

三栏之间穿梭、关浮窗、回终端，全程不用碰鼠标。

#### 导航组合键（部分）

| 组合键 | 作用 |
|--------|------|
| `Ctrl+↑` / `Ctrl+↓` | 切上 / 下一个会话，并聚焦新agent界面 |
| `Ctrl+←` / `Ctrl+→` | 右侧标签页左 / 右移（切过去自动聚焦） |
| `Alt+←` / `Alt+→` | 编辑器导航后退 / 前进 |
| `Ctrl+E` | 快速打开文件（模糊匹配） |
| `Ctrl+N` | 克隆当前会话 |
| `ESC` | 杀一切浮窗，退回agent界面，自动聚焦到agent界面，流畅输入，不用多余点击鼠标 |

记法：**Ctrl 管栏间切换**（上下切会话、左右切右侧 tab），**Alt 管栏内动作**（文件预览的跳转）。**ESC关闭浮窗**快速回到agent页面下发新的指令。

常用流程： 
- 测试修改：agent页面完成修改-> `Ctrl+→`切到AUX->方向键（↓）选中第一行命令->Enter自动执行验证。
- 观察diff：`Ctrl+←`切到Git->方向键（↓），配合pagedown 预览diff修改。
- 合入worktree：Git BRANCHES，右键worktree分支，合并分支自动3way合入分叉的主分支。


## 1. 会话列表（左侧）

左栏自上而下：**App 信息行** → **快捷按钮**（New Session / Session History / Task Board，可在外观 → 会话栏里隐藏）→ **会话列表**（按目录固定分组）。

### 四种会话类型

新会话时选类型，也可在新建菜单里把常用类型置顶：

| 类型 | 是什么 |
|------|--------|
| **Terminal** | 原生终端（PowerShell / CMD / Git Bash / WSL） |
| **Claude** | Claude Code CLI 的图形化对话（AiTab） |
| **Pi** | `@earendil-works/pi-coding-agent`，另一种 Agent 后端 |
| **dsh** | DeepSeek Harness，内嵌官方 Web UI |

会话默认名按类型编号（`Terminal 1` / `Claude 1` / `Pi 1` / `dsh 1`）。

- **Agent 跑没跑，一眼就知道**：终端连续输出 300ms → 显示 `>>` 跑马灯 + 边框脉冲；停 2 秒没动静 → 变回空闲。切到别的会话干活也不怕错过。
- **状态图标优先级**：定时任务 ⏰ > worktree 🌿 > 运行中 > 待审批/警告 > 空闲。
- **悬停看历史**：鼠标在会话上弹出最近 30 条命令，每条带「复制」和「存为自定义命令」按钮。**AI 会话（Claude / Pi / dsh）悬停显示的是真实用户轮次，点一轮直接跳到对话里的那轮。** 弹窗右上角可以钉住（pin）不自动消失。
- **自定义命令胶囊**：设置里加自己的快捷命令，列表顶部多一排胶囊，点一下执行，右键编辑/删除。命令分三类：`simple`（直接执行）、`init`（新开会话执行）、`pipe`（逐行排队注入当前会话）。
- **定时任务**：会话右键 → 「定时」，填 cron（5 段，支持 `*` / 步长 / 范围 / 列表）+ 命令，到点自动往该会话注入。行首会出现 ⏰ 图标。关掉带定时任务的会话会弹确认。
- **自定义 Emoji 图标**：外观 → 会话栏 → Emoji Text，一行一个。行首点击随机换 emoji，右键出网格菜单选。
- **默认会话图标**：外观 → 会话栏 → Default Session Icon，三档可选：随机 / 类型图标 / 空白（默认空白）。
- **OSC 标题自动同步**：Agent 改终端标题时会话名跟着更新（盲文 spinner 和进程名会被过滤）。**但只要你手动改过一次名，自动改名就再也不打扰你。**
- **拖拽排序**：会话按目录固定分组（worktree 会话归回原仓库那组），组头也可拖拽排序。右键空白可从最近 10 个目录直接开新终端；Clone 出来的新会话紧挨原会话插入。
- **克隆会话** `Ctrl+N` 推荐使用此快捷键快速新建, 按完自动键盘输入聚焦, 不用再按鼠标。


---

## 2. 终端（中间）

- **路径自动识别**：终端输出的文件路径（Windows 绝对 / Unix 绝对 / 相对 / 引号路径）都成可点链接，支持 `:行号` `:行:列`。路径找不到时递归搜工作目录——唯一匹配自动打开，多个匹配弹出选择器。
- **选中就跳**：在终端选中一段文本松开鼠标，若正好是文件路径，自动跳过去，不用精确点链接。
- **切出去也不丢**：切会话或看 Diff 时终端只 CSS 隐藏、不卸载，切回来输出都在、连接没断。
- **Shell 切换**：主终端和 Aux 终端各自可选 Shell（PowerShell 7 / PowerShell 5 / CMD / Git Bash / WSL），只列机器上实际装了的。入口在标题栏机器人 → 会话配置 → Term / Aux Shell Type。
- **Shell 崩了自愈**：Shell 进程意外退出会自动原地重启；连续崩会停下并给出提示，不会无限重启。
- **图片 OCR 识别**：拖入图片或 `Ctrl+V` 粘贴图片，自动 OCR 识别文字并输入终端（默认关闭，在会话配置里开）。
- **拖入文件即插路径**：把文件拖进终端插入其路径（Windows Terminal 风格，bracketed paste）。
- **Kitty 键盘协议**：已启用，Neovim 等 TUI 的按键能正确识别。
- **重复命令不记两遍**、**聚焦才闪光标**、`Ctrl+H` 弹命令历史（全键盘操作）。
- `Alt+F` 搜索终端内容（带命中计数）。
- `Alt+↑` / `Alt+↓` 在 prompt 行之间跳转，浏览长输出快速定位。(仅仅适配了claude code的光标关键词)
- `Shift+Enter` 换行但不发送（多行 prompt）。
- `PageUp` / `PageDown` 有滚动内容就翻页，没有透传给 Shell。
- **背景图**：通过 CSS Snippets 设 `--terminal-bg-image`（`url()` 会被主进程自动转 base64，dev 模式跨域也能用）。

---

## 3. AI 对话（中间）

Claude / Pi / dsh 三种 Agent 后端共用同一套对话界面（下面除特别说明外都指 Claude / Pi）。

### 三种后端的差异

| 后端 | 前置条件 | 特别之处 |
|------|----------|----------|
| **Claude** | 本机已装 Claude Code CLI | 权限三档、支持自定义模型名、context window 设置、断点续聊 |
| **Pi** | 本机已装 `npm i -g @earendil-works/pi-coding-agent` | 模型目录全量可选；权限位换成「思考强度」下拉；`/clear` 是重建进程 |
| **dsh** | 无（随包 vendored） | 中间栏内嵌官方 Web UI；无 Vibe 侧的模型 / 权限设置，凭据归 dsh 自己管 |

- **dsh 插件管理**：在 dsh 自己的齿轮设置里找「安装插件」分区，输入 npm 包名 → Install / Uninstall。装完点 **Restart dsh** 生效。声明了 `dsh.bundle` 的包重启即生效；普通包还需在 `~/.dsh/profiles/web/cordis.patch.yml` 里手动加 insert 行。
- dsh 的 fork 会自动在左栏建出同名的 Vibe 会话；dsh 里点文件也会在 Monaco 打开。
- 三种后端都不需要在这里配 API key——各自 CLI 的凭据自己管。

### 消息与过程展示

- **渲染**：Markdown + shiki 代码高亮 + Mermaid 图（可缩放）+ 流式打字机（块级增量缓存、未闭合代码围栏按原文展示）。正文里的文件路径可点击直接跳转。
- **Thinking 折叠**：思考过程收在 `Thinking for Xs` 里，点击展开；流式时保持展开，回合结束后平滑折叠。
- **回合完成行**：`✻ Churned for Xs · N tools` —— 每回合只留末段正文，thinking / 工具 / 子代理 / 中间正文收进这条收缩行。busy 期间行尾同样式带随机俏皮话。
- **eye 精简模式**：头部眼睛按钮切两档。精简模式下 thinking 不渲染，工具与每回合非末段正文**驻留 2 秒后平滑收起卸载**，只留答案；复制为 Markdown 时也不含 thinking。
- **工具卡**：单工具卡点击展开，文件编辑类工具展开显示内嵌 Monaco Diff；连续纯工具消息合并为 `· N steps` 摘要；子代理（Agent / Task）归组为可折叠 `Agent (N tools)`。
- **任务清单**：TodoWrite / TaskCreate 派生的清单钉在输入框上方（`Tasks (done/total)`）。
- **运行中工具 chip**：busy 时输入区上方显示当前工具名 + 耗时。

### 权限与提问

- **权限模式**三档：`Plan 📋` / `Edit 🖌️` / `Bypass 🔓`，随时下拉切换，**不重启子进程**（走 CLI 的 control_request 协议）。
- **权限卡**：工具名 + 命令 + Approve / Deny，浮动在输入框上方。
- **问答卡**：Agent 用 AskUserQuestion 提问时，渲染成多题 / 多选 / 自定义答案卡片。为防 CLI 自动填空，收到问题即挂起子进程，你答完再 `--resume` 同会话续上。

### 模型与上下文

- **模型**：Claude 侧用 `ModelBadge` 下拉（Opus / Sonnet / Haiku / Default），支持最多 3 个自定义模型名。切换走 control_request，会话已有对话时插入一条 `/model <alias>` 记录。
- **Pi 侧**：`PiModelBadge` 拉全量 provider / model 目录，可筛选；权限模式位替换为「思考强度」下拉（off → max）。
- **上下文环**：输入区右侧圆环，按占用率变色（≥80% 红 / ≥50% 黄 / 绿）。点击可看具体用量，铅笔可改上限（接受 `500k` / `1m` 写法）。

### 会话与导航

- **历史**：头部时钟按钮拉当前项目的历史会话，选中即 `--resume` 重建进程。
- **完整历史浏览器**：左栏 Session History 按钮（或右栏 NGA → 📜）。支持跨项目、按目录分组、全文内容搜索。
- **New session**：销毁并以同参数重建会话进程。
- **回合导航**：会话列表 hover 弹窗里点某一轮直接滚过去。
- **跳到底部**：未贴底且鼠标靠近下缘时浮现「跳到底部」横条；流式跟随会在你上滑 >40px 时停止拉回。
- **停止**：两段式——第一次软中断，5 秒内仍 busy 则按钮变红升级为强制终止。

### 输入

- **`@` 引用文件**：输入 `@` 弹文件名下拉（250ms 防抖），选中插入 `@相对路径`。拖文件进输入框、粘贴带路径的文件、粘贴纯图片（截图）都会转成 `@path`。
- **斜杠 / 加号菜单**：输入 `/` 或点 ＋ 打开命令菜单（内置 + skill + 自定义命令）。
- **`/btw 问题`**：旁路提问，**不打断当前回合**，答案以气泡回投。
- **busy 时按 Enter = 排队插话**：不发送，而是存入待发队列，输入框上方出现 "Queued" 条（可编辑 / 移除 / 立即插话）。回合回到空闲自动投递。
- **粘贴 / 右键**：输入框右键优先识别剪贴板图片落盘插入 @path，否则粘贴文本。
- **内容列宽**：输入区两侧拖拽把手可调 560–1400px。

### 会话操作

- **右键菜单**：Copy as Markdown（按当前模式决定是否含 thinking / 工具）、Branch Graph（开关网状视图）。
- **回退**：用户气泡 hover → 回退按钮，两项可选：`Revert conversation & code`（对话 + 代码一起退）/ `Revert conversation only`。
- **Fork**：回合 meta hover → 复制本轮回复 / `Fork to new session`。
- **网状对话（Branch Graph）**：头部网络图标打开。dagre 树布局，节点 = 一次用户轮（标题、回复预览、相对时间、工具数）。选中节点后底部输入框三种动作：**send**（当前分支 tip 直接发）/ **continue**（续聊另一分支）/ **Fork & Send**（从该轮复制前缀分叉再发）。双击节点：当前路径 → 退出图并跳到该轮；其它分支 → 打开那条分支。节点右下**四叶草按钮 = 从该轮分叉并放进独立 worktree**（内容含未提交改动）。右栏够宽时图停靠右栏。

### 高级开关（空会话欢迎屏）

- **Enable Computer Use**：让 Agent 截屏 + 鼠标键盘操作本机（多显示器 / DPI 已换算，坐标为截图归一化）。
- **Enable Browser Use**：让 Agent 操作内嵌浏览器（snapshot / click / fill / eval 等）。**需先点标题栏地球按钮打开 Web Debug**。
- **Enable Worktree**：让会话在独立 git worktree 里干活，不污染当前工作区。

切换这些开关会重建会话进程。开启后头部出现对应徽标。

---

## 4. 编辑器与文件区（中间）

### 编辑器

- **Monaco**，diff 与编辑同栈。
- **diff 模式**：staged = HEAD vs 索引、unstaged = 索引 vs 工作区、历史提交 = 父 vs 提交（只读）、文件对比 = 指定文件 vs 当前文件。
- **内联 / 并排**：默认内联（inline），可在外观 → 中间栏切换；并排的分栏比例可拖（0.1–0.9）。`Ctrl+PageUp/Down` 或连按两次 `PageUp/PageDown` 跳上 / 下一处改动。
- **单行撤销条**：diff 行 hover 出现「↩」浮钮，点一下把该行回退成左侧内容并立即写盘。
- **导航历史**：`Alt+←` / `Alt+→` VS Code 式前进后退。只记 Monaco 真能打开的位置（markdown / 图片预览不压栈）。
- **加入对话（羽毛笔）**：按住 `Ctrl` 修饰键时——多行选区点击 = 以行区间加入对话批注；单击 = 整行批注；标题栏点击 = 整个文件批注。文件树里的文件 `Ctrl+单击` 同理。
- **LSP 跳转**：`Ctrl+单击` / `F12` 跳定义，`Shift+F12` 查找引用，`Ctrl`+hover 下划线预提示。见 §6。
- **行号越界自动保护**：从终端点 `file.ts:99999` 跳到行数不够的文件，自动跳到最后一行，不报错。
- **编码**：打开自动检测 BOM 与编码（jschardet），标题栏显示结果；标题栏右键 → Reopen With Encoding / Save With Encoding，覆盖 Unicode / 中文 / 日文 / 韩文 / 西文 30+ 种。
- **过大 / 二进制文件**：显示占位 + **Force Open** 强开钮。
- **行历史**：右键 → View Line History（`git log -L`），右栏 Git 面板底部列出触及该行的所有提交。
- **大纲**：标题栏小按钮 hover / 点击出大纲浮层。markdown 按 `#` 标题，代码按语言正则解析 function / class / interface 等，可筛选类型。
- **快捷键**：`Ctrl+S` 保存、`Ctrl+L` 预览 ⇄ 编辑（markdown）。

### 文件 Tab 系统

- 三种 tab：diff / markdown 预览 / 图片预览，按扩展名自动选。
- **多 tab 保活**：非激活 tab 只 CSS 隐藏不卸载，切回状态都在。最多 7 个，超出按最近使用驱逐，**未保存的脏 tab 不驱逐**。
- tab 条：左返回钮（Esc 收起）、图标 + 名字 + diff 模式徽标 + 未保存黄点 + ✕；激活 tab 右侧显示 +additions/-deletions。
- 右侧显示最近打开（内联 3 个 chip + 溢出菜单）。

---

## 5. 右侧面板

四个 tab：**Dir**（文件树）/ **Git** / **Aux**（辅助终端）/ **NGA**（工具与游戏）。

- tab 可**拖拽重排**，tab 栏右键可**逐项勾选显隐**（至少留一个），可切 **Capsule Tabs** 胶囊样式。
- **宽面板自动收起 tab 栏**：面板宽度 ≥700px 时 tab 栏变成右缘竖排悬浮图标栏，hover 才展开；首个按钮右上有 ✕ 可整体收起，底部有「Restore Default Width」还原。
- 快捷键：`Ctrl+←` / `Ctrl+→` 循环切 tab，`Ctrl+1`–`Ctrl+5` 跳到第 N 个可见 tab。

### Dir —— 文件树

- 懒加载单层展开、展开状态按 workspace 缓存，文件变动 300ms 去重自动刷新。
- 忽略规则默认 `.git,.vscode,node_modules,dist,build,.next,out,__pycache__,target,.cache`，可配置。
- 标题栏：仓库名 + **搜索文件名**（250ms 防抖，可只匹配文件名不含路径）+ 全部折叠 + 刷新。
- **文件夹内搜索**：文件夹行 hover 的 🔍 → 树内就地搜索条（正则 / 大小写开关），结果按目录嵌套成结果树，点行跳编辑器定位。
- **右键菜单**——目录：New File / New Folder / Paste / Cut / Copy / Rename / Delete / Refresh / arch 区显隐。文件：Open in Explorer / Copy Path / **Compare with Current**（与当前编辑文件对比）/ Paste / Cut / Copy / Rename / Delete。
- 新建 / 重命名为树内内联输入框（重命名默认选中主文件名，Enter 提交 Esc 取消）。
- html 行 hover 有「Open in Browser」圆钮。
- **arch 区**：读仓库根 `CLAUDE.md` 或 `AGENTS.md`，把其中的 ASCII 目录树（`├── └──`）解析成可点击树，注释作说明。可折叠 / 隐藏。
- 文件图标按扩展名映射（30+ 品牌图标），文件夹按名字上色。

### Git

自上而下：Staged / Changes / Untracked / Commits（graph）/ Branches / Commit 区。

- **大仓库自动折叠**：某区文件数超过 500 首次自动收起；status 上限 5000 文件，超出显示 `显示数 / 总数`。
- **树 / 平铺视图**切换（树视图压缩单链目录）。
- 单文件行内按钮：Stage / Unstage / Discard / Delete，均有确认弹窗。
- **键盘导航**：`↑`/`↓` 遍历区头 + 文件行（文件行自动开 diff），`Enter` 在区头执行批量 stage / unstage。
- **Commit**：信息框 `Ctrl+Enter` 提交。**Amend** 四场景自动判断——有暂存 + 有新信息 = 改写信息并入；仅有暂存 = `--no-edit` 并入；仅有信息 = 只改信息；都无 = 禁用。
- **Stash**：Stash 全部 / Pop（带计数）/ hover ✕ Drop。
- **Push**：无暂存且有 ahead 时主按钮变 Push(数量)；下拉可推任意远端分支、**Force Push（需确认）**、**Push and create PR**、**Hosting settings…**。
- **分支**：本地 / 远端切换显示；带 worktree 的分支点一下整个面板切到该 worktree 目录，原分支行出现回程入口。右键 → **Merge Changes**（worktree 改动合回）与 **Delete Branch**。
- **子模块**：仓库含子模块时分支名变下拉，可进入任一子模块（面板整体切换）并返回 Main Repository。
- **Git Graph**：Commits 区 SVG 泳道图（HEAD 双圈、merge 双圈、彩色 lane、branch/remote/tag 徽章），每页 50 条 Load more。点提交展开文件列表，点文件看 diff；右键提交 = Copy Message / Copy Hash。
- **行历史**：编辑器右键 View Line History 后，底部出现 `Line History (文件:行)` 区，含 Uncommitted changes 条目。
- **冲突标记自动扫**：diff 里自动找 `<<<<<<<`；conflicted 文件在暂存区时禁用 Commit 并给警示条。
- **PR**：Push 下拉 → Push and create PR 打开创建弹窗——源分支只读、目标分支下拉、自动带最近 commit 作标题、拉取 PR 模板填 body、显示该分支已有 PR、连接鉴权检查 + 冲突预检。Hosting settings 里管理 GitHub / GHES / GitLab / CodeHub 平台（host、API Token、自签证书），Token 用系统安全存储加密。
- 无 git 仓库时显示占位 + **git init** 按钮。错误提示 5 秒自动消失。

### Aux —— 辅助终端

- **CLAUDE.md 命令**：解析仓库根 `CLAUDE.md` / `AGENTS.md` 的 `## Commands` 小节，列出可点即执行的命令。推荐先让 Agent 跑一次 `/init`。
- **分屏**：Aux 支持 1–3 个分屏终端，分隔条可拖拽。

### NGA —— 工具与游戏

一个启动器面板，进去后点返回。实际内容：

| 项 | 用途 |
|----|------|
| 📜 Session History | 完整历史浏览器：跨 `claude tui / claude gui / dsh / pi` 四种数据源，按项目目录分组，全文搜索 + `<mark>` 高亮，可 Resume / 删除 |
| ✨ Skills | 技能管理器：扫项目与全局的 `.claude` / `.agents` / `.dsh/skills`，解析 SKILL.md，可新建 / 编辑 / 删除 |
| 🌐 Web Debug | 内嵌浏览器（见下） |
| 📿 Beads | 照片转拼豆像素画 |
| 🃏 Balatro | 扑克 roguelike |
| 🏖️ Sandspiel | 落沙粒子物理 |
| 🧩 2048 | 数字合并 |
| 🧛 Survivors | 自动攻击生存，6 分钟一局 |

另外**会话看板（Task Board）**在左栏按钮打开：卡片 = 会话（状态、cwd、分支），可新建记录（标题 + 启动命令）、点卡片看最近输出并直接回复、拖文本到卡片即发送、Finish / Merge / Abort merge 把 worktree 改动合回主分支。

### Web Debug（内嵌浏览器）

- 地址栏支持 URL / 本地路径 / `.html` 自动转 `file://`；后退 / 前进 / 刷新 / 缩放 0.5–2x；可在中栏和右栏之间停靠切换。
- **Web Brush 批注**：开启后 hover 高亮元素，点击取 CSS selector + 文本，提交后把 `selector → 批注文本` 追加进当前 AI 输入框。
- 配合 §3 的 "Enable Browser Use"，AI 就能自己操作这个浏览器。

### 搜索（标题栏浮窗）

`Ctrl+F` 或标题栏搜索图标打开，**不是右侧 tab**。

- **可拖动**（六点把手）**可固定**（图钉）——固定后点外部不关闭、可继续操作 IDE。
- **文本模式**：正则、大小写、全词、按后缀排序、glob 包含过滤。后端优先 ripgrep（自动跳过 node_modules 等 10 个目录，15 秒超时），没装 rg 回退纯 Node 扫描；结果上限 200 条，超出显示截断标记。
- **替换**：替换框 Enter 或 Replace All → **确认弹窗**显示「改多少文件、多少处」；每个文件行可 ✕ 单独排除。
- **智能模式**（需该 workspace 的 CodeGraph 已初始化）：用自然语言描述，按 Enter 返回相关符号（带高 / 低置信度提示），右键可展开进调用图。

---

## 6. 代码智能

### Code Graph 代码图谱

代码符号索引工具，快速搜索项目中的函数 / 类 / 接口 / 组件等。`Alt+K` 打开，250ms 防抖自动搜，选中 Enter 跳转；顶部 Fn/Me/Cl/If/Co/Va/Ct/Ty 按钮筛选符号类型。

- **首次需初始化**：点搜索框右侧 "Init" 建索引（大项目可能几分钟），之后文件变动 3 秒防抖自动增量同步。
- **搜索框回车（未选中条目）= Explore**：让图谱按语义给出一份相关代码的说明，比逐个符号找更快。
- **排除文件夹**：漏斗图标排除不想索引的目录，自动写入 `.gitignore`（带 `# vibe-ide-codegraph` 标记）。
- **MCP 配置**：齿轮图标配置 MCP，可一键装给 Claude Code / Cursor / Codex CLI / opencode / Gemini CLI 等。
- **内存占用**：不开图不加载。不需要可在设置里整个关掉。

### LSP 语言服务

支持的服务器（**默认全部开启**）：

| 语言 | 服务器 |
|------|--------|
| Python | Pyright（内置） |
| C / C++ | clangd（从 PATH / LLVM / VS 安装位置找） |
| TypeScript / JavaScript | tsserver（内置） |

- **懒启动**：不跳转就不加载进程；空闲 15 分钟自动回收。
- **能力**：跳转定义（`Ctrl+单击` / `F12` / 右键）、查找引用（`Shift+F12`）、调用层级（右键 Call Hierarchy）。**没有重命名和诊断**——那部分仍走编辑器内置。
- **多定义策略**：对齐 VS Code 的 `multipleDefinitions`——「列出来让我选」（默认 peek）或「直接跳第一个」。
- **缺编译数据库**：clangd 找不到 `compile_commands.json` / `compile_flags.txt` 时给出提示 + 一键生成 `compile_flags.txt`，生成后自动重启 clangd 并重试跳转。
- 每个语言可在外观 → 高级里单独开关，面板显示运行状态（PID）与 Stop 按钮。
- **调用关系图**：编辑器右键 → Open Call Graph by CodeGraph 或 Call Hierarchy，浮层可拖拽 / 缩放 / 展开层级 / 删除分支，节点点击跳转到对应位置。CodeGraph 来源标 "by CodeGraph"，LSP 来源标 "by LSP · <服务器>"。

---

## 7. 桌宠 & 速发键

- **加宠物**：把 webp / png 精灵图丢进 `pets/`（扁平放或 `pets/<名字>/spritesheet.webp` + 可选 `pet.json` 指定网格和帧率）。外观 → 宠物 → Open Pet Folder。推荐素材站 https://petdex.dev/ 。
- **状态映射**：逻辑状态 `approval > busy > unfocused > idle`，加上双击 / 发送消息两个瞬时态；每个状态映射到精灵图某一行。待审批会话 → 宠物进入 review 动作。
- **拖动**：按住拖走（位置持久化），左右拖会切跑动动作。
- **单击 = 速发键**：弹出 6 个快捷按钮（默认：给多个方案 / 清理死代码 / 检视无误并提交 / 用户视角解释 / 继续 / 还是报错），点击即发送或仅填入输入框，可在气泡菜单齿轮里改文案与行为。
- **右键 = 命令输入框**：Enter 发送；配了「右键命令前缀」（如 `/btw`）会预填，用于不打断主任务的旁路提问。
- **AI 气泡**：可开「监听 Claude」/「监听 DSH」，回复内容弹成气泡（默认关）。
- 设置：缩放 25%–150%、帧率 25%–300%、每个逻辑状态单独指定帧数、Reset Position。

---

### Appearance 外观面板

左侧 6 个分类，顶栏有"影响区域"切换（全局 / 会话 / 编辑器 / 面板 / 终端），底部 Reset Defaults。

| 分类 | 内容 |
|------|------|
| **Theme** | 15 套主题缩略图（点击即换）；左侧 CSS Snippets 列表（勾选启用 / Open CSS Config / Reload CSS） |
| **Sidebar** | 显示 App 信息栏 / 默认按钮 / 状态栏；会话字体；Emoji Text；默认会话图标 |
| **Middle** | Force Inline Diff；自动换行；分栏比例；编辑器字号；终端字号与终端字体 |
| **Right Panel** | Capsule Tabs；界面字体；MD 预览字体与字号 |
| **Pet** | 见 §7 |
| **Advanced** | CodeGraph 开关；Language Server（见 §6，多定义策略 + 逐语言开关 + 运行状态） |

---

## 11. 自定义 CSS Snippets

不想等版本更新，自己改外观——往目录里丢 `.css` 文件、面板里勾一下就生效。建议让 AI 先学一下已有 snippets 再改，CSS 末尾写强制覆盖。

### 目录在哪

| 模式 | 路径 |
|------|------|
| 打包后（exe 运行） | `Vibe IDE.exe` 同目录的 `snippets/` |
| 开发模式（`npm run dev`） | 项目根目录的 `snippets/` |

目录不存在会自动创建。里面再放 `snippets.json`（启用状态与加载顺序，**自动生成不用手写**）和你的 `*.css`。

### 怎么开关

点标题栏调色板 → **Theme** 分类，左列就是所有 `.css` 文件。

1. 勾选 / 取消切换启用，**即时生效**。
2. **Reload CSS** 按钮重新扫描目录（新增文件不用重启）。
3. **Open CSS Config** 直接在 IDE 里打开 snippets 目录。
4. **加载顺序**：后勾选的排后面，**序号大的覆盖序号小的**。想强制压过某个片段，把它取消再重新勾选一次即可调到末位。
5. 文件**第 2 行**写注释，会作为 tooltip 显示在列表里。

> 终端背景图切换后需要新开一个终端才生效。背景图 CSS 里的 `url(...)` 会被主进程自动转成 base64 内联，所以 dev 模式跨域也能用。

### 写法三条铁律

1. **覆盖主题色变量必须加 `!important`** — ThemeProvider 用 `setProperty` 写内联样式（优先级 1000），普通 `:root` 规则压不住。
2. **颜色值写 `R G B` 空格分隔**（如 `22 22 18`），**不要**写 `#hex` 或 `rgb()`——否则 Tailwind 透明度修饰符 `/50` 会失效。
3. **BEM 语义类名无需 `!important`** — `.session-item--active`、`.git-tab__section-header` 这类直接选具体元素的规则正常写就行。类名清单见 `doc/ui-bem-classes.md`。

### 可用主题变量

| 变量 | 含义 |
|------|------|
| `--ide-bg` | 主背景 |
| `--ide-sidebar` | 左侧栏 |
| `--ide-panel` | 面板 / 卡片 |
| `--ide-border` | 边框 |
| `--ide-text` / `--ide-text-muted` | 主 / 次文字 |
| `--ide-accent` / `--ide-accent-hover` | 强调色 / 悬停 |
| `--ide-success` / `--ide-danger` / `--ide-warning` | 成功 / 危险 / 警告 |
| `--ide-hover` / `--ide-active` | 悬停 / 选中背景 |
| `--scrollbar-thumb` / `--scrollbar-thumb-hover` | 滚动条 |
| `--selection-bg` / `--selection-opacity` | 选区 |
| `--focus-outline` | 聚焦轮廓 |
| `--monaco-margin-bg` | 编辑器行号区背景 |
| `--terminal-bg-image` | 终端背景图（`url()` 自动转 base64） |

### 示例

**示例 1：把强调色改成橙色**

```css
/* snippets/orange-accent.css */
:root {
  --ide-accent: 255 179 0 !important;
  --ide-accent-hover: 255 199 51 !important;
}
```

**示例 2：给当前 Session 项加左侧高亮条**（BEM 类名，无需 `!important`）

```css
/* snippets/active-bar.css */
.session-item--active {
  border-left: 3px solid rgb(var(--ide-accent));
  padding-left: 7px; /* 抵消边框宽度，避免内容跳动 */
}
```

**示例 3：换终端背景图**

```css
/* snippets/terminal-bg.css */
.xterm-screen {
  background-image: url('./bg.jpg');
  background-size: cover;
}
```

**示例 4：调大 Git 面板 + 文件树字体**

```css
/* snippets/git-file-fontsize.css */

/* Git 面板：文件项 / 分区头挂了 text-xs，分支名挂了 text-sm，都要 !important 才压得过 */
.git-tab__file-item,
.git-tab__section-header,
.git-tab__branch-name {
  font-size: 13px !important;
}

/* 文件树：项本身没挂字号类，直接设即可（不生效再加 !important） */
.file-tree-item,
.file-tree-item__name {
  font-size: 13px;
}
```

> 默认是 `text-xs`（12px），这里调到 13px。想再大改 `14px` / `15px`，想调小改 `11px`。

---

## 12. 快捷键全表

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 搜索（markdown 预览页为页内搜索） |
| `Ctrl+E` | 快速打开文件 |
| `Ctrl+N` | 克隆当前会话 |
| `Ctrl+↑` / `Ctrl+↓` | 上 / 下一个会话 |
| `Ctrl+←` / `Ctrl+→` | 右侧标签页左 / 右移 |
| `Ctrl+1`–`Ctrl+5` | 跳到第 N 个右侧标签页 |
| `Ctrl+H` | 弹出命令历史 |
| `Ctrl+=` / `Ctrl+-` | 字体放大 / 缩小（终端 / 编辑器各自独立） |
| `Ctrl+L` | 切换预览 / 编辑模式（markdown） |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Enter` | 提交 Git commit / markdown 块编辑保存 |
| `Shift+Enter` | 终端换行但不发送（多行 prompt） |
| `Alt+↑` / `Alt+↓` | 跳上一条 / 下一条命令（prompt 行间跳转） |
| `Alt+K` | 打开 Code Graph 代码图谱搜索 |
| `Alt+F` | 终端内搜索 |
| `Alt+←` / `Alt+→` | 编辑器导航后退 / 前进 |
| `Ctrl+单击` | 加入对话批注（文件 / markdown）；编辑器内为跳转定义 |
| `F12` / `Shift+F12` | 跳转定义 / 查找引用 |
| `PageUp` / `PageDown` | 有内容就翻页，没有透传给 Shell |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Diff 中跳上 / 下一个区块 |
| `Escape` | 关浮窗 / 退回终端（分层命中，详见 §8） |

除 `Escape` 和 `Ctrl+S` / `Ctrl+Enter` 外，所有快捷键都能在快捷键面板里改。

---

## 13. 构建与分发

```bash
npm ci                # 安装依赖
npm run dev           # 热重载开发
npm run build         # 编译
npm run build:win:7z  # 打包 win 绿色版 7z（走 npmmirror 镜像）
npm test              # 测试
npm run test:perf     # 性能测试：build + 启动 + 快速切换文件 + 采集 CPU/内存
```

解压即用，不用安装。注册右键菜单（`register-context-menu.bat`）后可直接右键任意文件 / 目录打开。
