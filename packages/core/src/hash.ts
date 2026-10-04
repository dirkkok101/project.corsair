// Numbers are rounded before hashing so tiny float differences between JS engines
// don't count as divergence (PRD section 16, determinism contract).
const PRECISION = 1e6;

function stable(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * PRECISION) / PRECISION);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit over a key-sorted, rounded serialisation of the state. */
export function hashState(state: unknown): string {
  const text = stable(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
