# Vibe IDE 使用手册

> 为 AI Agent 与人协作而生的桌面终端 IDE。
>
> 左侧管理多个 AI 会话，中间看终端输出 / 编辑文件，右侧操作 Git、辅助命令、文件树和搜索。三栏一体，不用来回切窗口。

---

## 快速上手

解压 zip → 运行 `Vibe IDE.exe`（绿色免安装）。

推荐双击 `register-context-menu.bat` 注册右键菜单，之后任意文件夹或文件上点右键 → "Open with Vibe IDE"，一步到位。

---

## 1. Session 列表（左侧）

### 常用操作

| 操作 | 方式 |
|------|------|
| 新建终端 | 右键左侧面板空白区域 → New Terminal，或点列表底部的 `+` |
| 切换 Session | 点击条目就行；`Ctrl+↑` / `Ctrl+↓` 也能切 |
| 克隆 Session | 右键 → Clone，新会话会紧挨着插在原会话下方 |
| 重命名 | 双击名字，或右键 → Rename。**一旦手动改过名，自动改名就不会再覆盖你了** |
| 关闭 | 右键 → Close，PTY、历史记录、Agent 状态都会一并清理 |
| 拖拽排序 | 直接拖 |

### 这些细节你可能用得上

- **悬停看历史**：鼠标在 Session 上停 600ms，会弹出最近 30 条命令，每条旁边都有复制按钮。不用切过去就能瞄一眼刚才干了什么。
- **自定义 Emoji 图标**：设置 → Emoji Text，一行一个 Emoji，会话图标按 ID hash 自动分配。23 个默认的够用了，你也可以换成自己顺眼的。
- **Agent 跑没跑，一眼就知道**：终端连续输出 300ms → 显示 `>>` 跑马灯 + 边框脉冲。停 2 秒没动静 → 变回空闲。切到别的 Session 干活也不用担心错过。
- **YOLO 模式（自动批准）**：Session 悬停时盾牌图标，点一下开启。开启后 Claude Code 的权限询问会被自动允许，不用守着点确认。
- **自定义命令胶囊**：设置里可以加自己的快捷命令（名字 + 命令内容），加完后 Session 列表顶部会多一排小胶囊，点一下就执行。右键胶囊可以编辑或删除。

### 右键都在这儿了

**右键 Session 列表项：**
- Clone — 克隆一个一模一样的新终端
- Rename — 改名
- Auto Approve — 开/关 YOLO 模式
- Close — 关闭

**右键空白区域：**
- New Terminal — 选个目录开新终端
- Recent Directories — 最近打开过的 10 个目录，一键直达

---

## 2. 终端（中间）

### 快捷键

| 按键 | 效果 |
|------|------|
| 右键（有选中文本） | 复制 |
| 右键（无选中文本） | 粘贴 |
| `Ctrl+C`（有选中文本） | 复制；没选中就正常发 SIGINT |
| `Shift+Enter` | 换行但不发送（写多行用的） |
| `Ctrl+=` / `Ctrl+-` | 放大/缩小字体（终端和编辑器各自记各自的） |
| `PageUp` / `PageDown` | 有滚动条时翻页，没有就透传给 Shell |
| `Alt+↑` / `Alt+↓` | 跳到上一条/下一条命令（在 prompt 行间跳转） |
| `Escape` | 关 Diff 视图 / 关历史浮窗 |

**关于字体缩放**：`Ctrl+=` / `Ctrl+-` 是在主进程拦下来的，不会触发 Chromium 的页面缩放。终端字体大小和编辑器字体大小各管各的。

### 这些你可能还不知道

