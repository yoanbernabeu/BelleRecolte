/**
 * Générateur météo.
 *
 * Les normales mensuelles proviennent des normales Météo-France 1991-2020
 * (station Paris-Montsouris), corrigées d'environ 1 °C à la baisse pour gommer
 * l'îlot de chaleur urbain et se rapprocher d'une plaine céréalière type.
 *
 * Chaque campagne tire un « caractère d'année » : quatre anomalies saisonnières
 * de température et de pluie, corrélées entre saisons. C'est ce qui produit
 * des bonnes et des mauvaises années sans les scripter à la main.
 */

import { periodAt, seasonOfTurn, TURNS_PER_CAMPAIGN, type Season } from './calendar'
import { clamp, clamp01, gaussian, type Rng } from './rng'

export type WeatherEventId =
  | 'gel'
  | 'gel-severe'
  | 'canicule'
  | 'grele'
  | 'orage'
  | 'pluies-excessives'
  | 'secheresse'
  | 'coup-de-chaleur'

export interface WeatherEvent {
  readonly id: WeatherEventId
  readonly label: string
  /** Intensité 0→1, module l'ampleur des dégâts. */
  readonly intensity: number
}

export interface Weather {
  readonly turn: number
  /** Température moyenne de la période, °C. */
  readonly tempMean: number
  /** Minimale absolue atteinte dans la période — c'est elle qui gèle. */
  readonly tempMin: number
  /** Maximale absolue atteinte — c'est elle qui échaude. */
  readonly tempMax: number
  /** Cumul de précipitations sur la période, mm. */
  readonly rainMm: number
  /** Nombre de jours de pluie — pilote l'humidité foliaire et les maladies. */
  readonly rainDays: number
  /** Ensoleillement, en fraction de la normale (1 = normal). */
  readonly sunshine: number
  /** Rafale maximale, km/h — provoque la verse avec la pluie. */
  readonly windMaxKmh: number
  /** Évapotranspiration de référence cumulée sur la période, mm. */
  readonly et0Mm: number
  readonly events: readonly WeatherEvent[]
}

interface MonthNormal {
  readonly tempMean: number
  readonly tempMinMean: number
  readonly tempMaxMean: number
  readonly rainMm: number
  readonly sunHours: number
}

/** Index 0 = janvier. Températures abaissées de ~1 °C vs Paris-Montsouris. */
const NORMALS: readonly MonthNormal[] = [
  { tempMean: 4.4, tempMinMean: 1.6, tempMaxMean: 6.6, rainMm: 52, sunHours: 59 },
  { tempMean: 5.0, tempMinMean: 1.8, tempMaxMean: 7.9, rainMm: 45, sunHours: 84 },
  { tempMean: 8.2, tempMinMean: 4.0, tempMaxMean: 11.9, rainMm: 48, sunHours: 135 },
  { tempMean: 11.1, tempMinMean: 6.3, tempMaxMean: 15.7, rainMm: 48, sunHours: 177 },
  { tempMean: 14.6, tempMinMean: 9.6, tempMaxMean: 19.4, rainMm: 68, sunHours: 201 },
  { tempMean: 17.8, tempMinMean: 12.7, tempMaxMean: 22.6, rainMm: 55, sunHours: 204 },
  { tempMean: 19.9, tempMinMean: 14.6, tempMaxMean: 24.9, rainMm: 58, sunHours: 222 },
  { tempMean: 19.7, tempMinMean: 14.4, tempMaxMean: 24.8, rainMm: 58, sunHours: 215 },
  { tempMean: 16.1, tempMinMean: 11.4, tempMaxMean: 20.7, rainMm: 50, sunHours: 175 },
  { tempMean: 12.2, tempMinMean: 8.4, tempMaxMean: 15.8, rainMm: 62, sunHours: 119 },
  { tempMean: 7.7, tempMinMean: 4.6, tempMaxMean: 10.4, rainMm: 58, sunHours: 70 },
  { tempMean: 4.9, tempMinMean: 2.2, tempMaxMean: 7.0, rainMm: 62, sunHours: 57 },
]

