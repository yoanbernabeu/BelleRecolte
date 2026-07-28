/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Toute la campagne découle d'une seule graine : deux joueurs qui saisissent
 * le même code affrontent exactement la même année.
 */
export type Rng = () => number

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash FNV-1a : transforme un code lisible en graine numérique. */
export function hashSeed(code: string): number {
  let h = 0x811c9dc5
  const normalized = code.trim().toUpperCase()
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const SEED_WORDS = [
  'MOISSON', 'SILLON', 'JACHERE', 'AURORE', 'GERBE', 'EPEAUTRE', 'ARPENT',
  'FROMENT', 'CHAUME', 'GUERET', 'ORAGE', 'ROSEE', 'SOLSTICE', 'GRENIER',
  'ALOUETTE', 'COQUELICOT', 'LABOUR', 'BATTAGE', 'PRAIRIE', 'VERGER',
] as const

/** Produit un code de campagne lisible et partageable, ex. « MOISSON-4821 ». */
export function generateSeedCode(): string {
  const index = Math.floor(Math.random() * SEED_WORDS.length)
  const word = SEED_WORDS[index] ?? 'MOISSON'
  const digits = Math.floor(1000 + Math.random() * 9000)
  return `${word}-${digits}`
}

/** Tirage gaussien approché (somme de trois uniformes), moyenne 0, écart-type ~1. */
export function gaussian(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 2
}

/** Choisit un élément d'une liste pondérée. */
export function weightedPick<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rng() * total
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll <= 0) return value
  }
  const last = entries[entries.length - 1]
  if (!last) throw new Error('weightedPick : liste vide')
  return last[0]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
