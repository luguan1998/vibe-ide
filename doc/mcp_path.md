MCP 走的是 **JSON-RPC over stdio**（标准输入输出），不是 CLI 命令。

启动后，Claude Code 和 codegraph 进程之间是通过管道通信的：

```
Claude Code  ──stdin──→  codegraph (bundled node.exe)
             ←─stdout──
```

对话流程大致是：

1. **发现工具**：Claude Code 发 `tools/list` JSON-RPC 请求，codegraph 返回自己有哪些工具（如 `search_symbol`、`find_references` 等）
2. **调用工具**：当你问"找一下 `main` 函数的引用"，Claude Code 发 `tools/call` 请求，codegraph 执行后返回结果
3. **持续运行**：进程一直存活，反复收发 JSON-RPC，直到会话结束

全程没有新的 `spawn` / `npx` / 路径参与 —— 配置里的长路径只在**启动那一刻**用了一次，之后就全是 stdio 管道对话了。所以完全不用担心路径长度影响运行时。