function normalAt(month: number): MonthNormal {
  const normal = NORMALS[month]
  if (!normal) throw new Error(`Pas de normale pour le mois ${month}`)
  return normal
}

/** Anomalies tirées pour chaque saison de la campagne. */
export interface SeasonAnomaly {
  readonly tempBias: number
  readonly rainFactor: number
}

export interface YearCharacter {
  readonly anomalies: Readonly<Record<Season, SeasonAnomaly>>
  /** Biais global : certaines années sont chaudes de bout en bout. */
  readonly globalTempBias: number
  readonly globalRainFactor: number
  /** Volatilité : amplitude des écarts d'une quinzaine à l'autre. */
  readonly volatility: number
  /** Nom lisible attribué en fin de campagne, ex. « Année sèche et caniculaire ». */
  readonly name: string
  readonly description: string
}

const SEASONS: readonly Season[] = ['automne', 'hiver', 'printemps', 'été']

function describeYear(
  anomalies: Record<Season, SeasonAnomaly>,
  globalTempBias: number,
  globalRainFactor: number,
): { name: string; description: string } {
  const traits: string[] = []

  const springRain = anomalies['printemps'].rainFactor
  const summerRain = anomalies['été'].rainFactor
  const summerTemp = anomalies['été'].tempBias + globalTempBias
  const winterTemp = anomalies['hiver'].tempBias + globalTempBias
  const autumnRain = anomalies['automne'].rainFactor

  if (autumnRain > 1.45) traits.push('automne noyé')
  else if (autumnRain < 0.65) traits.push('automne sec')

  if (winterTemp < -1.6) traits.push('hiver rigoureux')
  else if (winterTemp > 1.6) traits.push('hiver doux')

  if (springRain < 0.65) traits.push('printemps sec')
  else if (springRain > 1.45) traits.push('printemps humide')

  if (summerTemp > 2) traits.push('été caniculaire')
  else if (summerTemp < -1.5) traits.push('été frais')

  if (summerRain < 0.6) traits.push('moisson au sec')
  else if (summerRain > 1.5) traits.push('moisson contrariée')

  const mean = globalRainFactor
  let name: string
  if (traits.length === 0) name = 'Année dans les normales'
  else if (mean < 0.75 && summerTemp > 1.5) name = 'Année de sécheresse'
  else if (mean > 1.35) name = 'Année pourrie'
  else if (traits.length >= 3) name = 'Année contrastée'
  else name = 'Année irrégulière'

  const description =
    traits.length > 0
      ? traits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.'
      : 'Aucun excès marqué : une année de référence.'

  return { name, description }
}

export function rollYearCharacter(rng: Rng): YearCharacter {
  const globalTempBias = gaussian(rng) * 1.1
  const globalRainFactor = Math.exp(gaussian(rng) * 0.22)
  const volatility = clamp(0.75 + gaussian(rng) * 0.3, 0.45, 1.7)

  // Marche aléatoire corrélée : une saison ressemble un peu à la précédente.
  const anomalies = {} as Record<Season, SeasonAnomaly>
  let carryTemp = 0
  let carryRain = 0
  for (const season of SEASONS) {
    carryTemp = carryTemp * 0.45 + gaussian(rng) * 1.5
    carryRain = carryRain * 0.4 + gaussian(rng) * 0.3
    anomalies[season] = {
      tempBias: carryTemp,
      rainFactor: clamp(Math.exp(carryRain) * globalRainFactor, 0.25, 2.6),
    }
  }

  const { name, description } = describeYear(anomalies, globalTempBias, globalRainFactor)
  return { anomalies, globalTempBias, globalRainFactor, volatility, name, description }
}

/**
 * Rayonnement extraterrestre (MJ/m²/jour) à 48°N, pour l'ETP de Hargreaves.
 */
function extraterrestrialRadiation(dayOfYear: number): number {
  const latitude = (48.5 * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365)
  const declination = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39)
  const x = clamp(-Math.tan(latitude) * Math.tan(declination), -1, 1)
  const sunsetAngle = Math.acos(x)
  return (
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (sunsetAngle * Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.sin(sunsetAngle))
  )
}

