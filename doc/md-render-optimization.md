# MD 渲染优化方向

## 双击编辑的代价

当前双击 code block 进入编辑态，需 Monaco editor 接管渲染。问题：
- 切换编辑/预览模式时 Monaco 实例创建销毁开销大
- 多 block 场景下每个独立 Monaco 实例内存叠加
- colorize（预览态）与 editor（编辑态）之间切换有闪烁

## Monaco 过重

`monaco.editor.colorize()` 对每个 code block 单独调用，问题：
- 多 block 页面（如长文档几十个代码块）并发 colorize 排队耗时
- 已用并发限制（MAX_CONCURRENT=2）缓解，但 Monaco 自身加载仍重
- 考虑方向：轻量 highlighter（Shiki/Prism）替代 Monaco colorize；或虚拟滚动只渲染可视区 block

---

## 流式渲染优化（调研 2026-08）

两份调研结论：**① 增量/块级缓冲渲染（不全量重渲染旧 markdown）② 逐行/逐块淡入（Codex 风格）**。
方法：以一手源码为准（openai/codex、vercel/streamdown、vercel-labs/ai-chatbot、react-markdown 内部实现、React/MDN 官方文档）。
⚠️ 调研教训：搜索引擎摘要中出现的 `reworkd/StreamMD`、`guibranco/react-markdown-stream`、`dominikmajda/markdown-stream-parser` 等"现成库"**全部 404 不存在**，属 AI 生成的幽灵结果，勿引用、勿装。

### 现状：每次 flush 都整篇重解析

流式管线（无需改动部分）：
- `src/renderer/src/aiStore.ts`：token 经 **RAF 合并 + 200ms throttle** 追加进 `streamBuffer`（`pendingTokens`/`flushTokens`，约 362-549 行）。这已是业界标准节流，streamdown 的 `useThrottledDebounce(200, 50)` 与之同级，不用再改。
- `src/renderer/src/components/AiTab/index.tsx:1079`：busy 区 `<StreamingMarkdown text={state.streamBuffer}>`。

问题所在（`src/renderer/src/components/AiTab/markdown.tsx` `StreamingMarkdown`）：
1. 只按 **代码围栏** 切 `safePart`（到最后一个闭合围栏）/ `rawPart`（未闭合围栏按明文 `<pre>`）——对段落/表格/列表没有任何 block 边界。
2. 每次 flush 把 **整个 `safePart` 重新喂给 `<ReactMarkdown>`**：react-markdown v10 内部（`MarkdownHooks`，见 react-markdown `lib/index.js`）虽然用 `useMemo` 缓存了 unified processor（仅依赖 plugin 引用），但 `children` 一变就必须 `processor.parse() + run()` 全量重跑 → 累计 O(n²)。`ChatMarkdown` 的 `React.memo` 对 text 一直变的情况无效。
3. `MarkdownCodeBlock.tsx` 的 `CodeBlock` effect 依赖 `[code, monacoLang, theme]`，闭合块 `code` 稳定所以 **colorize 不重跑**，但组件本体仍随每次 flush 重建 vdom（无 memo，白跑渲染）。

**要点：业界（含 Codex）也做不到"只解析增量文本"，能优化的是「解析照跑、渲染/提交只碰最后一个 block」。**

### 方案一：增量/缓冲渲染（block 切分 + memo 冻结）

#### 业界实际做法（一手源码）

**① OpenAI Codex TUI（`openai/codex`，Rust/ratatui）** —— 最完整的参考系：
- `codex-rs/tui/src/markdown_stream.rs` `MarkdownStreamCollector`：缓冲 delta，`commit_complete_source()` **只提交到最后一个 `\n` 的完整源**；无换行的尾巴不渲染（注释原文：*"prevents the live stream from rendering incomplete markdown blocks that may change meaning when the rest of the line arrives"*）。
- `codex-rs/tui/src/markdown_render/streaming.rs` `TopLevelBlockTracker`：在 **同一次解析** 里用 offset iter 记录顶层 block 起止（`last_top_level_block_start`），调用方只重渲染从该 offset 起的可变尾巴，前面已渲染行原样保留。
- `codex-rs/tui/src/streaming/table_holdback.rs`：表格聚合成可变尾（header 未确认 delimiter 前 holdback，新行可回流已渲染行）。
- `codex-rs/tui/src/streaming/code_fence.rs` `OpenCodeFence`：append-only 打开围栏独立流式高亮（`StreamingCodeHighlighter`），只重染围栏内新增部分。
- 注意 nuance：`commit_complete_lines` 其实 **每 tick 也对完整已提交源跑一遍 `append_markdown`**，然后按 `committed_line_count` 切出新增行——Codex 的"增量"体现在**渲染/提交边界**，不在解析本身。

