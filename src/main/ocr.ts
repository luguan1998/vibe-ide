import { app } from 'electron'
import { createWorker, Worker } from 'tesseract.js'
import { join } from 'path'
import { writeFile, unlink, mkdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'

let worker: Worker | null = null
let initPromise: Promise<Worker> | null = null

function getNodeModulesRoot(): string {
  const p = app.getAppPath()
  return p.endsWith('.asar') ? p + '.unpacked' : p
}

const tessdataDir = join(app.getPath('temp'), 'vibe-ide-tessdata')

async function ensureTessdataDir(): Promise<string> {
  if (!existsSync(tessdataDir)) {
    await mkdir(tessdataDir, { recursive: true })
  }

  const nodeModules = join(getNodeModulesRoot(), 'node_modules')
  const langFiles = [
    { src: join(nodeModules, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'), dest: join(tessdataDir, 'eng.traineddata.gz') },
    { src: join(nodeModules, '@tesseract.js-data', 'chi_sim', '4.0.0', 'chi_sim.traineddata.gz'), dest: join(tessdataDir, 'chi_sim.traineddata.gz') },
  ]

  for (const { src, dest } of langFiles) {
    if (!existsSync(dest)) {
      await copyFile(src, dest)
    }
  }

  return tessdataDir
}

async function getWorker(): Promise<Worker> {
  if (worker) return worker
  if (initPromise) return initPromise

  const langPath = await ensureTessdataDir()
  initPromise = createWorker('eng+chi_sim', 1, {
    langPath,
    cacheMethod: 'none',
    gzip: true,
  })

  worker = await initPromise
  initPromise = null
  return worker
}

function cleanOcrText(text: string): string {
  return text
    .replace(/([一-龥])\s+([一-龥])/g, '$1$2')
    .replace(/([一-龥])\s+([一-龥])/g, '$1$2')
    .replace(/([一-龥])\s+([一-龥])/g, '$1$2')
    .trim()
}

export async function recognizeImage(input: string | Uint8Array): Promise<string> {
  const w = await getWorker()

  const doRecognize = async (src: string) => {
    const result = (await w.recognize(src)).data?.text || ''
    return cleanOcrText(result)
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
