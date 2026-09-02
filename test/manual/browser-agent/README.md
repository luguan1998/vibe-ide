# 浏览器 AI 操控 · 人工验收手册

## 准备（30 秒）

1. `npm run dev` 完整重启（主进程代码必须新）
2. 新开一个 AI 会话（**不要**恢复历史会话——恢复=开关全关）
3. 空态点「启用浏览器操控」胶囊（变蓝）；header 出现 Globe 徽标；dev 终端有 `browser-use started: pipe=` 日志
4. 内置浏览器不用先开——第 1 步会让 AI 自己 navigate

## 主流程：一条 prompt 测 15 个工具

粘贴给 AI：

```
用内置浏览器工具完成一个验收任务，每步简述用了哪个工具、哪个 ref，出错就停下报告：
1) navigate 打开 file:///D:/test/vibe-ide/test/manual/browser-agent/page1.html
2) snapshot 列出全部可操作控件；并明确回答：iframe 里的输入框和 aria-hidden 背景按钮你能不能看到（预期都看不到）
3) fill_form 批量填：邮箱=agent@test.com、密码=abc123、城市选"上海"、订阅周报=true、性别=女、备注=第一行换行第二行、富文本内容=AI 已填写
4) 点击「自定义控件：点我计数」（role=button 的 div）
5) 点「提交」，然后 wait_for 文本"提交成功"
6) screenshot 看一眼视觉状态
7) extract 右侧边栏（读事件计数文本，报出 email.input 的 ×N）
8) find "城市" 确认该控件 ref
9) 滚到视口外，点击「页尾秘密按钮」
10) eval：return {title: document.title, email: document.getElementById('email').value}
11) navigate 到同目录 page2.html → extract 整页读出预算数字 → browser_back 回 page1 → reload → 最终 snapshot
```

### 人工比对表（看页面右侧两栏 + 正文，不用看对话）

| 步 | 页面应有痕迹 |
|---|---|
| 3 | 7 个控件都有值；右侧事件计数出现 email.input ×1、email.change、pw.input、city.change、sub.change、g2.change、note.input、ce.input |
| 4 | 控件文字变「已点 1 次」 |
| 5 | 提交中… → **提交成功 ✅**（wait_for 未超时） |
| 7 | AI 报出的 ×N 与页面计数一致 |
| 9 | 秘密按钮文字变「已被点到 ✓」+ secret.click 计数（证明 scrollIntoView+点击全链路，含非视口元素） |
| 10 | AI 回报 title=「Browser Agent 验收页」、email 值正确 |
| 11 | 自动回跳到 page1（地址栏同步）、reload 后戳重生成 |
| 全程 | 每页都显示自检面板逐行变绿；**每一步 AI 都自带回显新快照**（它从不需要手动再 snapshot）；首次调用弹 MCP 权限卡；iframe/背景弹窗的"看不到"回答正确 |

自检面板若有 ✗ 行 = 对应真实事件没派发（React 兼容路径出问题的信号）。

## 补测三条（每条一句话）

| prompt | 预期 |
|---|---|
| `用 browser_fill 把 email2@x.com 填进 e999999` | 报错"ref 不存在"并**附带回显一份新快照**，不崩溃 |
| 关闭内置浏览器后 `用 browser_snapshot 看看当前页面` | 友好错误"没有打开内置浏览器"，模型不再重试刷屏 |
| 新会话只开「启用电脑操控」→ 让模型 `列出 mcp 开头的工具` | 仅 vibe-cu 6 个；两开=21 个（含 vibe-browser 15）；worktree 徽标+`git worktree list` 生效；发消息后胶囊消失、header 徽标保留；切走再切回状态不丢 |

## 已知边界（测出来"不行"是对的）

- iframe 内控件不可操作（只操作主框架）
- 文件上传控件不能自动选文件
- 纯 canvas 页面 snapshot 无控件 → 应改用 screenshot+extract
