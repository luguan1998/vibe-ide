# 内部通讯软件 AI 集成设计方案

> 约束：通讯软件仅支持 text / picture 两种消息格式，不支持流式渲染

---

## 一、消息模型

```typescript
// 通讯软件原始 CLI 接口
interface LinkSendText {
  type: 'send'
  user: string
  content: string       // 纯文本（不支持 Markdown 富文本）
}

interface LinkSendPicture {
  type: 'send'
  user: string
  picture: string       // 图片文件路径（本地路径或 URL）
}

// link get --number <N> 返回值
interface LinkMessage {
  id: string
  type: 'text' | 'picture'
  user: string
  content?: string       // text 消息内容
  pictureUrl?: string    // picture 消息的图片 URL/路径
  timestamp: number
}
```

**核心结论：没有 Markdown 渲染能力，没有流式分段推送。**

---

## 二、两种可选方案

### 方案 A：纯文本模式（易实现，丢失格式）

```
用户提问
  → Claude 完整回复（等待所有 token → 得到完整 assistant message）
  → 剥除 Markdown 标记 → 纯文本
  → link send --user xxx --content "纯文本"
```

### 方案 B：截图模式（推荐，保留格式）

```
用户提问
  → Claude 完整回复（等待所有 token）
  → 把 Markdown 渲染为 HTML 页面
  → 无头浏览器截屏 → 输出 PNG
  → link send --user xxx --picture /tmp/response.png
```

---

## 三、方案 B 详细设计（截图模式）

### 3.1 整体流程

```
┌─────────────────────────────────────────────────────────────┐
│                      Bot 主循环                              │
│                                                             │
│  while (true) {                                             │
│    messages = link get --number 5                           │
│    for (msg of messages) {                                  │
│      if (isNew(msg)) {                                      │
│        switch (msg.type) {                                  │
│          case 'text':                                       │
│            result = await askClaude(msg.content)            │
│            image = await renderToImage(result.markdown)     │
│            link send --user msg.user --picture image        │
│            break                                            │
│          case 'picture':                                    │
│            ocrText = await ocr(msg.pictureUrl)              │
│            result = await askClaude(ocrText)                │
│            image = await renderToImage(result.markdown)     │
│            link send --user msg.user --picture image        │
│            break                                            │
│        }                                                    │
│      }                                                      │
│    }                                                        │
│    sleep(1000)                                              │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 消息轮询

```typescript
const POLL_INTERVAL = 1000  // 1s 轮询一次
const seenIds = new Set<string>()

async function pollMessages() {
  while (true) {
    const raw = await exec(`link get --number 5`)
    const messages: LinkMessage[] = parse(raw)
    for (const msg of messages) {
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id)
        handleNewMessage(msg)
      }
    }
    await sleep(POLL_INTERVAL)
  }
}
```

### 3.3 AI 处理（与 Vibe IDE 相同）

使用 Vibe IDE `main/ai.ts` 的完整子进程管理逻辑：

```typescript
class ClaudeSession {
  private process: ChildProcess
  private lineBuffer = ''
  private ready = false

  async create(cwd: string) {
    // 与 Vibe IDE 相同的 spawn 逻辑
    const result = spawnClaude({ cwd, permissionMode: 'bypassPermissions' })
    this.process = result
    this.attachHandlers()
  }

  async send(message: string): Promise<AiMessage> {
    return new Promise((resolve, reject) => {
      const ndjson = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message },
      }) + '\n'
      this.process.stdin!.write(ndjson)

      // 监听完整 assistant message + result
      const onMessage = (msg: AiMessage) => {
        if (msg.type === 'result') {
          // result 消息包含了最终元素
          this.process.stdout?.removeListener('data', onData)
          // 找到该轮最后一个 assistant message
          resolve(lastAssistantMessage)
        }
      }
      this.process.on('ai:message', onMessage)
    })
  }
}
```

关键点：
- `permissionMode` 设为 `bypassPermissions`（无需用户确认权限，全自动）
- 等待 `result` 消息出现时返回该轮最终 `assistant` 消息
- 流式 token 全部丢弃或仅作日志

### 3.4 Markdown → 图片渲染

```typescript
async function renderToImage(markdown: string): Promise<string> {
  const html = buildHtml(markdown)

  // 方式 1：使用 Puppeteer 无头浏览器（推荐，跨平台）
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 720, height: 800 })
  await page.setContent(html)

  // 等所有资源加载完毕
  await page.waitForNetworkIdle()
  // 自动适配高度（内容多高就截多高）
  const body = await page.$('body')
  const box = await body!.boundingBox()
  await page.setViewport({ width: 720, height: Math.ceil(box!.height) + 40 })

  const outputPath = join(os.tmpdir(), `ai-response-${Date.now()}.png`)
  await page.screenshot({ path: outputPath, fullPage: true })
  await browser.close()
  return outputPath
}

