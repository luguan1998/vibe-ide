# SSH 远程开发 TODO

目标：新建工作区支持 SSH，远程会话可浏览目录、执行 git、LSP 跳转。
方案：Orca 式 C-lite —— 本地 UI + 远端 relay（Node ≥18，JSON-RPC over SSH stdio）。

## 已确定

- SSH 库：`ssh2`；`~/.ssh/config` 通过系统 `ssh -G` 解析，ProxyJump 逐跳 `forwardOut`
- 远端运行时：要求 Node ≥18，relay 部署到 `~/.vibe-ide/relay/<hash>/relay.js`
- 远程 AI：不做
- SSH 会话重启后保留占位，默认不自动连接，点击会话时才重连并重建终端

## 已完成

- [x] `src/main/remote/ssh-config.ts`：`ssh -G` 解析 host/user/port/identityfile/proxyjump
- [x] `src/main/remote/ssh.ts`：连接、密码/私钥/agent、ProxyJump、relay 部署、host key TOFU
- [x] `src/main/remote/relay-client.ts`：NDJSON 请求/响应
- [x] `src/main/remote/hosts-store.ts`：主机持久化 + `safeStorage` 密码
- [x] `src/relay/index.ts`：ping / fs.home / fs.list / fs.stat / fs.read / fs.write
- [x] SSH 终端：`client.shell()` 接入现有 PTY IPC，自动 `cd` 到远端目录
- [x] 新建工作区弹窗：标题右侧 `本地 / SSH` tab（带 SVG 图标）
- [x] SSH tab：主机增删改、连接、远程目录浏览、启动
- [x] SSH 会话在会话列表中独立成条（不进 cwd 分组，行首 SSH 图标）
- [x] 远程会话关闭时自动断开对应 SSH 连接

## TODO

### P0 文件系统路由

- [x] `remote/roots.ts`：SSH 终端启动时按 cwd 注册远端根，路径前缀命中即路由到该连接
- [x] `file.ts` 的 read/readEncoding/write/writeEncoding/list/tree/find/searchByName/delete/rename/mkdir/copy/move 按远端路径路由（渲染层无需传 connectionId）
- [x] relay 补齐：tree / find / searchByName / delete / rename / mkdir / copy / move / readBase64 / writeBase64 / readText
- [x] 编码探测仍在主进程：relay 传 base64，iconv-lite + jschardet 复用本地逻辑
- [x] relay 部署时连 `chunks/*.js` 一起拷贝（simple-git 被抽成共享 chunk）
- [x] openExplorer / openTerminal 对远端路径直接返回错误
- 验收：远程文件树、打开/编辑/保存、新建目录、重命名、删除

### P0 Git

- [x] relay 内置 `simple-git`（electron-vite `exclude: ['simple-git']` 打进 relay）
- [x] `newGit()` 命中远端根时返回 Proxy，调用透传为 relay `git.call`（method + args）
- [x] `git.setWorkspace` 远端时跳过本地 watcher，`--git-common-dir` 用 posix 解析
- [x] GitTab 远程状态/暂存/提交/分支/diff/show/push/stash
- [x] worktree / submodule / applyBranch 对远端返回明确错误
- 暂不做：worktree、PR、submodule、graph/lineLog 缓存、远端变更自动刷新
- 验收：远端仓库改文件 → GitTab 刷新 → 暂存 → 提交 → 切分支 → push

### P1 LSP

- [ ] 远端 `conn.exec('<server> --stdio')` 接入现有 LSP client
- [ ] `lsp.ts` 增加 `pathMode: 'win' | 'posix'`
- [ ] `pathToFileURL` / `fileURLToPath` / `normalizeDrive` / `isUnderRoot` 分支
- [ ] LSP 兜底读文件走 backend
- 验收：远端 TS 文件定义跳转、引用、诊断

### P1 文件监听

- [x] SSH 会话 busy→idle 边沿补一次目录树 + GitTab 刷新（轻量兜底，无需远端常驻监听）
- [ ] relay `fs.watch` 推送 `fs:changed`
- [ ] 或低频轮询兜底
- 验收：远端外部改动后文件树/GitTab 自动刷新

### P1 会话与连接生命周期

- [x] SSH 会话跨重启恢复：存 `sshHostId`，重启后占位（不自动连），点击时重连 + 重建终端
- [ ] 组键带 `connectionId`，避免两台主机同路径合并
- [ ] 断线重连状态机（connecting / auth-failed / deploying / connected / reconnecting / closed）
- [ ] 多会话共享同一 SSH 连接的引用计数
- [ ] 删除主机时清理关联会话与连接

### P2 安全与体验

- [ ] host key 首次连接异步弹窗确认指纹（当前 TOFU 自动接受）
- [ ] 导入 `~/.ssh/known_hosts`
- [ ] ProxyCommand 支持
- [ ] 跳板机密码
- [ ] 私钥 passphrase 持久化策略
- [ ] 远程搜索（远端 rg）
- [ ] 远程 AI（暂定不做）

## 已知限制

- 两台主机同路径会合并到同一会话组
- Windows 不能作远端：relay 部署依赖 POSIX `$HOME` / `printf`
- ProxyCommand 不支持
- 主机密钥首次连接自动信任，尚无 UI 确认
- nvm 安装的 Node 可能探测不到（非交互式 PATH），建议系统级安装
- 远端无文件监听：仅在 SSH 会话 busy→idle（如终端命令结束）时补刷目录树与 GitTab；外部机器或后台进程改动仍需手动刷新
- 远端暂不支持：内容搜索（ripgrep）、LSP、CodeGraph、PR、worktree、submodule、applyBranch
- 远端根按首次启动的 cwd 注册；两台主机同路径仍会串（同组键限制）

## 验证清单

- [ ] VM：Ubuntu + `openssh-server` + 系统级 Node ≥18 + git
- [ ] 应用内：新增主机 → 连接 → 列出 home → 进入目录 → 启动终端
- [ ] 终端 `pwd` 为远端路径，`git status` 可用
- [ ] SSH 会话下打开 Dir：文件树、打开/编辑/保存、新建文件夹、重命名、删除
- [ ] SSH 会话下打开 Git：状态、暂存、提交、切分支、diff、push
- [ ] 错误密码 → 明确报错，无残留连接
- [ ] 停 sshd → 终端退出，应用不崩
- [ ] 关闭会话 → 远端 `pgrep -f relay.js` 为空
- [ ] 删除全部主机 → 底部 SSH 区消失

## 关键文件

```
src/main/remote/ssh-config.ts
src/main/remote/ssh.ts
src/main/remote/relay-client.ts
src/main/remote/hosts-store.ts
src/main/pty.ts
src/relay/index.ts
src/renderer/src/components/DirectoryPicker.tsx
src/renderer/src/components/SessionPanel.tsx
src/renderer/src/sessionRestore.ts
src/renderer/src/App.tsx
src/shared/types.ts
electron.vite.config.ts
```
