// AiTab 宽度体系:消息内容列宽由 .ai-tab 根上的 --ai-content-w 决定(默认 680px;输入区两侧可拖拽缩放);
// 外壳组件(输入区/权限卡/todo/队列条,含 px-2)比内容列宽 32px
export const CONTENT_MAX_W = 'max-w-[var(--ai-content-w,680px)]'
export const PANEL_MAX_W = 'max-w-[calc(var(--ai-content-w,680px)_+_32px)]'
export const CONTENT_W_MIN = 560
export const CONTENT_W_MAX = 1400
export const CONTENT_W_DEFAULT = 680

// 会话流统一纵向节奏：消息内块间距(think 胶囊/正文/工具卡) / 消息之间 / 列表项之间 共用一份,
// 否则 think↔tool 与 tool↔think 用的是两个不同数值,同一列里肉眼可见不等
export const MSG_GAP = 'space-y-2'

