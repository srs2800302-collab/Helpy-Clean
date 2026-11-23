export const codecVersion = 1;
export class CodecError extends Error { constructor() { super('Invalid persistence representation'); } }
export function decimal(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) throw new CodecError();
  return BigInt(value);
}
type Node = readonly unknown[];
function encode(value: unknown): Node {
  if (value === null) return ['null'];
  if (value === undefined) return ['absent'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', Object.is(value, -0) ? '-0' : value];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  if (typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    return ['object', Object.entries(value).map(([key, child]) => [key, encode(child)])];
  }
  throw new CodecError();
}
function decode(value: unknown): unknown {
  if (!Array.isArray(value)) throw new CodecError();
  const [tag, child] = value;
  if (value.length === 1 && tag === 'null') return null;
  if (value.length === 1 && tag === 'absent') return undefined;
  if (value.length !== 2) throw new CodecError();
  if (tag === 'string' && typeof child === 'string' || tag === 'boolean' && typeof child === 'boolean') return child;
  if (tag === 'number' && (child === '-0' || typeof child === 'number' && Number.isFinite(child))) return child === '-0' ? -0 : child;
  if (tag === 'bigint') return decimal(child);
  if (tag === 'array' && Array.isArray(child)) return child.map(decode);
  if (tag === 'object' && Array.isArray(child)) {
    const result: Record<string, unknown> = {};
    for (const pair of child) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(result, pair[0])) throw new CodecError();
      Object.defineProperty(result, pair[0], { value: decode(pair[1]), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  throw new CodecError();
}
export function pack(value: unknown): string { return JSON.stringify({ version: codecVersion, value: encode(value) }); }
export function unpack<T>(text: unknown): T {
  if (typeof text !== 'string') throw new CodecError();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new CodecError(); }
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== codecVersion ||
    !('value' in parsed) || Object.keys(parsed).length !== 2) throw new CodecError();
  return decode(parsed.value) as T;
}