- **路径自动识别**：终端里输出的文件路径（Windows 绝对路径、Unix 绝对路径、相对路径、引号路径）都会被自动识别成可点击的链接。支持 `:行号` 和 `:行:列`，点一下直接跳过去。如果路径找不到文件，它会递归搜工作目录——搜到唯一匹配就自动打开，多个匹配就安静地忽略，不会弹报错。
- **选中就跳**：在终端里选中一段文本松开鼠标，如果正好是个文件路径，自动就跳过去了。不用精确点链接。
- **OSC 标题自动同步**：Agent 改终端标题时，会话名会自动跟着更新（盲文 spinner 字符和进程名会被过滤掉）。**但只要你手动改过一次名字，自动改名就再也不打扰你了。**
- **切出去也不丢**：切换 Session 或看 Diff 的时候终端不会被卸载（只是 CSS 隐藏了），切回来的时候输出都在、连接也没断。
- **聚焦才闪**：终端获得焦点时光标闪烁，失去焦点就停——省电也省心。
- **重复命令不记两遍**：连着输入同样的命令，历史里只记一次。
- **`Ctrl+H` 看历史**：弹窗全键盘操作，上下选择，Enter 发送，Escape 关闭。
- **Alt+↑/↓ 命令跳转**：在终端里按 `Alt+↑` 跳到上一条命令的 prompt 行，`Alt+↓` 跳到下一条。浏览长输出时快速定位用的。
- **图片 OCR 识别**（v0.6.1+）：拖入图片或 `Ctrl+V` 粘贴图片，自动 OCR 识别文字并输入到终端。支持截图直接粘贴识别。

---

## 3. Git 面板（右侧 Tab 1）

### 基本操作

- 文件分 untracked / unstaged / staged 三区展示
- 点文件查看 diff
- Staged 区的文件可以提交（`Ctrl+Enter` 快捷提交）
- 分支切换、stash 管理

### 这些细节你可能用得上

- **大仓库自动折叠**：文件数超过 500 时对应区域自动折叠起来——打开 `node_modules` 炸了的仓库时 UI 不会卡死。之后你可以手动展开。
- **2 秒冷静期**：文件变更通知会合并，保存文件不会触发十几次刷新。如果一直有变动，它会调度一次延迟通知，保证最后一次变更不丢。
- **不会串数据**：异步加载完会检查路径还是不是当前 Session 的——A 会话不会显示出 B 会话的数据。
- **冲突标记自动扫**：diff 里自动找 `<<<<<<<`，帮你定位合并冲突。
- **错误提示 5 秒消失**：Git 操作的错误提示不用手动关，5 秒后自动消失。
- **手动刷新按钮**：右上角刷新按钮随时刷新 Git 状态。
- **轮询模式**（设置 → Other Options → Polling Refresh）：每 6 秒自动刷一次，适合网络驱动器这类文件监听不靠谱的场景。
- **右键删分支**：分支列表里右键可以直接删分支（相当于 `git branch -D`）。
- **Worktree 支持**：`worktree-` 前缀的分支点一下，整个右侧面板自动切换到 worktree 目录。右键 → Merge Changes 可以把 worktree 的改动合并到当前分支。点带 ← 箭头的条目就回到主分支。

---

## 4. 辅助终端 Aux（右侧 Tab 2）

- CLAUDE.md （## Commands）里的命令会自动解析成可点击列表，点击或者键盘操作可以直接aux发送命令。
- 辅助终端和主终端共享工作目录
- 切到 worktree 时自动重建

---

## 5. 文件树（右侧 Tab 3）

| 操作 | 方式 |
|------|------|
| 展开/折叠 | 点文件夹 |
| 打开文件 | 点文件 |
| 新建文件/文件夹 | 右键目录 → New File / New Folder |
| 重命名 | 右键 → Rename |
| 删除 | 右键 → Delete |
| 复制/剪切/粘贴 | 右键文件 → Copy / Cut，再右键目标目录 → Paste |
| 在资源管理器打开 | 右键 → Show in Explorer |
| 文件对比 | 右键文件 → Compare with Current（放入左侧对比） |

### 这些你可能还不知道

