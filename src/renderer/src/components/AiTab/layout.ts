// AiTab 宽度体系:消息内容列宽由 .ai-tab 根上的 --ai-content-w 决定(默认 896px,输入区两侧可拖拽缩放);
// 外壳组件(输入区/权限卡/todo/队列条,含 px-2)比内容列宽 32px
export const CONTENT_MAX_W = 'max-w-[var(--ai-content-w,896px)]'
export const PANEL_MAX_W = 'max-w-[calc(var(--ai-content-w,896px)_+_32px)]'
export const CONTENT_W_MIN = 560
export const CONTENT_W_MAX = 1400
export const CONTENT_W_DEFAULT = 896

