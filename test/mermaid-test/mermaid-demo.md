# Mermaid 渲染测试

## 流程图

```mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[记录结果]
    D --> E
    E --> F[结束]
```

## 时序图

```mermaid
sequenceDiagram
    participant 用户
    participant 终端
    participant 主进程
    participant CodeGraph
    用户->>终端: 输入命令
    终端->>主进程: IPC 调用
    主进程->>CodeGraph: searchNodes
    CodeGraph-->>主进程: 返回结果
    主进程-->>终端: 渲染展示
    终端-->>用户: 显示输出
```

## 类图

```mermaid
classDiagram
    class Session {
        +string id
        +string cwd
        +string name
        +create()
        +destroy()
    }
    class TerminalView {
        +render()
        +focus()
        +resize()
    }
    class GitTab {
        +loadStatus()
        +commit()
        +stageFile()
    }
    Session <--> TerminalView : owns
    Session <--> GitTab : owns
```

## 状态图

```mermaid
stateDiagram-v2
    [*] --> 未初始化
    未初始化 --> 初始化中 : CODE_INIT
    初始化中 --> 已就绪 : 成功
    初始化中 --> 失败 : 错误
    失败 --> 未初始化 : 重试
    已就绪 --> 同步中 : 文件变更
    同步中 --> 已就绪 : 同步完成
    已就绪 --> [*] : 关闭
```

## Gantt 图

```mermaid
gantt
    title 项目开发周期
    section 设计
        需求分析       :a1, 2024-01-01, 10d
        系统设计       :after a1, 5d
    section 开发
        前端开发       :dev1, 2024-01-16, 15d
        后端开发       :dev2, 2024-01-16, 15d
    section 测试
        集成测试       :after dev1, 5d
```

## 无效语法（错误兜底）

```mermaid
this is not valid mermaid syntax at all
```

## 普通 Markdown 特性（确保不受影响）

- 列表项 1
- 列表项 2

**粗体** 和 *斜体* 文本。

```typescript
const x: number = 42
console.log(x)
```

| 列A | 列B |
|------|------|
| 数据1 | 数据2 |