- **过滤规则**：设置里可以配置想跳过的目录（默认 `.git`、`node_modules`、`dist` 这些）。
- **展开深度可调**：设置里 1-8 级随便调。
- **文件图标自动匹配**：95+ 种文件类型都有对应的图标。
- **二进制文件先问再开**：PNG 这类文件打开前会先弹确认，不会直接塞给你一堆乱码。
- **文件对比**（v0.6.2+）：右键文件 → "Compare with Current"，该文件会放到 Diff 编辑器的左侧，右侧显示当前打开的文件。方便对比两个文件的差异。

---

## 6. 搜索（右侧 Tab 4）

| 操作 | 方式 |
|------|------|
| 搜索 | 输入关键词，300ms 防抖自动搜 |
| 正则搜索 | 勾上 Regex |
| 大小写敏感 | 勾上 Case Sensitive |
| 文件过滤 | Include 框里写 glob 模式 |
| 打开结果 | 点搜索结果行跳转 |

### 这些你可能用得上

- **`Ctrl+F` 一键搜索**：自动聚焦输入框，即使 Search Tab 被隐藏了也会自动显示出来。
- **查找替换**（v0.4.2+）：搜索框下面会出现替换输入框，输入替换文本 → Replace All → 确认弹窗。点确认前能看到要改多少个文件、多少处匹配。右侧x掉，则不会替换x掉的文件。
- **Ripgrep 优先**：系统装了 `rg` 就用 ripgrep（JSON 解析，15 秒超时），没装就 Node.js 兜底。
- **匹配高亮**：搜到的关键字会高亮显示。
- **文件可折叠**：每个文件的结果可以折叠起来，结果多了不眼花。

---

## 7. 编辑器 / Diff 查看器（中间）

| 操作 | 方式 |
|------|------|
| diff/edit 切换 | 上面的 View Diff / Edit File 按钮 |
| 保存 | `Ctrl+S`（diff 视图下也能存） |
| 跳 diff 区块 | `Ctrl+PageDown` / `Ctrl+PageUp`，或者双击 `PageDown` / `PageUp` |
| 字体缩放 | `Ctrl+=` / `Ctrl+-`（编辑器独立记忆） |
| 返回 | Escape——从编辑/diff 状态回到终端 |

### 这些你可能还不知道

- **编码自动检测**：打开文件时自动检测 BOM 和编码（用 jschardet），结果会显示在标题栏上。右键标题栏可以换编码重新打开或保存——GBK、Shift-JIS、EUC-KR、Big5 等 30+ 种编码都支持。
- **不会误报"已修改"**：Monaco 初始化时触发的 onChange 不会被当成你改的，只有你真的编辑了内容才会显示 `● 未保存`。
- **95 种语言语法高亮**：除了常见的 TS/JS/Python/Rust/Go，还覆盖了 `.mjs/.cjs/.mts/.cts`、GraphQL、Dart、Lua、R、Scala、Clojure、F#、Julia、Elixir、Perl、CoffeeScript、Solidity、Protobuf、Handlebars/Pug/Twig/Razor/MDX、SystemVerilog 等等。几乎不会遇到没有语法高亮的文件。
- **行号越界自动保护**：从终端点 `file.ts:99999` 跳转到行数不够的文件时，会自动跳到最后一行业不会报错。
- **翻页联动**：Git 面板里看 diff 时，PageUp/PageDown 能滚编辑器内容。
- **Word Wrap**：设置里可以开关自动换行。
- **Show squiggles**：设置里可以关掉 TS/JS 的语法诊断波浪线——大文件时能省 CPU。
- **Force Inline Diff**：设置里可以强制用内联 diff 而不是并排对比。
- **文件对比模式**（v0.6.2+）：在文件树右键选择 "Compare with Current" 后，左侧显示对比文件，右侧显示当前文件，方便比较两个文件的差异。

---

## 8. 右侧面板设置

### 标签页

