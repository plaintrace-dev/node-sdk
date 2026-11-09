let lastMs = -1
let counter = 0

/** A UUID v7: 48-bit millisecond time, then a 12-bit counter so ids made in one millisecond still sort. */
export function uuidV7(now = Date.now()): string {
  if (now === lastMs) counter = (counter + 1) & 0xfff
  else {
    lastMs = now
    counter = 0
  }
  const b = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff
  b[6] = 0x70 | ((counter >> 8) & 0x0f)
  b[7] = counter & 0xff
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f)
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
