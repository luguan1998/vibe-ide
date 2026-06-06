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

### 这些你可能还不知道

- **过滤规则**：设置里可以配置想跳过的目录（默认 `.git`、`node_modules`、`dist` 这些）。
- **展开深度可调**：设置里 1-8 级随便调。
- **文件图标自动匹配**：95+ 种文件类型都有对应的图标。
- **二进制文件先问再开**：PNG 这类文件打开前会先弹确认，不会直接塞给你一堆乱码。

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
| **Other Options…** | 更多选项 |

### Other Options 子面板

- **Word Wrap** — 自动换行
- **Auto UTF-8** — 终端 UTF-8 编码
- **Show squiggles** — 诊断波浪线
- **Polling Refresh Git/File** — 6 秒轮询（网络驱动器用）
- **Force Inline Diff** — 强制内联 diff
- **Capsule Tabs** — 胶囊标签栏

---

## 10. 快捷键全表

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
| `Shift+Enter` | 终端换行但不发送，适合输入多行propmt |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Enter` | 提交 Git commit |
| `PageDown` | 有内容就翻页，没有就透传给 Shell |
| `PageUp` | 同上 |
| `Ctrl+PageDown` | Diff 中跳到下一个区块 |
| `Ctrl+PageUp` | Diff 中跳到上一个区块 |
| `Escape` | 关 Diff 视图 / 关历史浮窗 |

除了 Escape 和 `Ctrl+S`/`Ctrl+Enter`，所有快捷键都能在设置面板里自己改。

---

## 11. 14 套主题

Vibe Dark、VS Code Dark、One Dark、Dracula、Nord、Solarized Dark/Light、Monokai、Monokai Pro、GitHub Light、Tokyo Night、Catppuccin、Hatsune Miku、Hatsune Light。

总有你喜欢的一款。

---

## 12. 右键菜单一览

| 位置 | 右键能干啥 |
|------|-----------|
| 终端（有选中） | 复制 |
| 终端（没选中） | 粘贴 |
| Session 列表项 | Clone / Rename / Auto Approve / Close |
| Session 列表空白 | New Terminal / Recent Directories |
| 自定义命令胶囊 | 编辑 / 删除 |
| 文件树文件 | 打开 / 复制 / 剪切 / 删除 / 重命名 / 在资源管理器中显示 |
| 文件树目录 | 新建文件 / 新建文件夹 / 粘贴 / 在资源管理器中显示 |
| Git 分支 | 删除分支 |
| 右侧标签页 | 隐藏 |
| 编辑器标题栏编码 | 换编码打开 / 换编码保存 |

---

## 13. 构建与分发

```bash
npm run dev        # 热重载开发
npm run build      # 编译
npm run build:win  # 打包 win 绿色版 → dist/Vibe-IDE-x.x.x-win-x64.zip
npm test           # 测试
```

解压即用，不用安装。注册右键菜单（`register-context-menu.bat`）再钉到任务栏，用起来最顺手。
