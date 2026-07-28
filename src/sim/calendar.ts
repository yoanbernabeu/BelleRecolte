/**
 * Calendrier de campagne.
 *
 * Une campagne agricole ne se confond pas avec l'année civile : elle va d'une
 * récolte à la suivante. Ici elle démarre à la seconde quinzaine d'août de
 * l'année N — juste après la moisson précédente, au moment de préparer les sols
 * et de semer le colza — et s'achève à la première quinzaine de novembre de
 * l'année N+1, quand les dernières betteraves et le dernier maïs sont rentrés.
 *
 * La granularité suit l'intensité agronomique : quinzaine pendant les périodes
 * de travail, mois entier au cœur de l'hiver où la végétation est à l'arrêt.
 */

export type Season = 'été' | 'automne' | 'hiver' | 'printemps'

/** 0 = janvier … 11 = décembre. */
export type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

/** Quelle quinzaine du mois : 1, 2, ou 0 pour un tour couvrant le mois entier. */
export type Half = 0 | 1 | 2

export interface Period {
  /** Index du tour dans la campagne, 0-based. */
  readonly index: number
  readonly month: MonthIndex
  /** 0 = année de semis (N), 1 = année de récolte (N+1). */
  readonly year: 0 | 1
  readonly half: Half
  /** Durée du tour en jours — sert au cumul des degrés-jours et de l'ETP. */
  readonly days: number
  /** Ex. « 2ᵉ quinzaine d'octobre ». */
  readonly label: string
  /** Ex. « oct. II ». */
  readonly shortLabel: string
  readonly season: Season
}

const MONTH_NAMES: readonly string[] = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

const MONTH_ABBR: readonly string[] = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Mois dont le nom commence par une voyelle et impose l'élision « d' ». */
function elision(month: MonthIndex): string {
  return /^[aeiouâéèêîô]/i.test(MONTH_NAMES[month] ?? '') ? "d'" : 'de '
}

function seasonOf(month: MonthIndex): Season {
  if (month === 11 || month <= 1) return 'hiver'
  if (month <= 4) return 'printemps'
  if (month <= 7) return 'été'
  return 'automne'
}

type ScheduleEntry = readonly [month: MonthIndex, year: 0 | 1, halves: readonly Half[]]

/**
 * Le déroulé de la campagne. Décembre, janvier et février tiennent en un seul
 * tour chacun : la culture est en dormance, il n'y a presque rien à décider.
 */
const SCHEDULE: readonly ScheduleEntry[] = [
  [7, 0, [2]],        // août N — préparation des sols, semis colza imminent
  [8, 0, [1, 2]],     // septembre N — semis colza
  [9, 0, [1, 2]],     // octobre N — semis blé et orge d'hiver
  [10, 0, [1, 2]],    // novembre N — fins de semis, levée
  [11, 0, [0]],       // décembre N — dormance
  [0, 1, [0]],        // janvier N+1 — dormance, risque de gel
  [1, 1, [0]],        // février N+1 — reprise, premiers semis de printemps
  [2, 1, [1, 2]],     // mars N+1 — tallage, semis de printemps
  [3, 1, [1, 2]],     // avril N+1 — montaison, gel d'épi
  [4, 1, [1, 2]],     // mai N+1 — épiaison, floraison, semis maïs
  [5, 1, [1, 2]],     // juin N+1 — remplissage, échaudage
  [6, 1, [1, 2]],     // juillet N+1 — moisson des céréales et du colza
  [7, 1, [1, 2]],     // août N+1 — fin de moisson
  [8, 1, [1, 2]],     // septembre N+1 — tournesol
  [9, 1, [1, 2]],     // octobre N+1 — maïs grain, betterave
  [10, 1, [1]],       // novembre N+1 — dernières betteraves
]

function buildPeriods(): readonly Period[] {
  const periods: Period[] = []
  for (const [month, year, halves] of SCHEDULE) {
    for (const half of halves) {
      const monthDays = DAYS_IN_MONTH[month] ?? 30
      const days = half === 0 ? monthDays : half === 1 ? 15 : monthDays - 15
      const name = MONTH_NAMES[month] ?? ''
      const label =
        half === 0
          ? `mois ${elision(month)}${name}`
          : `${half === 1 ? '1re' : '2ᵉ'} quinzaine ${elision(month)}${name}`
      const abbr = MONTH_ABBR[month] ?? ''
      periods.push({
        index: periods.length,
        month,
        year,
        half,
        days,
        label,
        shortLabel: half === 0 ? abbr : `${abbr} ${half === 1 ? 'I' : 'II'}`,
        season: seasonOf(month),
      })
    }
  }
  return periods
}

export const PERIODS: readonly Period[] = buildPeriods()

export const TURNS_PER_CAMPAIGN = PERIODS.length

export function periodAt(turn: number): Period {
  const period = PERIODS[Math.min(Math.max(turn, 0), PERIODS.length - 1)]
  if (!period) throw new Error(`Aucune période pour le tour ${turn}`)
  return period
}

export function labelOfTurn(turn: number): string {
  return periodAt(turn).label
}

export function shortLabelOfTurn(turn: number): string {
  return periodAt(turn).shortLabel
}

export function seasonOfTurn(turn: number): Season {
  return periodAt(turn).season
}

/** Progression 0→1 dans la campagne, utile pour les dégradés visuels. */
export function campaignProgress(turn: number): number {
  return Math.min(1, Math.max(0, turn / (TURNS_PER_CAMPAIGN - 1)))
}

/**
 * Position dans l'année sous forme d'angle 0→1 (0 = 1er janvier).
 * Sert à piloter la course du soleil et la couleur du ciel.
 */
export function yearPhase(turn: number): number {
  const period = periodAt(turn)
  const dayOfMonth = period.half === 2 ? 22 : period.half === 1 ? 8 : 15
  let dayOfYear = dayOfMonth
  for (let m = 0; m < period.month; m++) dayOfYear += DAYS_IN_MONTH[m] ?? 30
  return dayOfYear / 365
}

/** Le premier tour où la culture peut être semée après le tour donné. */
export function findTurnOf(month: MonthIndex, year: 0 | 1, half: Half): number {
  const found = PERIODS.find((p) => p.month === month && p.year === year && p.half === half)
  return found ? found.index : -1
}
