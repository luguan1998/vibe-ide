import { app } from 'electron'
import { createWorker, Worker } from 'tesseract.js'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'

let worker: Worker | null = null
let initPromise: Promise<Worker> | null = null

function getNodeModulesRoot(): string {
  const p = app.getAppPath()
  return p.endsWith('.asar') ? p + '.unpacked' : p
}
const langPath = join(getNodeModulesRoot(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0')

async function getWorker(): Promise<Worker> {
  if (worker) return worker
  if (initPromise) return initPromise

  initPromise = createWorker('eng', 1, {
    langPath,
    cacheMethod: 'none',
    gzip: true,
  })

  worker = await initPromise
  initPromise = null
  return worker
}

export async function recognizeImage(input: string | Uint8Array): Promise<string> {
  const w = await getWorker()

  const doRecognize = async (src: string) => {
    return ((await w.recognize(src)).data?.text || '').trim()
  }

  if (typeof input === 'string') return doRecognize(input)

  const tmpPath = join(app.getPath('temp'), `vibe-ocr-${Date.now()}.png`)
  await writeFile(tmpPath, input)
  try { return await doRecognize(tmpPath) } finally { unlink(tmpPath).catch(() => {}) }
}

export async function terminateOcrWorker(): Promise<void> {
  if (worker) {
    await worker.terminate()
    worker = null
    initPromise = null
  }
}
