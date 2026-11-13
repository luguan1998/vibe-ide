import { EventEmitter } from 'events'
import type { Duplex } from 'stream'

interface Pending {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

export class RelayClient extends EventEmitter {
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closed = false

  constructor(private readonly stream: Duplex) {
    super()
    stream.on('data', (chunk: Buffer) => this.onData(chunk))
    stream.on('close', () => this.failAll(new Error('relay closed')))
    stream.on('error', (err: Error) => this.failAll(err))
  }

  request<T = any>(method: string, params?: any): Promise<T> {
    if (this.closed) return Promise.reject(new Error('relay closed'))
    const id = this.nextId++
    this.stream.write(JSON.stringify({ id, method, params }) + '\n')
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    let index: number
    while ((index = this.buffer.indexOf(10)) >= 0) {
      const line = this.buffer.subarray(0, index).toString('utf8')
      this.buffer = this.buffer.subarray(index + 1)
      if (!line.trim()) continue
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        if (message.error) {
          const err = new Error(message.error.message ?? String(message.error)) as Error & { code?: string }
          if (message.error.code) err.code = message.error.code
          pending.reject(err)
        } else pending.resolve(message.result)
      } else if (typeof message.method === 'string') {
        this.emit('event', message.method, message.params)
      }
    }
  }

  private failAll(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  close(): void {
    this.failAll(new Error('relay closed'))
    try {
      this.stream.end()
    } catch {}
  }
}
