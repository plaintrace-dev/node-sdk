/** Line diff (LCS) printed as unified-style hunks with `context` lines around each change. */
export function diff(before: string, after: string, context = 2): string {
  const a = before.split('\n')
  const b = after.split('\n')
  // Lines shared at the start and the end need no table: only the middle is compared.
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  const am = a.slice(p, a.length - q)
  const bm = b.slice(p, b.length - q)
  const same = (lines: string[]) => lines.map((s) => ({ t: ' ' as const, s }))
  const ops: { t: ' ' | '-' | '+'; s: string }[] = [...same(a.slice(0, p)), ...middle(am, bm), ...same(a.slice(a.length - q))]
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.t !== ' '))
  const out: string[] = []
  ops.forEach((o, k) => {
    if (!keep[k]) return
    if (k > 0 && !keep[k - 1] && out.length) out.push('…')
    out.push(o.t + o.s)
  })
  return out.join('\n')
}

/* LCS over the changed middle. An insertion (our case) leaves an empty side and costs nothing;
   a middle too large for an n·m table is shown as removed then added. */
function middle(a: string[], b: string[]): { t: ' ' | '-' | '+'; s: string }[] {
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return [...a.map((s) => ({ t: '-' as const, s })), ...b.map((s) => ({ t: '+' as const, s }))]
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
  const ops: { t: ' ' | '-' | '+'; s: string }[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: ' ', s: a[i++]! }), j++
    else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) ops.push({ t: '+', s: b[j++]! })
    else ops.push({ t: '-', s: a[i++]! })
  }
  return ops
}
