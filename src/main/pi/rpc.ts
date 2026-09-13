import { parseJsonLine, parseRpcResponse, stringField } from './protocol'

type Pending = {
  resolve: (value: Record<string, any>) => void
  reject: (error: Error) => void
}

// JSONL request/response multiplexer for `pi --mode rpc`. Agent events and
// extension UI frames go to onFrame.
export class PiRpc {
  private nextId = 1
  private readonly pending = new Map<string, Pending>()
  private closed = false

  constructor(
    private readonly label: string,
    private readonly write: (payload: Record<string, any>) => void,
    private readonly onFrame: (rec: Record<string, any>) => void,
  ) {}

  pushLine(line: string): void {
    const rec = parseJsonLine(line)
    if (!rec) return
    const response = parseRpcResponse(rec)
    if (response?.id && this.pending.has(response.id)) {
      const pending = this.pending.get(response.id)
      this.pending.delete(response.id)
      if (!pending) return
      if (!response.success) {
        pending.reject(new Error(response.error || `${this.label} ${response.command} failed`))
        return
      }
      pending.resolve(rec)
      return
    }
    this.onFrame(rec)
  }

  request(command: Record<string, any>, timeoutMs = 15000): Promise<Record<string, any>> {
    if (this.closed) return Promise.reject(new Error(`${this.label} process is not running`))
    const id = stringField(command, 'id') ?? `vibe_${this.nextId++}`
    if (this.pending.has(id)) return Promise.reject(new Error(`Duplicate RPC request id: ${id}`))
    const payload = { ...command, id }
    return new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const type = stringField(command, 'type') ?? 'command'
        reject(new Error(`${this.label} ${type} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      try {
        this.write(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  cancelRequest(id: string): void {
    this.pending.delete(id)
  }

  close(reason = `${this.label} process exited`): void {
    this.closed = true
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(new Error(reason))
    }
  }
}
