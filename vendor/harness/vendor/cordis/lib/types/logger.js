import { defineProperty, hyphenate } from '@deepseek-ai/cosmokit';
import { createCallable, joinPrototype, symbols } from "./utils.js";
/** Built-in placeholder formatters used by `Logger.format()`. */
export const defaultFormatters = {
    s: (value) => String(value),
    d: (value) => Math.trunc(Number(value)),
    i: (value) => Math.trunc(Number(value)),
    f: (value) => Number(value),
    o: (value) => JSON.stringify(value),
    O: (value) => JSON.stringify(value),
    c: () => '',
    C: (value, exporter, message) => {
        return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
    },
};
function isAggregateError(error) {
    return error instanceof Error && Array.isArray(error['errors']);
}
/** Logger facade for one named subsystem. */
export class Logger {
    service;
    static color(exporter, code, value, decoration = '') {
        if (!exporter.colors)
            return '' + value;
        return `\u001b[3${code < 8 ? code : '8;5;' + code}${exporter.colors >= 2 ? decoration : ''}m${value}\u001b[0m`;
    }
    static code(name, level) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 3) - hash) + name.charCodeAt(i) + 13;
            hash |= 0;
        }
        const colors = !level ? [] : level >= 2 ? c256 : c16;
        return colors[Math.abs(hash) % colors.length];
    }
    static format(exporter, message) {
        const args = message.args.slice();
        if (args[0] instanceof Error) {
            args[0] = args[0].stack || args[0].message;
            args.unshift('%s');
        }
        else if (typeof args[0] !== 'string') {
            args.unshift('%o');
        }
        let format = args.shift();
        format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
            if (match === '%%')
                return '%';
            const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
            if (typeof formatter === 'function') {
                const value = args.shift();
                return formatter(value, exporter, message);
            }
            return match;
        });
        const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
        for (let arg of args) {
            if (typeof arg === 'object' && arg) {
                arg = oFormatter(arg, exporter, message);
            }
            format += ' ' + arg;
        }
        const { maxLength = 10240 } = exporter;
        return format.split(/\r?\n/g).map(line => {
            return line.slice(0, maxLength) + (line.length > maxLength ? '...' : '');
        }).join('\n');
    }
    constructor(options, service) {
        this.service = service;
        Object.assign(this, options);
        this.error = this._method('error', 0 /* LoggerLevel.ERROR */);
        this.info = this._method('info', 1 /* LoggerLevel.INFO */);
        this.warn = this._method('warn', 2 /* LoggerLevel.WARN */);
        this.debug = this._method('debug', 3 /* LoggerLevel.DEBUG */);
    }
    _method(type, level) {
        return (...args) => {
            if (args.length === 1 && args[0] instanceof Error) {
                if (args[0].cause) {
                    this[type](args[0].cause);
                }
                else if (isAggregateError(args[0])) {
                    args[0].errors.forEach(error => this[type](error));
                    return;
                }
            }
            const sn = ++this.service._snMessage;
            const ts = Date.now();
            for (const exporter of this.service.exporters.values()) {
                const targetLevel = exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1 /* LoggerLevel.INFO */;
                if (targetLevel < level)
                    continue;
                const message = { sn, ts, type, level, name: this.name, ...this.meta, args };
                exporter.export(message);
            }
        };
    }
}
/** ANSI 16-color palette indexes used for logger name coloring. */
export const c16 = [6, 2, 3, 4, 5, 1];
/** ANSI 256-color palette indexes used for logger name coloring. */
export const c256 = [
    20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62,
    63, 68, 69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113,
    129, 134, 135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168,
    169, 170, 171, 172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200,
    201, 202, 203, 204, 205, 206, 207, 208, 209, 214, 215, 220, 221,
];
/**
 * Built-in logging service.
 *
 * Call `ctx.logger()` to create a named logger, or call `ctx.logger.info()`
 * directly to log with the current fiber-derived name.
 */
export class LoggerService {
    bufferSize = 1000;
    buffer = [];
    ctx;
    _snMessage = 0;
    _snExporter = 0;
    exporters = new Map();
    constructor(ctx) {
        const tracker = {
            property: 'ctx',
            noShadow: true,
        };
        const self = createCallable('logger', joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
        Object.assign(self, this);
        self.ctx = ctx;
        defineProperty(self, symbols.tracker, tracker);
        self.exporter({
            colors: 3,
            export: (message) => {
                self.buffer.push(message);
                if (self.buffer.length > self.bufferSize) {
                    self.buffer = self.buffer.slice(-self.bufferSize);
                }
            },
        });
        return self;
    }
    /**
     * Register an exporter and dispose it with the current fiber.
     *
     * @param exporter — the sink that receives structured log messages.
     * @returns a disposer that removes the exporter.
     */
    exporter(exporter) {
        return this.ctx.effect(() => {
            this.exporters.set(++this._snExporter, exporter);
            return () => this.exporters.delete(this._snExporter);
        }, 'ctx.logger.exporter()');
    }
    _resolveConfig() {
        let intercept = this.ctx[symbols.intercept];
        const configs = [];
        while ('logger' in intercept) {
            if (Object.hasOwn(intercept, 'logger')) {
                configs.unshift(intercept['logger']);
            }
            intercept = Object.getPrototypeOf(intercept);
        }
        return Object.assign({}, ...configs);
    }
    [symbols.invoke](name) {
        const config = this._resolveConfig();
        const fiber = (this.ctx[symbols.shadow] ?? this.ctx).fiber;
        name ??= config.name;
        name ??= hyphenate(fiber.name);
        return new Logger({
            name,
            level: config.level,
            meta: { fiber: new WeakRef(fiber) },
        }, this);
    }
    static {
        for (const type of ['error', 'info', 'warn', 'debug']) {
            ;
            LoggerService.prototype[type] = function (...args) {
                return this()[type](...args);
            };
        }
    }
}
//# sourceMappingURL=logger.js.map