**② Vercel Streamdown（`vercel/streamdown`，AI SDK "AI Elements" 官方流式 markdown 渲染器，`react-markdown` 的 drop-in 替代）** —— Web 侧最直接参照：
- `lib/parse-blocks.tsx` `parseMarkdownIntoBlocks`：用 `marked` 的 `Lexer` 全量分词后**按 token 合并成 block 数组**（HTML 开闭标签配对栈、`$$` 数学跨 token 合并、代码块专用处理）；页脚注存在时整篇单 block（保 mdast 树完整）。
- `index.tsx`：`blocks = useMemo(parseMarkdownIntoBlocks, [children])`，`Block = memo(..., 自定义比较器)`——比较器对 `content`/`index`/`isIncomplete`/`components`/plugins 逐项深比较，**已完结 block 的 content 不变 → 整个子树跳过 render**（ReactMarkdown 不跑、DOM 不动、动画不重播）。block key 只用索引（注释：*"Don't use content hash - that causes unmount/remount"*）。`components` 引用变化也会被比较器识别（本项目 `useStableCodeOverrides` 已保证稳定引用，正好契合）。
- 上游在 `vercel-labs/ai-chatbot` 的使用（`components/chat/message.tsx` + `components/ai-elements/message.tsx`）：文本 part → `<MessageResponse>`（`streamdown` 封装，`memo` 自定义比较器 `prevProps.children === nextProps.children`）。

**③ react-markdown 官方立场**：v10 `MarkdownHooks` 缓存 processor、每次 children 变更全量 parse+run（同步 `Markdown` 变体无 hooks 一条路渲染）。生态现状：绝大多数 OSS 聊天 UI（如 `ChatGPTNextWeb/ChatGPT-Next-Web` `app/components/markdown.tsx`）仍是每 chunk 整篇 `<ReactMarkdown>`。

#### 本仓库可行性对比

| 方案 | 改动量 | 收益 | 风险 |
|---|---|---|---|
| A. 自研轻量切分 + memo Block（在现有 fence 逻辑上扩展空行/块起始切分） | 中（markdown.tsx 内 ~150 行） | 闭合块零重渲染；自动兼容现有 CodeBlock/双击编辑/15 主题 | 自维护切分边界（表格/列表/HTML） |
| B. 引入 `streamdown` 库 | 小（替换组件） | block memo + 内置词级淡入 + shiki/katex/mermaid 全套 | 组件树是它自己的（`CodeBlock` 换成 shiki 体系），与现有 Monaco colorize、双击编辑、主题桥冲突，短期不推荐 |
| C. 真增量解析（`@lezer/markdown` 式增量树） | 大 | 连解析都增量 | 非 remark 系渲染栈，与 react-markdown 生态割裂，不推荐本期 |

#### 落地骨架（方案 A）

```tsx
// markdown.tsx 内：给 Streamdown 的简化版（fence 逻辑保留 + 空行/块起始切分）
function splitBlocks(md: string): { content: string; done: boolean }[] {
  // 1. 沿用现有 fenceRe 计数：未闭合围栏之前的源为"已完结区"
  // 2. 已完结区内按 空行分组(+块起始: # | - > ``` 等) 切分
  // 3. 未闭合围栏尾巴作为最后一个 done=false 的 raw block（现有 rawPart 逻辑）
}