function buildHtml(markdown: string): string {
  // 使用 marked.js 将 Markdown 转换为 HTML
  const htmlContent = marked.parse(markdown, {
    gfm: true,
    highlight: (code, lang) => {
      // 使用 highlight.js 语法高亮
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return code
    }
  })

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    /* AI 回复风格 */
    body {
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.7;
      color: #1a1a2e;
      padding: 24px 28px;
      margin: 0;
      background: #ffffff;
    }
    pre {
      background: #f4f4f5;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      font-size: 13px;
    }
    code {
      font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
    }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; }
    th { background: #f4f4f5; }
    img { max-width: 100%; border-radius: 4px; }
    blockquote {
      border-left: 4px solid #6366f1;
      margin-left: 0;
      padding-left: 16px;
      color: #555;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`
}
```

### 3.5 图片消息处理

```typescript
async function handlePictureMessage(msg: LinkMessage) {
  // 1. 下载或读取图片文件
  const localPath = await downloadImage(msg.pictureUrl)

  // 策略 A：Claude 多模态（推荐，Claude 3.5+ 原生支持）
  // 把图片转 base64 嵌入 user message 发过去
  const imageBase64 = fs.readFileSync(localPath).toString('base64')
  const content = [
    { type: 'text', text: msg.content || '分析这张图片' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } }
  ]
  const result = await claudeSession.sendImageMessage(content)

  // 策略 B：OCR 后备
  const ocrText = await ocr.recognize(localPath)
  const result = await claudeSession.sendTextMessage(`图片内容：\n${ocrText}\n\n${msg.content || '请分析以上图片内容'}`)

  // 2. 渲染回复为图片
  const image = await renderToImage(result.content)
  await exec(`link send --user ${msg.user} --picture ${image}`)
}
```

### 3.6 完整消息处理循环

```typescript
async function handleNewMessage(msg: LinkMessage) {
  try {
    // 发送"正在输入"占位通知（如支持）
    // 大多数通讯软件不支持 typing indicator 的 CLI 控制

    let result: AiMessage

    switch (msg.type) {
      case 'text':
        result = await claudeSession.send(msg.content)
        break
      case 'picture': {
        const ocrText = await ocr.recognize(msg.pictureUrl)
        result = await claudeSession.send(
          `[用户发送了一张图片，OCR 内容如下]\n${ocrText}\n\n${msg.content || ''}`
        )
        break
      }
    }

    // 等待完整回复 → 渲染为图片 → 发送
    const outputImage = await renderToImage(result.content!)

    // 发送图片
    await exec(`link send --user ${msg.user} --picture ${outputImage}`)

    // 清理临时文件
    fs.unlinkSync(outputImage)

  } catch (err) {
    // 出错了 → 发送纯文本错误提示
    await exec(`link send --user ${msg.user} --content "抱歉，处理请求时出错：${err.message}"`)
  }
}
```

---

## 四、方案对比

| | 方案 A：纯文本 | 方案 B：截图（推荐） |
|---|---|---|
| 实现成本 | 低 | 中（需要 Puppeteer 或 headless browser） |
| Markdown 表格 | ❌ 丢失 | ✅ 完整保留 |
| 代码高亮 | ❌ 丢失 | ✅ 语法着色 |
| 内联图片/链接 | ❌ 丢失 | ✅ 所见即所得 |
| 响应速度 | 快（无截图开销） | 慢 1-2s（渲染 + 截图） |
| 消息可复制性 | ✅ 可选中复制 | ❌ 文字在图片中不可复制 |
| 图片尺寸 | N/A | 可能因长回复需要滚动截图 |
| 通讯软件兼容性 | 完全兼容 text | 需要 picture 接口支持 |

### 4.1 推荐：方案 B + 附赠纯文本

```bash
# 同时发两条消息实现最佳体验：
link send --user xxx --content "[代码回复已收到，请查看图片]"
link send --user xxx --picture /tmp/ai-response.png
# 或长回复时：
link send --user xxx --content "回复内容过长，已截图发送，请查看图片"
link send --user xxx --picture /tmp/ai-response.png
```

---

## 五、Puppeteer 渲染优化

### 5.1 Docker 环境（服务端）

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium
```

### 5.2 无 Docker 环境（直接 Puppeteer）

```bash
npm install puppeteer  # 自带 Chromium
```

### 5.3 渲染缓存

```typescript
const renderCache = new Map<string, string>()  // md hash → image path

async function renderToImage(markdown: string): Promise<string> {
  const hash = crypto.createHash('md5').update(markdown).digest('hex')
  if (renderCache.has(hash)) return renderCache.get(hash)!

  const imagePath = await doRender(markdown)
  renderCache.set(hash, imagePath)

  // 1 小时后过期
  setTimeout(() => renderCache.delete(hash), 3600_000)
  return imagePath
}
```

### 5.4 分页处理（超长回复）

