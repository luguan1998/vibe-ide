# IDE 内置浏览器调试局限性

## 结论

IDE 内置浏览器（`BrowserView` + `<webview>`）**无法用于调试自家 Electron 渲染进程**。

## 原因

### 1. `window.api` 缺失

渲染进程依赖 Electron preload 注入的 `window.api`（terminal/git/file/workspace/search/ai 等 IPC 桥接）。webview 里没有 preload，`window.api` 为 `undefined`，App 初始化直接崩溃，白屏。

### 2. Chrome DevTools 无法嵌入

`chrome-devtools://` 协议页面和 `http://localhost:9222/devtools/inspector.html` 有 X-Frame-Options 保护，不允许被 `<webview>`/`<iframe>` 嵌入，导航后显示 `about:blank#blocked`。

### 3. 本地端口跨域

即使 Vite dev server 在 `localhost:5173` 正常服务，webview 内加载的页面也无法访问 Electron 主进程资源。

## 远程调试尝试

- `electron-vite dev -- --remote-debugging-port=9222` 可以暴露 Chrome DevTools Protocol 端口
- `http://localhost:9222/json` 可以获取可调试目标列表
- 但 DevTools 前端页面有反嵌入保护，无法在 `<webview>` 中打开

## 推荐调试方式

| 场景 | 方式 |
|------|------|
| UI 布局/样式 | IDE 浏览器开外部页面，羽毛笔标注 |
| 渲染进程逻辑 | Electron 窗口内 `Ctrl+Shift+I` |
| 主进程逻辑 | `--inspect` + Chrome `chrome://inspect` |
| 羽毛笔标注 | IDE 浏览器开任意网页 |

## 相关修改

- `BrowserView.tsx` `commitAddress` 增加了显式 `wv.loadURL()` 调用，解决地址栏回车不跳转的问题
