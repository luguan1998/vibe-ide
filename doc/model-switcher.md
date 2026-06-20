# ModelSwitcher 方案

## 需求

- AI Tab 输入栏显示当前模型，灰色圆形胶囊徽章
- 点击弹出下拉菜单，显示 opus / sonnet / haiku 三个选项
- 选中后通过 CLI control_request 协议切换模型

## 架构

```
┌─────────────────────────────────────────────────────────┐
│ AiTab.tsx                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 输入工具栏                                         │   │
│  │  ┌──────────────┐  ┌──────────┐  ┌────────────┐  │   │
│  │  │ ContextBar   │  │ModelBadge│  │ ModeSelector│  │   │
│  │  │ (context%)   │  │ (胶囊)    │  │ (Plan/Edit) │  │   │
│  │  └──────────────┘  └──────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│         │ window.api.ai.setModel(sid, alias)            │
│         ▼ IPC invoke                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ preload/index.ts (contextBridge)                 │   │
│  │  ai.setModel = ipcRenderer.invoke('ai:setModel') │   │
│  └──────────────┬──────────────────────────────────┘   │
│                 ▼ IPC handle                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ main/ai.ts                                      │   │
│  │  ai:setModel handler → stdin 写 NDJSON:          │   │
│  │  {"type":"control_request",                     │   │
│  │   "request":{"subtype":"set_model","model":"x"}} │   │
│  └──────────────┬──────────────────────────────────┘   │
│                 ▼ process.stdin                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Claude CLI 子进程                                │   │
│  │  → 切换模型                                     │   │
│  │  → stdout emit 新 system/init (model更新)        │   │
│  └─────────────────────────────────────────────────┘   │
│         │ AI_READY IPC (push)                           │
│         ▼                                               │
│  state.model 自动更新 ← onReady handler                 │
└─────────────────────────────────────────────────────────┘
```

## 变更清单

| 文件 | 变更 |
|------|------|
| `src/shared/types.ts` | +`AI_SET_MODEL` channel 常量, +`AiSetModelPayload` |
| `src/main/ai.ts` | +`ai:setModel` IPC handler（写 control_request NDJSON） |
| `src/preload/index.ts` | +`window.api.ai.setModel(sessionId, model)` |
| `src/renderer/src/components/AiTab.tsx` | +`ModelBadge` 组件 |

## 组件设计：ModelBadge

```
┌────────────┐
│ opus   ▼  │  ← 灰色圆形胶囊，hover变亮
└─────┬──────┘
      │ click
┌─────┴──────┐
│ ✓ opus     │  ← 当前模型打勾
│   sonnet   │
│   haiku    │
└────────────┘
```

- UI 照抄 `ModeSelector`（`:922-988`）的 dropdown 结构
- 别名映射由 CLI 内部通过 `ANTHROPIC_DEFAULT_*_MODEL` 环境变量解析
- 选中后乐观更新 UI，CLI 回包后再覆盖

## 数据流

```
用户点击 "haiku"
  → ModelBadge.onChange('haiku')
  → window.api.ai.setModel(sid, 'haiku')
  → main 写 stdin: control_request {subtype:"set_model", model:"haiku"}
  → CLI 回 control_response + 新 system/init(model="deepseek-v4-flash[1m]")
  → onReady handler → updateSession → state.model 更新 → UI 刷新
```

## 不用实现的部分

- 不新增 IPC 去"拉"模型列表（CLI 无此 API）
- 不读取 settings.json（模型解析完全委托 CLI 内部的 alias 系统）
- 不在 App.tsx 提升模型状态（模型是 per-session 的，已在 sessionStates 内）
