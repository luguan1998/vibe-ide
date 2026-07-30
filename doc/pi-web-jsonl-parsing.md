# pi-web JSONL 解析调研报告

## TL;DR

**结论：找不到名为 "pi-web" 的 JSONL 解析器 / 查看器项目。** 经过在 GitHub、Google、Anthropic 官方生态的广泛搜索，"pi-web" 这个字面名字对应的是 **pi 编程代理的"联网工具扩展"**（提供 `web_search` / `web_fetch` 能力），而不是读取 JSONL 会话日志的 Web UI。本报告如实记录搜索过程、候选项，并给出可替代的参考方向，避免把别的项目套上 "pi-web" 的名字糊弄过去。

---

## 1. 搜索过程

| 搜索词 | 位置 | 结果 |
|--------|------|------|
| `pi-web claude` | GitHub repo search | 得到 3 个含 `pi-web` 字样的仓库，**无一是 JSONL 解析器** |
| `pi-web jsonl` | GitHub repo search | **0 条结果**，页面明确显示 "Your search did not match any repositories" |
| `pi claude cli jsonl` | GitHub repo search | 找到 `wutongyuonce/Trajex`（索引多种 coding agent 的 JSONL 到 SQLite），但项目不叫 pi-web |
| `"pi-web"` | Google | 全是 Raspberry Pi 个人主页、Pi Network 加密货币，无相关项 |
| `pi-web` | npm | 是 pi 编程代理的联网工具扩展包 |
| `site:pi.dev web viewer / jsonl / session log` | pi.dev 官网 | 仅提到 `pi-share-hf`（发 HF 数据集）和 "Export to HTML"，无 JSONL 解析 Web UI |

---

## 2. 字面意义上的 "pi-web" 到底是什么

### 2.1 `Boti-Ormandi/pi-web`
- **仓库**：<https://github.com/Boti-Ormandi/pi-web>
- **语言/星标**：TypeScript / 1 ★
- **定位**：为 [pi 编程代理](https://pi.dev) 提供原生 `web_search` 与 `web_fetch` 工具，复用 pi 托管的 OpenAI Codex 或 Anthropic 订阅 OAuth。
- **安装**：`pi install npm:@boti-ormandi/pi-web`
- **与 JSONL 的关系**：❌ 无。它是工具扩展，不是会话查看器。

### 2.2 `mavam/pi-web-providers`
- **仓库**：<https://github.com/mavam/pi-web-providers>
- **语言/星标**：TypeScript / 82 ★
- **定位**：pi 的"元 Web 扩展"，按工具路由到 Brave / Claude / Exa / Gemini / Tavily 等后端。
- **配置路径**：`~/.pi/agent/web-providers.json`
- **与 JSONL 的关系**：❌ 无。

### 2.3 `earendil-works/pi`（pi 本体）
- **仓库**：<https://github.com/earendil-works/pi>
- **语言/星标**：TypeScript / 80.6k ★
- **定位**：AI agent 工具箱 —— 统一 LLM API、agent 循环、TUI、编程代理 CLI。
- **会话分享**：通过 `pi-share-hf` 发布到 Hugging Face 数据集，或 "Export to HTML" 拿可分享 URL，**不暴露 JSONL 解析 Web UI**。

### 2.4 `eloantg-alt/Pi-Web`
- 树莓派个人主页，❌ 无关。

---

## 3. 如果用户真正想找的是"Claude Code / 编程代理 JSONL 会话查看器"

以下是本次搜索中**真正**在做 JSONL 解析的项目（都不是 pi-web，但功能对齐需求）：

### 3.1 `wutongyuonce/Trajex`
- **仓库**：<https://github.com/wutongyuonce/Trajex>
- **定位**：把 Claude Code、Codex、Kimi Code、**pi** 的 JSONL 会话日志统一索引进 SQLite；提供 CLI 毫秒查询 + Web App 可视化浏览。
- ** relevance**：高 —— 这是目前搜到的唯一一个把 pi 的 JSONL 和 Claude Code 的 JSONL 一起解析并带 Web UI 的项目。
- **建议**：如果目的是"学习别人怎么解析编程代理 JSONL"，这个仓库比任何 pi-web 都更贴近需求，值得作为真正的调研对象。

### 3.2 `anthropics/claude-code`（官方）
- **仓库**：<https://github.com/anthropics/claude-code>
- **相关模块**：官方内置的 `/resume` 命令需要读取 `~/.claude/projects/<hash>/*.jsonl`。
- **建议**：vibe-ide 已经在 `src/main/ai.ts` / `src/renderer/src/App.tsx` 里自己解析同样的 JSONL 格式，可以直接对照官方 schema。

### 3.3 vibe-ide 自身现有实现
- `src/main/ai.ts`：spawn `claude -p ... --output-format stream-json --verbose`，用 `lineBuffer` 做行缓冲 + `JSON.parse(line)` 解析每条 stdout 事件。
- `src/main/ai-revert.ts`、`src/shared/types.ts`（`AiMessage` / `AiToolUse` / `AiToolResult` / `UserTurn`）：消息类型定义。
- 已经处理了：行缓冲（partial write）、`system/init`、`stream_event`、`text_delta`、工具调用、`<local-command-caveat>` 等标签清洗（`cleanText`）。

---

## 4. 建议的下一步

1. **确认目标**：用户口中的 "pi-web" 是否就是指 Trajex？还是另一个私有 / 已改名 / 下线的项目？如果能提供来源链接（博客、推文、群聊截图），可以直接定位。
2. **如果目标是 Trajex**：我可以按同样的方法（读源码 → 提炼解析函数 → 写 `doc/trajex-jsonl-parsing.md`）再做一次调研。
3. **如果目标是 Claude Code 官方 JSONL 解析**：vibe-ide 自己已经在做，可以反向整理一份 `doc/claude-code-jsonl-format.md` 把现有 schema 沉淀下来，方便以后重构。
4. **如果 pi 本身有私有/未公开的 JSONL Web viewer**：需要 pi.dev 账号或其 Discord/文档站进一步查证，公开搜索面已经穷尽。

---

## 5. 未做之事（按要求明示）

- ❌ 没有把 `Boti-Ormandi/pi-web`（联网工具扩展）冒充 JSONL 解析器写进报告。
- ❌ 没有把 `Trajex` 改名叫 "pi-web" 充数。
- ❌ 没有编造源码文件路径、行号、代码片段。

---

## 来源

- GitHub repo search (2026-07-30 实时查询)：
  - <https://github.com/search?q=pi-web+claude&type=repositories>
  - <https://github.com/search?q=pi+claude+cli+jsonl&type=repositories>
  - <https://github.com/search?q=pi-web+jsonl&type=repositories>
  - <https://github.com/search?q=pi+coding+agent&type=repositories>
- 仓库 README 直接抓取：
  - <https://github.com/Boti-Ormandi/pi-web>
  - <https://github.com/mavam/pi-web-providers>
  - <https://github.com/earendil-works/pi>
- 官网 <https://pi.dev>（无公开 JSONL/web viewer 文档）
- vibe-ide 本地源码：`src/main/ai.ts`、`src/main/ai-revert.ts`、`src/shared/types.ts`、`doc/cc_json.md`
