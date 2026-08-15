/** Browser implementation of the Cordis timer Service. */
import { Service } from '@deepseek-ai/cordis';
// These `any` positions mirror the Host TimerService's overload erasure: generic callback tuples and async-iterator
// return/rejection values must pass through without narrowing them to one caller's invocation.
/** Browser timer Service with the same public API as the Host Cordis TimerService. */
export class ClientTimerService extends Service {
    /** Register the Service and mix its lifecycle-safe helpers onto Context. */
    constructor(ctx) {
        super(ctx, 'timer');
        ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval']);
    }
    /**
     * Run a callback once through {@link timeout}.
     * @param callback - Work to run after the delay.
     * @param delay - Delay in milliseconds.
     * @returns Disposer that cancels the pending callback early.
     * @deprecated Use `ctx.timeout()` instead.
     */
    setTimeout(callback, delay) {
        return this.timeout(callback, delay);
    }
    /**
     * Run a callback repeatedly through {@link interval}.
     * @param callback - Work to run on each tick.
     * @param delay - Interval in milliseconds.
     * @returns Disposer that stops the interval early.
     * @deprecated Use `ctx.interval()` instead.
     */
    setInterval(callback, delay) {
        return this.interval(callback, delay);
    }
    timeout(...args) {
        const callback = typeof args[0] === 'function' ? args.shift() : undefined;
        const delay = args[0];
        if (callback !== undefined) {
            const dispose = this.ctx.effect(() => {
                const timer = globalThis.setTimeout(() => {
                    void dispose();
                    callback();
                }, delay);
                return () => { globalThis.clearTimeout(timer); };
            }, 'ctx.timeout()');
            return dispose;
        }
        const { promise, resolve, reject } = Promise.withResolvers();
        const dispose = this.ctx.effect(() => {
            const timer = globalThis.setTimeout(resolve, delay);
            return () => {
                globalThis.clearTimeout(timer);
                reject(new Error('Context has been disposed'));
            };
        }, 'ctx.timeout()');
        return promise.finally(() => { void dispose(); });
    }
    interval(...args) {
        const callback = typeof args[0] === 'function' ? args.shift() : undefined;
        const delay = args[0];
        if (callback !== undefined) {
            return this.ctx.effect(() => {
                const timer = globalThis.setInterval(callback, delay);
                return () => { globalThis.clearInterval(timer); };
            }, 'ctx.interval()');
        }
        let done;
        let nextTask;
        const dispose = this.ctx.effect(() => {
            const timer = globalThis.setInterval(() => {
                nextTask?.resolve({ done: false, value: undefined });
            }, delay);
            return () => {
                globalThis.clearInterval(timer);
                if (done !== undefined)
                    return;
                done = { kind: 'throw', reason: new Error('Context has been disposed') };
                nextTask?.reject(done.reason);
            };
        }, 'ctx.interval()');
        return {
            next: () => {
                if (done === undefined)
                    return (nextTask = Promise.withResolvers()).promise;
                if (done.kind === 'return')
                    return Promise.resolve({ done: true, value: done.value });
                return Promise.reject(done.reason);
            },
            return: (value) => {
                if (done === undefined)
                    done = { kind: 'return', value };
                nextTask?.resolve({ done: true, value });
                void dispose();
                return Promise.resolve({ done: true, value });
            },
            throw: (reason) => {
                if (done === undefined)
                    done = { kind: 'throw', reason };
                nextTask?.reject(reason);
                void dispose();
                return Promise.resolve({ done: true, value: undefined });
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    /** Build a delayed wrapper whose pending callback belongs to the calling Fiber. */
    schedule(label, trigger, disposed = false) {
        let timer;
        const dispose = this.ctx.effect(() => () => {
            disposed = true;
            globalThis.clearTimeout(timer);
        }, label);
        const wrapper = (...args) => {
            globalThis.clearTimeout(timer);
            timer = trigger(args, disposed);
        };
        wrapper.dispose = dispose;
        return wrapper;
    }
    /**
     * Return a throttled function whose timer is disposed with the calling Fiber.
     * @param callback - Function to throttle.
     * @param delay - Minimum interval between calls in milliseconds.
     * @param noTrailing - Whether to suppress a delayed trailing call.
     * @returns Throttled function with an early disposer.
     */
    throttle(callback, delay, noTrailing) {
        let lastCall = -Infinity;
        const execute = (...args) => {
            lastCall = Date.now();
            callback(...args);
        };
        return this.schedule('ctx.throttle()', (args, disposed) => {
            const remaining = delay - Date.now() + lastCall;
            if (remaining <= 0) {
                execute(...args);
            }
            else if (!disposed) {
                return globalThis.setTimeout(execute, remaining, ...args);
            }
        }, noTrailing);
    }
    /**
     * Return a debounced function whose timer is disposed with the calling Fiber.
     * @param callback - Function to debounce.
     * @param delay - Quiet period in milliseconds.
     * @returns Debounced function with an early disposer.
     */
    debounce(callback, delay) {
        return this.schedule('ctx.debounce()', (args, disposed) => {
            if (disposed)
                return;
            return globalThis.setTimeout(callback, delay, ...args);
        });
    }
}
/**
 * Install the browser timer Service on one Client composition.
 * @param ctx - Client context that owns the Service and mixed-in helpers.
 * @returns Nothing after registering the Service.
 */
export function provideClientTimer(ctx) {
    new ClientTimerService(ctx);
}
//# sourceMappingURL=timer.js.map