const Block = React.memo(function Block({ content, done, onComplete }: {
  content: string; done: boolean; onComplete?: () => void
}) {
  return (
    <div className={done ? 'md-block--done' : 'md-block--live'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={useStableCodeOverrides()}>
        {content}
      </ReactMarkdown>
    </div>
  )
}, (p, n) =>
  p.content === n.content &&          // 已完结 block：内容永不再变 → 整个子树冻结
  p.done === n.done &&
  p.onComplete === n.onComplete)

export function StreamingMarkdown({ text, ... }) {
  const blocks = useMemo(() => splitBlocks(cleanMessageContent(text)), [text])
  return <div className="ai-tab__markdown ai-tab__markdown--streaming md-preview">
    {blocks.map((b, i) => (
      <Block key={i} content={b.content} done={b.done} />
    ))}
  </div>
}
```

要点：`key={i}` 稳定；`done` block 由自定义比较器冻结（ReactMarkdown 完全不执行、子树零 diff）；只有最后一个 `done=false` 的活 block 每次 flush 重渲染。备注：若担心已完结区每次 `splitBlocks` 的切分成本，可对 `done` 块结果做 `useRef` 拼接缓存（首 ToR——切分是 O(n) 级，通常不需要）。

#### 可选加固

- **`useDeferredValue` 降级渲染**（React 官方文档）：把 `text` 包 `useDeferredValue` → 输入/滚动等紧急更新优先，markdown 重解析丢后台可中断。本项目 aiStore 已有 200ms 节流，二者叠加会让流式延迟翻倍——**建议不叠加**，如要更顺滑只对最后一个活 block 内部应用。
- **表格/list 聚合**：借鉴 `table_holdback.rs`，tab 起始行后若未出现 delimiter 行按住不提交（本期可后置）。

### 方案二：Codex 式逐行/逐块淡入

#### Codex 实际机制（TUI，源码级）

Codex **不做 opacity 动画**，它做的是**逐行放行（pacing）**：`streaming/controller.rs` 的 `StreamController` 把 delta 切成行队列；`streaming/commit_tick.rs` + `streaming/chunking.rs` 的 `AdaptiveChunkingPolicy` 每 **`COMMIT_ANIMATION_TICK = TARGET_FRAME_INTERVAL`**（`tui.rs`，即每帧）只让 **1 行**（`ChunkingMode::Smooth`）进入可见区——这就是"新增行一行一行冒出来"的真相；队列 ≥ `ENTER_QUEUE_DEPTH_LINES=8` 行或超龄时进 `CatchUp` 全量排空，`SEVERE_QUEUE_DEPTH_LINES=64` 强排空（防延迟累积）。动画由 `AppEvent::StartCommitAnimation/StopCommitAnimation` 控制（`app/tests/stream_animation_tests.rs` 验证节奏与 tick 丢弃）。Web 侧等价物就是**新节点带 CSS fade-in + stagger delay**，配 `fill-mode: both`。

#### Streamdown 的词级淡入（Web 侧参照，`lib/animate.ts` + `styles.css`）

- 动画 rehype 插件按 `prevContentLength` 与前一次渲染字数差，**只给新增字符的 span 盖章** `data-sd-animate` + CSS 变量 `--sd-delay`——旧节点不盖章故不重播动画（"已可见文本视为 settled"）。
- 跨 block 共享 **wall-clock timeline**（`beginPass → 各 block rehype take(wordCount, stagger) → commitPass`），memo 掉的早 block 不参与 render 也不丢时序；`maxBacklogMs=320` 兜底：快流自动压缩 stagger；StrictMode 用 `mark`/`rewind` 防双跑错位。
- 列表 marker 用 `::marker` 的 `color: transparent` 过渡（`::marker` 不支持 opacity/transform）。
- 官方 CSS（`packages/streamdown/styles.css`，可直接借鉴）：

```css
@keyframes sd-fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes sd-slideUp { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
[data-sd-animate] {
  animation: var(--sd-animation, sd-fadeIn) var(--sd-duration, 150ms)
             var(--sd-easing, ease) var(--sd-delay, 0ms) both; /* both: delay 期间保持 from 态 */
}
```

#### 本仓库落地（可直接用的写法）

**挡住重触发动画的关键**：
1. **key 用索引不用 hash**（hash 会让内容变动的旧行 remount 重播动画）；
2. `done` block 被 memo 冻结 → 连 vdom 都不产生，动画不可能重播；
3. CSS 动画只在元素**首次插入**时播放，更新已有元素属性不重播（规范行为）——所以只要不重建节点，旧行永远安全；
4. 行/块淡入**只作用于 busy 区流式期间**：提交路径 `ChatMarkdown` 不加动画（现有 `messages.tsx` 的 `isLive`/`wasLiveRef` 已让 live 消息 root 跳过 fade-in，勿动）；
5. 动画只用 `opacity`/`transform`（不触发重排），不与 `ThinkingBlock` 的 grid 折叠、底部 pinned scroll clamp 冲突。

**块级淡入（markdown 语义安全，推荐）**——对每个新 become-done 的 block 挂载时淡入（stagger 由父级时间线分配）：

```tsx
// 父组件维护挂载时间线（借鉴 streamdown timeline 的最小版）
const timelineRef = useRef(0)
function FadeInBlock({ index, children }: { index: number; children: React.ReactNode }) {
  const delay = useMemo(() => timelineRef.current++, [])   // 稳定递增，memo 后不再重算
  return <div className="md-block-enter" style={{ '--enter-delay': `${delay}ms` } as React.CSSProperties}>{children}</div>
}
```

```css
@keyframes md-fade-in-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.md-block-enter { animation: md-fade-in-up 160ms ease both; animation-delay: var(--enter-delay, 0ms); }
/* 两行以上 cascade：也可在父级用 --enter-order 逐行 +15ms，参照 index.tsx 已有 claude-row-enter 的 --enter-delay 用法 */
```

**行级淡入（仅纯文本/代码内部，Codex 观感）**——只在 block 已完成后才按行包装；markdown 表格/列表段落聚合未完毕前**不要**按行淡入（行可能回流）：

```tsx
function FadeInLines({ text }: { text: string }) {
  const lines = text.split('\n')
  return <>{lines.map((line, i) => (
    <div key={i} className="md-line-enter" style={{ '--enter-delay': `${i * 18}ms` } as React.CSSProperties}>
      {line || ' '}
    </div>
  ))}</>
}
```

**不用 JS 盖章的现代替代**：`@starting-style`（MDN，Chrome 117+，Baseline 2024）可为**首次挂载**的元素提供 transition 起始值，无需属性盖章；但它只对 CSS transition 生效（动画仍需 @keyframes），且仅覆盖"展示即动画"，需要 stagger 时仍要 delay。

### 与既有约束的兼容检查

- 记忆 `feedback-ai-thinking-render.md`：busy 区 `ThinkingBlock` 保持 `defaultOpen` 展开、不截断；live 消息 `autoFold` 平滑折叠、root 跳过 fade-in——**本文案不触碰 thinking**，淡入不参与提交路径，无冲突。
- `ChatMarkdown`（已提交消息）保持无动画；历史/resume 消息维持原 `animate-fade-in` 不变。
- 中断（用户 Cancel/停）时最后一个半 block 冻结即可，无需 flush 动画。

### 落点清单

| 文件 | 改动 |
|---|---|
| `src/renderer/src/components/AiTab/markdown.tsx` | `StreamingMarkdown` 重写：fence→`splitBlocks`（空行/块起始切分）+ memo `Block` + 末尾活 block；包一层块级淡入 |
| `src/renderer/src/components/AiTab/index.tsx:1079` | busy 区调用处传 `animated`/`isLive` 开关（如需要） |
| `src/renderer/src/styles/globals.css`（或 snippets） | `md-fade-in-up` / `md-line-enter` keyframes + 规则（用主题 token，不硬编码色值） |
| `src/renderer/src/components/MarkdownCodeBlock.tsx` | `CodeBlock` 加 `React.memo`（低风险即时收益）；未闭合围栏后续可升级 `OpenCodeFence` 式流式高亮（本期保持 rawPart） |
| `src/renderer/src/aiStore.ts` | 不改（节流已有） |
| `src/renderer/src/components/AiTab/messages.tsx` | 不改（约束区） |

### 引用来源

- Codex TUI 源码（openai/codex, main）：`codex-rs/tui/src/markdown_stream.rs`、`markdown_render/streaming.rs`、`streaming/controller.rs`、`streaming/chunking.rs`、`streaming/commit_tick.rs`、`streaming/table_holdback.rs`、`streaming/code_fence.rs`、`app.rs`（COMMIT_ANIMATION_TICK）、`tui.rs`（TARGET_FRAME_INTERVAL）、`app/tests/stream_animation_tests.rs` — https://github.com/openai/codex
- Streamdown（vercel/streamdown, main）：`packages/streamdown/index.tsx`（Block memo 比较器 / blockKeys 注释）、`lib/parse-blocks.tsx`、`lib/animate.ts`、`packages/streamdown/styles.css`、`hooks/use-throttled-debouce.ts`、`hooks/use-deferred-render.ts`、`__benchmarks__/streaming-rerender.bench.tsx`、README — https://github.com/vercel/streamdown ；npm https://www.npmjs.com/package/streamdown
- Vercel AI Chatbot（vercel-labs/ai-chatbot, main）：`components/chat/message.tsx`（MessageResponse 接入）、`components/ai-elements/message.tsx`（`memo` 比较器）、`components/ai-elements/code-block.tsx`（shiki token 先行渲染） — https://github.com/vercel-labs/ai-chatbot
- react-markdown v10 内部：`lib/index.js`（MarkdownHooks processor 缓存 / 同步 Markdown 变体）— https://github.com/remarkjs/react-markdown/blob/main/lib/index.js （经 context7 文档：https://context7.com/remarkjs/react-markdown）
- React `useDeferredValue`（慢子树降级渲染 + memo 配合）— https://react.dev/reference/react/useDeferredValue
- MDN `@starting-style`（Chrome 117+/Baseline 2024，仅 transitions，首个 style update/挂载生效）— https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style
- 对照组（全量重渲染现状）：ChatGPT-Next-Web `app/components/markdown.tsx`（整篇 `<ReactMarkdown>` per chunk）— https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web
- ChatGPT / Claude.ai / Cursor 为封闭源码，本文未引用其内部；可观测行为（流式期间只有尾部在变、滚动 pinned 底部）与 streamdown/codex 的可复现实现一致。

---

## 桌面端专项：逐字/逐行淡入 + 增量渲染（2026-08 补充）

基于一手源码，只针对桌面 GUI（Claude Code 桌面端/web profile、Codex 桌面/web 及可溯源的 OSS 客户端）。

### ⚠️ 更正上一轮一条结论

上一轮「要点：业界（含 Codex）也做不到"只解析增量文本"」**已被推翻**——本仓库 vendored 的 Claude Code web profile 源码（`vendor/harness`，cc GUI 同源）实现了**真增量 block 级解析**（CommonMark 行级解析 + 冻结除尾 2 块的多缓冲）。上一轮说反的根源是只调研了 TUI（openai/codex Rust 侧确实每 tick 全量 append_markdown 再切提交边界）。桌面端结论以本章为准。

### A. Claude Code 桌面端 / web profile 真实实现（一手源码）

全部引用自 `D:\test\vibe-ide\vendor\harness\packages\client\`，是本仓库 vendored 的 cc GUI 源码（DeepSeek 分叉，渲染管线与 Anthropic 同源版一致）。

#### A1. 流式渲染全链路（"不整篇重渲染旧 md"的实现）

1. **发布节流（帧级）**：`ui-conversation/src/client/conversation-nodes/assistant.ts:278-283`，`assistant-step` 节点的 `publication` 对 `assistant/chunk` 事件返回 `'animation-frame'`（`usage`/`finish` 为 `'none'`）——**token delta 按动画帧合并发布**，不是每 token 一次 setState。等价于本项目 aiStore 的 RAF 合并，但比 vibe-ide 的 200ms throttle 更激进（60fps）。
2. **按块累积**：`assistant.ts:80-132` `updateChunk` —— `blocks[chunk.index].text += chunk.text`（`text-delta`），块数组按 index 稳定增长（`block-start` 先占位）。
3. **真增量解析**：`ui-primitives/src/markdown/incremental.ts` `IncrementalMarkdownParser`：
   - 逐 chunk 只重解析 `text.slice(tailStart)`（冻结边界之后的源尾），已有块 O(1) 次解析（注释：*"each source region is parsed O(1) times over the stream instead of once per chunk"*）。
   - 冻结全部除尾 **`UNSTABLE_TAIL_BLOCKS = 2`** 个顶层块（`incremental.ts:34`；尾 2 块是安全边际：追加只会重塑最后一块的 parse frontier——段落变 setext heading、列表延续、未闭合围栏吞行）。
   - 冻结边界取**上一块 end offset**（不是下一块 start，保住块间空行的 verbatim）。
   - `// 追加检测：text.startsWith(prevText)` O(前街区字符数) 按字节 memcmp，非 append（reset/重流）则 `generation++` 弃全部缓存（`incremental.ts:92-129`）。
   - key = **绝对源 offset**（`base + node.position.start.offset`，`incremental.ts:66-69`），跨冻结边界稳定 → React reconcile 而非 remount。
   - 已知偏差（源码注释自认）：reference-style link / footnote 定义若落在冻结边界的另一侧，流式期间按字面渲染，最终 settled 全解析自愈。
4. **冻结元素缓存**：`ui-primitives/src/markdown/MarkdownText.tsx:59-138` `StreamingRenderer` 类（`useRef` 持有）：
   - `render(text)` 幂等（`lastText` 相等直接返回上次 `ReactNode[]`，注释：*"Idempotent per text value, so React may re-execute the calling render freely"*）。
   - **已冻结块的 React 元素只渲染一次**，缓存进 `frozenElements: ReactNode[]`；每帧只渲染 tail 块 + footnote section。
   - 该 `ReactNode[]` 数组对象跨帧复引用 → React fiber bailout（同引用子树跳过 reconcile），比 `React.memo` 更强（memo 还要比 props，这里连 compare 都免了）。
5. **流式期间高亮/TeX 降级**：`render.tsx:300-330` `renderCode` 在 `streaming=true` 时给 `CodeBlock` 传 `lang=undefined`（纯文本渲染），`lang==='math'` 的 ```math 围栏也只在 settled 渲染 KaTeX——**高亮落在 finalize 的一次性换发**，流式期间 code block 随块内容在 tail 里更新（`CodeBlock.tsx:32` useMemo `[trimmed, lang, loaded]`）。
6. **finalize 换发**：`MarkdownText.tsx:29-51` `renderSettled` —— `streaming=false` 时整篇一次性 `parseGfmWithMath` + 引用收集 + footnote section。这就是"流式显示与最终显示两套意图、一次交换"的桌面端范式。

**结论（预期 1）**：桌面端"增量"落在**解析、渲染、提交三层**，且各层都按块粒度截断。不是"每 token 拼进一个 react-markdown 实例"。

#### A2. 动画事实（预期 2：淡入）

**web profile 的 markdown 正文没有淡入动画**。已对 `ui-conversation` / `ui-primitives` / `ui-tool` / `ui-workspace` / `web` 全部 `.module.css` 做过 @keyframes 清点，与消息内容相关的只有：

| 位置 | 动画 | 说明 |
|---|---|---|
| `ui-workspace/src/client/rows/Rows.module.css:113,124` | `row-in` 150ms（`from { opacity: 0 }`） | 会话树行挂载淡入，注释注明"Stable row keys keep already-visible rows from replaying it"——**这就是 cc GUI 里"新行一点点出现"的唯一行级淡入**，用在会话列表，不是消息正文 |
| `ui-workspace/.../WorkspaceBrowser.module.css:325-330` | `wide-in` 200ms opacity | 工作区栏展开淡入 |
| `ui-conversation/.../ChatView.module.css:103` | shimmer | 状态行，非内容 |
| `ui-conversation/.../MessageItem.module.css:253` | shimmer | retry 按钮状态 |
| `ToolRow / ReasoningRow / GenericCommandCard` | 2.6s sweep 光扫 | 工具行"进行中"装饰，非内容进入 |
| `AssistantMarkdown.module.css` / `MarkdownText.module.css` | **无任何 animation** | 消息正文流式零动画 |

即：Claude Code 桌面端消息正文的"一点点出现"完全由 **animation-frame 发布节律** 撑起（每帧追加肉眼平滑），新 tool/think 行靠 `row-in` 类淡入。用户在 CC 桌面端看到的"淡入感"更可能来自工具行的 row-in 这类入场动画，而非 markdown 正文逐行 opacity。

```css
/* 唯一相关的一手淡入写法（ui-workspace Rows.module.css） */
.sessionRow { animation: row-in 150ms var(--ds-ease-in-out); }
@keyframes row-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .sessionRow { animation: none; } }
```

#### A3. 桌面端使用的基础设施

- mdast 直链渲染：`mdast-util-from-markdown` + `micromark-extension-gfm/math`（`parse.ts`），**替换掉了 react-markdown**（`render.tsx:2` 注释：*"Replaces the react-markdown / remark-rehype pipeline"*）。跑分依据：`tests/fixtures/markdown-dom` 字节钉死。
- 语法高亮 shiki，非 Monaco；流式期间刻意不跑。

### B. Codex 桌面端 / 网页版（chatgpt.com/codex）

**没有公开一手源码，且推断类素材全部查证落空**，如实记录：

1. **结构事实**：Codex 桌面 app 是 Electron 壳 + 内部 web 应用 webview（渲染进程跑 chatgpt 系 web 平台）。证据：`0xcaff/codex-web`（GitHub，273★，"a browser frontend for codex desktop"）把官方桌面包解包后仅通过 patches 改几个点（`patches/webview-style.patch` 只加 `.main-surface { --spacing-token-safe-header-left: 0px; }`，证实内部 UI 用 `main-surface` 类名 + `--spacing-token-*` 设计 token 体系；`webview-prosemirror-inputmode.patch` 证实输入器是 ProseMirror 系）。**内部聊天 UI 在官方 asar 包里，关闭源码，不从属于 openai/codex repo**。
2. **幽灵库排除（按纪律验证过）**：
   - `@openai/codex-web` npm 包 → registry 返回 **404，不存在**。
   - Anon-kode（ripgrim/anon-kode 等）→ 全库是 Ink/React **TUI**，无 web UI（tree 全量核对 src/components 无消息动画）。
   - GitHub 搜 `codex-web-ui clone` / `codex asar unpacked` / `codex webview` → 无可用的 UI dump/镜像仓库。
   - chatgpt.com/codex 与 codex 桌面 asar 在本机网络不可达，无法直接解析生产 bundle。
3. **可观测行为 vs 机制的归因**（诚实边界）：用户在 Codex 桌面/web 看到的"新行一点点淡入"，公开层面能确认的只有两类机制足以复现同款观感：帧级异步 append（同 A1，公开可查的所有 chatgpt 系克隆均如此）+ 新挂载节点的一次性 opacity fade（等效实现见 C 的旁证）。**逐行 span + opacity 动画无法溯源到 Codex 一手源码，不声称。**

### C. 其他桌面/Web 客户端的成熟实践（旁证，均已溯源）

1. **ChatGPT-Next-Web**（进阶 Tauri/Web 客户端）：`app/components/chat.module.scss` —— 消息进入动画只有**整条消息级** `.chat-message:last-child { animation: slide-in ease 0.3s; }`，keyframes 在 `app/styles/animation.scss`：`@keyframes slide-in { from { opacity: 0; transform: translateY(20px); } }`。正文流式仍是整篇 `<ReactMarkdown>` 每 chunk 重跑（`app/components/markdown.tsx`）。即："整条消息淡入"是最普遍的桌面 Web 范本，非逐行。
2. **Streamdown**（上一轮已详述）：词级 `data-sd-animate` + wall-clock stagger + `maxBacklogMs=320`——桌面端唯一成熟的"内容级逐词淡入"库，且与 block 冻结天然配合（冻结块不参与动画时间线）。官方 `styles.css` 的 `sd-fadeIn`/`sd-slideUp` keyframes 可直接借鉴。
3. **web profile 文案内最接近的写法**（A2 表）：`row-in 150ms` + 稳定 key 防重播 + `prefers-reduced-motion` 关闭。

### D. 与 TUI 结论的差异对比

| TUI 手法（上一轮） | 桌面端判词 |
|---|---|
| `commit_complete_source` 只提交到最后一个 `\n`（渲染边界增量） | **保留为尾巴策略的一部分**，但桌面端不需要——frontier-freeze 让"未闭合语态"（段落变表格、围栏吞行）只在尾 2 块内震荡，已提交块永不回流 |
| 每 tick 对完整已提交源跑一遍 `append_markdown`（解析不做增量） | **废弃**。web profile 的 IncrementalMarkdownParser 每 tick 只解析 tail slice |
| `StreamController` 行队列 + `COMMIT_ANIMATION_TICK` 逐行 pacing | 换成 **animation-frame 发布 + CSS 一次性挂载动画**；"行 pacing"的节流职责由 token 发布管道承担，不另外排队 |
| `table_holdback`（header 未确认 delimiter 前按住） | 不需要：整表是单个尾块，delimiter 未确认时表头在尾块里跟着重解析；确认后整表冻结 |
| `OpenCodeFence` 独立流式高亮 | **不采用**。web profile 的取舍是流式期间 fence 纯文本、finalize 一次性上高亮（`renderCode` lang=undefined）——与 vibe-ide 现状（rawPart 纯文本）同哲学；Monaco colorize 只跑一次是更省的选择 |
| 动画缺位（无 opacity，只有行放行） | 桌面端 CSS animation 是廉价层，与增量渲染解耦，可以直接加 |

### E. 本仓库落地方案（markdown.tsx 具体改法）

**目标落差**：现状 `StreamingMarkdown` 每次 flush 把整个 safePart 重新喂 `<ReactMarkdown>`。按 web profile 模式改造 => **fence 切分保留（vibe-ide 独有的双击编辑依赖它），safePart 内再做块切分 + 冻结元素缓存 + 尾块活渲染** + 块级淡入。ReactMarkdown 保留（不换 mdast 直链栈——现有主题桥/双击编辑/15 主题全在 ReactMarkdown components 上，换栈风险过大；增量收益与栈无关，来自缓存层）。

#### E1. 增量渲染（markdown.tsx 内新增，~90 行）

```tsx
// —— 1. safePart 内按顶层块切分（保守：仅 \n\n 分段）
// 表格/列表/引用块跨空行时会被切两半 → 两段独立渲染，流式期间可接受；
// finalize 提交路径 ChatMarkdown 仍是整篇，语义零损失（与 harness 的
// "reference 定义跨边界字面显示"同理：流式偏差靠最终渲染自愈）
function splitBlocks(safePart: string): string[] {
  return safePart.split(/\n{2,}/).filter(s => s !== '')
}

// —— 2. 冻结元素缓存渲染器（照搬 harness StreamingRenderer 核心）
class BlockStreamingRenderer {
  private frozen: { text: string; el: ReactNode }[] = []
  private lastText: string | null = null
  private lastChildren: ReactNode[] = []

  constructor(private readonly codeOverrides: object) {}
  // codeOverrides 必须引用稳定（useStableCodeOverrides 已满足）；
  // 变化时宿主重建 renderer（构造传参 + key 重置）

  /** 幂等：同 text 直接返回上次结果（React 可自由重执行 render） */
  render(text: string, rawPart: string): ReactNode[] {
    const clean = cleanMessageContent(text)
    // safePart + rawPart = clean（fence 切分为连续切片），缓存键用 clean 即可
    if (clean === this.lastText) return this.lastChildren
    this.lastText = clean
    const blocks = splitBlocks(clean)
    const children: ReactNode[] = []
    for (let i = 0; i < blocks.length; i++) {
      const cached = this.frozen[i]
      let el: ReactNode
      if (cached !== undefined && cached.text === blocks[i]) {
        el = cached.el                       // 前缀块文本未变 → 复用缓存元素
      } else {
        el = (
          <div key={i} className="md-block-enter"
               style={{ '--enter-delay': `${i * 24}ms` } as React.CSSProperties}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={this.codeOverrides}>
              {blocks[i]}
            </ReactMarkdown>
          </div>
        )
        if (this.frozen[i] !== undefined || i < this.frozen.length) {
          // 前缀发生变动（非 append，generation 语义）：截断重建前缀
          this.frozen = this.frozen.slice(0, i)
        }
        this.frozen.push({ text: blocks[i], el })
      }
      if (children.length > 0) children.push('\n')
      children.push(el)
    }
    this.frozen = this.frozen.slice(0, blocks.length)  // 多余缓存修剪
    if (rawPart) {
      children.push(<pre key="raw" className="ai-tab__markdown-raw whitespace-pre-wrap text-ide-text">{rawPart}</pre>)
    }
    this.lastChildren = children
    return children
  }
}
```

组件侧改动（`StreamingMarkdown`）：

```tsx
export function StreamingMarkdown({ text, className, workspacePath, onOpenFile }) {
  const codeOverrides = useStableCodeOverrides()          // 已稳定引用
  const rendererRef = useRef<BlockStreamingRenderer | null>(null)
  if (rendererRef.current === null || rendererRef.current.codeOverrides !== codeOverrides) {
    rendererRef.current = new BlockStreamingRenderer(codeOverrides)
  }
  // fence 切分原样保留（现有逻辑），safe/raw 交给 renderer
  const clean = cleanMessageContent(text)
  const { safePart, rawPart } = splitByFence(clean)       // 现逻辑抽函数
  const children = useMemo(() => rendererRef.current.render(safePart, rawPart),
    [safePart, rawPart])
  // 根节点 onClick 委托（findFilePathAtPoint）原样保留——onOpenFile/workspacePath
  // 不进入缓存元素内部 → 无 stale 闭包（与 harness 刻意不在冻结块里烘焙
  // fileMentions 处理器同一理由）
  return <div className={...streaming 类...} onClick={handleClick}>{children}</div>
}
```

要点：
- 冻结块的 `ReactNode` 元素对象跨帧复引用 → React fiber bailout，**`ReactMarkdown` 不执行、DOM 不动、动画不重播**（比上一轮方案 A 的 memo Block 更强：memo 还跑 props 比较）。
- 只有最后一个活块（及其后 rawPart）每次 flush 重解析+重渲染。
- 切分是 O(n) 字符串切，可发达到毫秒以下；真要再榨可以像 harness 只切 tail slice，本期不需要。

#### E2. 块级淡入（"新内容一点点出现"，CSS 层）

只作用于 busy 区 `StreamingMarkdown`（提交路径 ChatMarkdown 不动，保持无动画约束）。原理：块元素首次挂载播一次动画；**已有块因元素引用稳定不重播**（同 harness `row-in` 注释："stable row keys keep already-visible rows from replaying it"）。

```css
/* globals.css 或 snippets */
@keyframes md-block-fade-in-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.md-block-enter {
  animation: md-block-fade-in-up 160ms var(--ds-ease-out, ease-out) both;
  animation-delay: var(--enter-delay, 0ms);  /* 块间 24ms stagger，取自主索引 */
}
@media (prefers-reduced-motion: reduce) {
  .md-block-enter { animation: none; }
}
```

要不要"逐行"？——**不建议对 markdown 正文逐行包装 span**：行会回流（表格 delimiter、段落换行、列表延续），且 web profile 与 NextWeb 的实测均为"块/消息级出现"。若要在代码块内部做逐行淡入，仅限 `done` 后的代码块（行已稳定），挂在你现有的 CodeBlock `<pre>` 上对行做 stagger（可选二期）。

#### E3. 落地检查单（对照既有约束）

| 项目 | 处置 |
|---|---|
| `useStableCodeOverrides` | 已稳定；renderer 以构造参数持有并做 identity 检查重建 |
| `onOpenFile`/`workspacePath` | 只在根 div onClick 委托，不进缓存元素——无 stale |
| ThinkingBlock / 提交路径 / history | 不触碰（动画只加在 StreamingMarkdown 内部） |
| 双击编辑 / 主题桥 / Monaco colorize | ReactMarkdown components 原样传 `codeOverrides`，`CodeBlock` 由 `useTheme` context 取主题，缓存元素安全 |
| 中断（Cancel） | 尾块就地冻结，无动画补发（CSS 动画不重播） |
| 与 200ms throttle 叠加 | aiStore 不改；元素缓存再砍掉每帧 ReactMarkdown 的执行成本 |

引用来源（一手）：
- vendored web profile（本仓库）：`vendor/harness/packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`（publication animation-frame）、`vendor/harness/packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx`、`vendor/harness/packages/client/ui-primitives/src/markdown/incremental.ts`、`MarkdownText.tsx`（StreamingRenderer）、`parse.ts`（mdast 直链）、`render.tsx`（renderCode streaming 降级）、`CodeBlock.tsx`（shiki 高亮）、`ui-workspace/src/client/rows/Rows.module.css`（row-in 150ms）
- Codex 桌面结构证据：`0xcaff/codex-web`（GitHub）`ARCHITECTURE.md`、`patches/webview-style.patch`、`patches/webview-prosemirror-inputmode.patch`
- 幽灵库排除：`registry.npmjs.org/@openai/codex-web` → 404；ripgrim/anon-kode（GitHub tree 全量核对）为 Ink TUI
- 旁证：ChatGPT-Next-Web `app/components/chat.module.scss` + `app/styles/animation.scss`（`.chat-message:last-child` slide-in 0.3s）
- Streamdown：`packages/streamdown/styles.css`（sd-fadeIn/sd-slideUp，上一轮已列）