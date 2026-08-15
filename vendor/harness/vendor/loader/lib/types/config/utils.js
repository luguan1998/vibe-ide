import { valueMap } from '@deepseek-ai/cosmokit';
// eslint-disable-next-line no-new-func
/** Evaluate a JavaScript expression against a loader context scope. */
export const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`);
/** Recursively replace YAML `!js` expression nodes with evaluated values. */
export function interpolate(ctx, value) {
    if (isJsExpr(value)) {
        return evaluate(ctx, value.__jsExpr);
    }
    else if (!value || typeof value !== 'object') {
        return value;
    }
    else if (Array.isArray(value)) {
        return value.map(item => interpolate(ctx, item));
    }
    else {
        return valueMap(value, item => interpolate(ctx, item));
    }
}
/** Return true when a value is a serialized loader JavaScript expression. */
export function isJsExpr(value) {
    return value instanceof Object && '__jsExpr' in value;
}
//# sourceMappingURL=utils.js.map