```typescript
async function renderToImages(markdown: string): Promise<string[]> {
  const html = buildHtml(markdown)
  const page = await browser.newPage()
  await page.setContent(html)

  // 切分多页，每页 maxHeight
  const MAX_PAGE_HEIGHT = 4000
  const totalHeight = await page.evaluate(() => document.body.scrollHeight)
  const pages = Math.ceil(totalHeight / MAX_PAGE_HEIGHT)

  const paths: string[] = []
  for (let i = 0; i < pages; i++) {
    await page.evaluate((pageNum) => {
      window.scrollTo(0, pageNum * MAX_PAGE_HEIGHT)
    }, i)
    const path = join(tmpdir(), `ai-response-${Date.now()}-p${i}.png`)
    await page.screenshot({ path, clip: {
      x: 0, y: i * MAX_PAGE_HEIGHT,
      width: 720, height: Math.min(MAX_PAGE_HEIGHT, totalHeight - i * MAX_PAGE_HEIGHT)
    }})
    paths.push(path)
  }
  return paths
}
```

---

## 六、无需 Puppeteer 的备选：HTML→图片服务

如果 Puppeteer 太重，可调用第三方截图 API 将 HTML 转为图片：

```typescript
async function renderViaApi(markdown: string): Promise<string> {
  const html = buildHtml(markdown)
  const response = await fetch('https://api.html2png.com/v1/render', {
    method: 'POST',
    body: JSON.stringify({
      html,
      viewport: { width: 720, height: 800 },
      full_page: true,
      format: 'png',
    })
  })
  const buffer = await response.arrayBuffer()
  const path = join(tmpdir(), `ai-response-${Date.now()}.png`)
  fs.writeFileSync(path, Buffer.from(buffer))
  return path
}
```

或自建截图微服务：

```bash
# Gotenberg（开源，Docker）
docker run -p 3000:3000 gotenberg/gotenberg:8

# 调用
curl -X POST http://localhost:3000/forms/chromium/convert/html \
  -F "files=@response.html" \
  -o response.png
```

---

## 七、完整 Bot 启动脚本

```typescript
import { ClaudeSession } from './claude-session'
import { renderToImage } from './renderer'
import { pollMessages, isNew, markSeen } from './poller'
import { ocr } from './ocr'

async function main() {
  const claude = new ClaudeSession()
  await claude.create(process.cwd())

  console.log('[Bot] Claude 子进程已启动')
  console.log('[Bot] 开始轮询消息...')

  for await (const msg of pollMessages()) {
    console.log(`[Bot] 收到 ${msg.user} 的 ${msg.type} 消息: ${msg.id}`)

    try {
      let reply: string

      if (msg.type === 'text') {
        const result = await claude.send(msg.content!)
        reply = result.content!
      } else {
        // picture
        const text = msg.content || '分析这张图片'
        const imagePath = msg.pictureUrl!
        // 直接传图片给 Claude
        const result = await claude.sendWithImage(text, imagePath)
        reply = result.content!
      }

      // 渲染完整 Markdown 为截图
      const image = await renderToImage(reply)

      // 同时发送文本摘要 + 截图
      const summary = reply.replace(/```[\s\S]*?```/g, '[代码块]').slice(0, 100)
      execSync(`link send --user ${msg.user} --content "🤖 ${summary}…（查看图片获取完整内容）"`)
      execSync(`link send --user ${msg.user} --picture ${image}`)

      fs.unlinkSync(image)
      console.log(`[Bot] 已回复 ${msg.user}`)

    } catch (err) {
      console.error(`[Bot] 回复失败:`, err)
      execSync(`link send --user ${msg.user} --content "❌ 出错了：${err.message}"`)
    }
  }
}

main().catch(console.error)
```

---

## 八、代码结构建议

```
ai-bot/
├── src/
│   ├── index.ts              # 入口：Bot 主循环
│   ├── claude-session.ts     # Claude 子进程管理（复用 Vibe IDE main/ai.ts 逻辑）
│   ├── poller.ts             # link get --number 轮询 + 去重
│   ├── renderer.ts           # Markdown → HTML → 截图
│   ├── ocr.ts                # 图片 OCR
│   ├── sender.ts             # link send --user 封装
│   ├── html-template.ts      # AI 回复 HTML 模板 + CSS
│   └── types.ts              # 类型定义
├── package.json
└── Dockerfile                # 含 Chromium
```

---

## 九、与 Vibe IDE 的复用关系

| 可复用 | 需新增 | 不适用 |
|---|---|---|
| `main/ai.ts` 子进程 spawn + NDJSON 解析 | `renderer.ts` Markdown→图片 | `AiTab.tsx` 渲染端 React 组件 |
| `shared/types.ts` AiMessage 等类型 | `poller.ts` link get 轮询 | streaming token 管线 |
| `MarkdownCodeBlock.tsx` 的 CSS 风格 | `sender.ts` link send 封装 | Monaco 编辑器集成 |
| `cli-to-js` 的二进制发现逻辑 | OCR 集成（如有需要） | 权限交互 UI |

---

## 十、一句话总结

```
通讯软件只有 text/picture → 不走流式，等 Claude 完全回复后再处理

        方案 A：剥 Markdown → 纯文本 → link send text（丢格式，但简单）
        方案 B：Markdown → HTML → 截图 → link send picture（推荐，保留格式）

技术栈：Puppeteer / Gotenberg / html2png API
```
