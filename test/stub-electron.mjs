// 让 main 进程模块能在纯 node 下加载（探针用）：只 stub 被 import 的符号
export class BrowserWindow {}
export const ipcMain = { handle: () => {} }
export const app = { getPath: () => '' }
export default { BrowserWindow, ipcMain, app }
