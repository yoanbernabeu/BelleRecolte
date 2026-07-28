/** Meilleures campagnes, conservées dans le navigateur. */

const STORAGE_KEY = 'belle-recolte.records.v1'
const MAX_RECORDS = 12

export interface Record {
  readonly seed: string
  readonly tonnes: number
  readonly margin: number
  readonly yearName: string
  /** Horodatage ISO, fourni par l'appelant. */
  readonly date: string
}

function read(): Record[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is Record =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record).seed === 'string' &&
        typeof (entry as Record).tonnes === 'number',
    )
  } catch {
    // Mode navigation privée ou stockage saturé : on joue sans historique.
    return []
  }
}

export function loadRecords(): Record[] {
  return read().sort((a, b) => b.margin - a.margin)
}

export function saveRecord(entry: Record): Record[] {
  const all = [...read(), entry].sort((a, b) => b.margin - a.margin).slice(0, MAX_RECORDS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Sans stockage, la partie reste jouable : on ne bloque rien.
  }
  return all
}

/** Meilleur résultat déjà obtenu sur cette graine, s'il existe. */
export function bestForSeed(seed: string): Record | undefined {
  return loadRecords().find((entry) => entry.seed === seed)
}