/** ETP journalière de référence (Hargreaves-Samani), mm/jour. */
function hargreavesEt0(
  tempMean: number,
  tempMaxMean: number,
  tempMinMean: number,
  dayOfYear: number,
): number {
  const ra = extraterrestrialRadiation(dayOfYear) / 2.45
  const range = Math.max(1, tempMaxMean - tempMinMean)
  return Math.max(0, 0.0023 * ra * (tempMean + 17.8) * Math.sqrt(range))
}

function dayOfYearOf(turn: number): number {
  const period = periodAt(turn)
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const base = cumulative[period.month] ?? 0
  const offset = period.half === 2 ? 22 : period.half === 1 ? 8 : 15
  return base + offset
}

export function generateWeather(turn: number, character: YearCharacter, rng: Rng): Weather {
  const period = periodAt(turn)
  const normal = normalAt(period.month)
  const season = seasonOfTurn(turn)
  const anomaly = character.anomalies[season]

  const tempBias = anomaly.tempBias + character.globalTempBias
  const noise = gaussian(rng) * 1.9 * character.volatility
  const tempMean = normal.tempMean + tempBias + noise

  // Amplitude jour/nuit : forte par temps sec et ensoleillé, faible sous la pluie.
  const rainFactor = anomaly.rainFactor
  const rainNoise = Math.exp(gaussian(rng) * 0.55 * character.volatility)
  const dayScale = period.days / 30
  const rainMm = Math.max(0, normal.rainMm * dayScale * rainFactor * rainNoise)

  const wetness = clamp01(rainMm / (normal.rainMm * dayScale + 1))
  const amplitude = (normal.tempMaxMean - normal.tempMinMean) * (1.25 - 0.5 * wetness)
  const tempMaxMean = tempMean + amplitude / 2
  const tempMinMean = tempMean - amplitude / 2

  // Extrêmes de la période : on s'écarte de la moyenne des minima/maxima.
  const extremeSpread = 3.2 + 2.4 * character.volatility
  const tempMin = tempMinMean - Math.abs(gaussian(rng)) * extremeSpread
  const tempMax = tempMaxMean + Math.abs(gaussian(rng)) * extremeSpread

  const rainDays = Math.round(clamp(rainMm / 6, 0, period.days * 0.75))
  const sunshine = clamp(1.25 - wetness * 0.7 + gaussian(rng) * 0.12, 0.25, 1.6)

  const stormProne = rainMm > normal.rainMm * dayScale * 1.3 && tempMean > 13
  const windMaxKmh = clamp(
    30 + Math.abs(gaussian(rng)) * 22 + (stormProne ? 28 : 0) + (season === 'hiver' ? 18 : 0),
    15,
    140,
  )

  const et0PerDay = hargreavesEt0(tempMean, tempMaxMean, tempMinMean, dayOfYearOf(turn))
  const et0Mm = et0PerDay * period.days * clamp(0.75 + sunshine * 0.35, 0.6, 1.35)

  const events = detectEvents({
    turn,
    tempMean,
    tempMin,
    tempMax,
    rainMm,
    normalRain: normal.rainMm * dayScale,
    windMaxKmh,
    rng,
    stormProne,
  })

  return {
    turn,
    tempMean,
    tempMin,
    tempMax,
    rainMm,
    rainDays,
    sunshine,
    windMaxKmh,
    et0Mm,
    events,
  }
}

interface EventContext {
  turn: number
  tempMean: number
  tempMin: number
  tempMax: number
  rainMm: number
  normalRain: number
  windMaxKmh: number
  rng: Rng
  stormProne: boolean
}