四个标签页（Git / Aux / File / Search）：
- **拖拽重排**：按住标签拖一下就能调顺序。
- **隐藏不用的**：右键标签 → Hide Tab（至少留一个）。`Ctrl+F` 搜东西时即使 Search 被隐藏了也会自动显示出来。
- **`Ctrl+←/→` 切换**：切过去会自动聚焦——Search 聚焦输入框，其他的聚焦容器。

### 胶囊标签

设置 → Other Options → Capsule Tabs：可以换成胶囊样式的标签栏。

---

## 9. 设置菜单

点左侧面板标题栏的齿轮图标 ⚙️

| 设置项 | 说明 |
|--------|------|
| **中 / EN** | 界面语言，即时切换 |
| **Theme** | 14 套主题，hover 就能预览 |
| **Emoji Text** | 自定义会话图标，一行一个 |
| **Shell Type** | 新建终端默认 Shell（只显示你机器上装了的） |
| **Keyboard Shortcuts** | 快捷键设置面板，可以录制/重置 |
| **File Tree Depth** | 文件树展开深度 1-8 级 |
| **File Filter Rules** | 文件树和 Git 要跳过的目录 |
| **Word Wrap** | 编辑器/Diff 自动换行 |
| **Auto UTF-8** | 新建终端自动 `chcp 65001`（防中文乱码） |
| **Show squiggles** | TS/JS 诊断波浪线开关 |
| **CodeGraph** | 代码图谱索引开关（开启后支持代码符号搜索） |
| **OCR Image to Text** | 图片 OCR 识别开关（拖入图片或 Ctrl+V 识别文字） |
| **Other Options…** | 更多选项 |

### Other Options 子面板

- **Word Wrap** — diff/editor 自动换行
- **Auto UTF-8** — 终端开启默认进行 `chcp 65001` 转换
- **CodeGraph** — 代码符号索引，用于智能搜索。关闭可释放主进程约 170MB 内存
- **OCR Image to Text** — 拖入图片或 Ctrl+V 将图片文字识别并粘贴到终端
- **Show squiggles** — diff/editor 界面显示 LSP 诊断波浪线，建议关闭
- **Polling Refresh Git/File** — 每 6 秒轮询刷新 Git 和文件树（仅网络驱动器等文件监听不靠谱的场景建议开启）
- **Force Inline Diff** — 强制使用内联 diff 模式（撤销按钮呈圆形）。建议关闭（side-by-side 更易读）
- **Capsule Tabs** — 使用胶囊风格选项卡替代方形图标按钮
- **ESC Auto @ Selection** — 在 diff 界面选中文字后按 ESC，自动将 `@文件路径:行号` 输入到终端

---

## 10. 节省内存

如果你的机器内存紧张，可以通过以下方式优化：

| 优化项 | 操作 | 节省效果 |
|--------|------|----------|
| **关闭 CodeGraph** | 设置 → Other Options → 取消勾选 CodeGraph | 释放约 170MB 主进程内存 |
| **使用 cmd 替代 PowerShell** | 设置 → Shell Type → 选择 cmd | PowerShell 启动较慢且内存占用更高 |
| **关闭 Show squiggles** | 设置 → Other Options → 取消勾选 Show squiggles | 减少大文件时的 CPU 占用 |
| **关闭 Polling Refresh** | 设置 → Other Options → 取消勾选 Polling Refresh | 减少不必要的轮询开销 |

**提示**：CodeGraph 默认是开启的。如果你不需要代码符号搜索功能（`Alt+K`），建议关掉以节省内存。

---

