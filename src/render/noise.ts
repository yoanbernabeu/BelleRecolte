/**
 * Bruit de valeur 2D déterministe, sans dépendance externe.
 * Sert à onduler le terrain et à disperser la végétation.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function valueNoise2D(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)

  const u = smootherstep(xf)
  const v = smootherstep(yf)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Somme d'octaves — donne un relief plus naturel. */
export function fbm2D(x: number, y: number, octaves = 4, seed = 0): number {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  let total = 0
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, y * frequency, seed + i * 37) * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total > 0 ? value / total : 0
}