function detectEvents(ctx: EventContext): WeatherEvent[] {
  const events: WeatherEvent[] = []
  const season = seasonOfTurn(ctx.turn)

  if (ctx.tempMin <= -8) {
    events.push({
      id: 'gel-severe',
      label: 'Gel sévère',
      intensity: clamp01((-ctx.tempMin - 8) / 10),
    })
  } else if (ctx.tempMin <= -1) {
    events.push({ id: 'gel', label: 'Gelée', intensity: clamp01((-ctx.tempMin + 1) / 8) })
  }

  if (ctx.tempMax >= 34) {
    events.push({ id: 'canicule', label: 'Canicule', intensity: clamp01((ctx.tempMax - 34) / 9) })
  } else if (ctx.tempMax >= 28 && (season === 'printemps' || season === 'été')) {
    events.push({
      id: 'coup-de-chaleur',
      label: 'Coup de chaleur',
      intensity: clamp01((ctx.tempMax - 28) / 6),
    })
  }

  if (ctx.rainMm > ctx.normalRain * 2) {
    events.push({
      id: 'pluies-excessives',
      label: 'Pluies excessives',
      intensity: clamp01((ctx.rainMm / Math.max(1, ctx.normalRain) - 2) / 1.8),
    })
  }

  if (ctx.rainMm < ctx.normalRain * 0.3 && ctx.tempMean > 10) {
    events.push({
      id: 'secheresse',
      label: 'Épisode sec',
      intensity: clamp01(1 - ctx.rainMm / Math.max(1, ctx.normalRain * 0.3)),
    })
  }

  if (ctx.stormProne && ctx.windMaxKmh > 65) {
    events.push({
      id: 'orage',
      label: 'Orage',
      intensity: clamp01((ctx.windMaxKmh - 65) / 55),
    })
    // La grêle ne tombe que dans les orages, et rarement.
    if (ctx.rng() < 0.16) {
      events.push({ id: 'grele', label: 'Grêle', intensity: clamp01(0.3 + ctx.rng() * 0.7) })
    }
  }

  return events
}

/** Génère toute la météo de la campagne d'un coup — elle est fixée par la graine. */
export function generateCampaignWeather(character: YearCharacter, rng: Rng): readonly Weather[] {
  const all: Weather[] = []
  for (let turn = 0; turn < TURNS_PER_CAMPAIGN; turn++) {
    all.push(generateWeather(turn, character, rng))
  }
  return all
}

/** Prévision communiquée au joueur : la vérité, brouillée. */
export interface Forecast {
  readonly turn: number
  readonly tempMean: number
  readonly rainProbability: number
  readonly expectedRainMm: number
  /** Fiabilité 0→1 : décroît avec l'horizon. */
  readonly reliability: number
  readonly warnings: readonly string[]
}

const HORIZON_RELIABILITY = [0.88, 0.68, 0.48] as const

export function buildForecast(
  actual: Weather,
  horizon: number,
  rng: Rng,
  normalRainMm: number,
): Forecast {
  const reliability = HORIZON_RELIABILITY[horizon] ?? 0.35
  const error = 1 - reliability

  const tempMean = actual.tempMean + gaussian(rng) * 4.5 * error
  const expectedRainMm = Math.max(0, actual.rainMm * (1 + gaussian(rng) * 1.2 * error))
  const rainProbability = clamp01(
    clamp01(actual.rainMm / Math.max(1, normalRainMm * 1.4)) + gaussian(rng) * 0.28 * error,
  )

  const warnings: string[] = []
  for (const event of actual.events) {
    // Plus l'horizon est lointain, plus l'alerte risque d'être manquée.
    if (rng() < reliability) {
      warnings.push(`Risque de ${event.label.toLowerCase()}`)
    }
  }
  // Fausse alerte occasionnelle : la prévision n'est pas un oracle.
  if (rng() < error * 0.35) {
    const fake = ['Risque de gelée', 'Risque d’orage', 'Risque de coup de chaleur']
    const pick = fake[Math.floor(rng() * fake.length)]
    if (pick && !warnings.includes(pick)) warnings.push(pick)
  }

  return { turn: actual.turn, tempMean, rainProbability, expectedRainMm, reliability, warnings }
}

export function normalRainFor(turn: number): number {
  const period = periodAt(turn)
  return normalAt(period.month).rainMm * (period.days / 30)
}

export function normalTempFor(turn: number): number {
  return normalAt(periodAt(turn).month).tempMean
}
