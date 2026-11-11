// 让 main 进程模块能在纯 node 下加载（探针用）：只 stub 被 import 的符号
export class BrowserWindow {}
export class MessageChannelMain {}
export const ipcMain = { handle: () => {} }
export const app = { getPath: () => '', isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} }
export const desktopCapturer = { getSources: () => Promise.resolve([]) }
export const clipboard = { writeImage: () => {}, readImage: () => null }
export const screen = { getPrimaryDisplay: () => ({ size: { width: 0, height: 0 }, scaleFactor: 1 }), getAllDisplays: () => [] }
export const nativeImage = { createFromBuffer: () => ({ isEmpty: () => true }) }
export default { BrowserWindow, MessageChannelMain, ipcMain, app, desktopCapturer, clipboard, screen, nativeImage }
