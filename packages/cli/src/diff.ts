/** Line diff (LCS) printed as unified-style hunks with `context` lines around each change. */
export function diff(before: string, after: string, context = 2): string {
  const a = before.split('\n')
  const b = after.split('\n')
  // shortcut: O(n·m) table, fine for layout files; very large files would want Myers.
  const n = a.length
  const m = b.length
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
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.t !== ' '))
  const out: string[] = []
  ops.forEach((o, k) => {
    if (!keep[k]) return
    if (k > 0 && !keep[k - 1] && out.length) out.push('…')
    out.push(o.t + o.s)
  })
  return out.join('\n')
}