## 11. 快捷键全表

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 搜索（Search Tab 隐藏时也会自动冒出来）|
| `Ctrl+↑` | 上一个 Session |
| `Ctrl+↓` | 下一个 Session |
| `Ctrl+←` | 右侧标签页左移 |
| `Ctrl+→` | 右侧标签页右移 |
| `Ctrl+H` | 弹出命令历史 |
| `Ctrl+=` | 字体放大（终端/编辑器各自独立） |
| `Ctrl+-` | 字体缩小 |
| `Ctrl+L` | 切换预览/编辑模式 |
| `Shift+Enter` | 终端换行但不发送，适合输入多行prompt |
| `Alt+↑` | 跳到上一条命令（prompt 行间跳转） |
| `Alt+↓` | 跳到下一条命令（prompt 行间跳转） |
| `Alt+K` | 打开 Code Graph 代码图谱搜索 |
| `Alt+F` | 终端内搜索 |
| `Alt+←` | 导航后退 |
| `Alt+→` | 导航前进 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Enter` | 提交 Git commit |
| `PageDown` | 有内容就翻页，没有就透传给 Shell |
| `PageUp` | 同上 |
| `Ctrl+PageDown` | Diff 中跳到下一个区块 |
| `Ctrl+PageUp` | Diff 中跳到上一个区块 |
| `Escape` | 关 Diff 视图 / 关历史浮窗 |

除了 Escape 和 `Ctrl+S`/`Ctrl+Enter`，所有快捷键都能在设置面板里自己改。

---

## 12. Code Graph（代码图谱）

代码符号索引工具，帮你快速搜索项目中的函数、类、接口、组件等。

### 使用方式

| 操作 | 方式 |
|------|------|
| 打开搜索 | `Alt+K`，或长按 `Alt` 点击搜索框 |
| 搜索符号 | 输入关键词，250ms 防抖自动搜 |
| 跳转到定义 | 选中结果后 Enter |
| 查看详情 | 选中结果后 Enter（无精确匹配时触发 Explore） |
| 筛选符号类型 | 点击顶部的 Fn/Me/Cl/If/Co/Va/Ct/Ty 按钮 |

### 符号类型

- **Fn** — 函数
- **Me** — 方法
- **Cl** — 类
- **If** — 接口
- **Co** — 组件
- **Va** — 变量
- **Ct** — 常量
- **Ty** — 类型别名

### 这些你可能用得上

- **首次使用需初始化**：点击搜索框右侧的 "Init" 按钮，首次会建立索引（大项目可能要几分钟）。之后增量更新，很快。
- **排除文件夹**：点搜索框右侧的漏斗图标，可以排除不想索引的文件夹。排除的文件夹会自动写入 `.gitignore`。
- **MCP 配置**：点齿轮图标可以配置 MCP（Model Context Protocol），让 Claude Code、Cursor 等 AI Agent 也能使用代码图谱搜索。
- **内存占用**：开启 Code Graph 会占用约 170MB 主进程内存。不需要时可以在设置里关掉。

---

## 13. 14 套主题

Vibe Dark、VS Code Dark、One Dark、Dracula、Nord、Solarized Dark/Light、Monokai、Monokai Pro、GitHub Light、Tokyo Night、Catppuccin、Hatsune Miku、Hatsune Light。

总有你喜欢的一款。

---

## 14. 右键菜单一览

| 位置 | 右键能干啥 |
|------|-----------|
| 终端（有选中） | 复制 |
| 终端（没选中） | 粘贴 |
| Session 列表项 | Clone / Rename / Auto Approve / Close |
| Session 列表空白 | New Terminal / Recent Directories |
| 自定义命令胶囊 | 编辑 / 删除 |
| 文件树文件 | 打开 / 复制 / 剪切 / 删除 / 重命名 / 在资源管理器中显示 / 文件对比 |
| 文件树目录 | 新建文件 / 新建文件夹 / 粘贴 / 在资源管理器中显示 |
| Git 分支 | 删除分支 |
| 右侧标签页 | 隐藏 |
| 编辑器标题栏编码 | 换编码打开 / 换编码保存 |

---

## 15. 构建与分发

```bash
npm run dev        # 热重载开发
npm run build      # 编译
npm run build:win  # 打包 win 绿色版 → dist/Vibe-IDE-x.x.x-win-x64.zip
npm test           # 测试
```

解压即用，不用安装。注册右键菜单（`register-context-menu.bat`）再钉到任务栏，用起来最顺手。
