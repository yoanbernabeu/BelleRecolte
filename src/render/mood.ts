/**
 * Traduction de l'état du jeu en ambiance sensible.
 *
 * Un tour de jeu porte une date et une météo ; ce module en déduit la couleur
 * du ciel, la hauteur du soleil, la densité du brouillard et le mélange sonore.
 * C'est le seul endroit où l'on décide « à quoi ressemble un matin de février
 * pluvieux » ou « une fin d'après-midi de juillet caniculaire ».
 */

import * as THREE from 'three'
import { periodAt, yearPhase } from '../sim/calendar'
import type { Weather } from '../sim/weather'
import type { SkyMood } from './sky'
import type { AmbienceMood } from '../audio/ambience'

function mixHex(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1))
}

/**
 * Hauteur du soleil au fil de l'année.
 * On ne simule pas l'heure de la journée : la scène est toujours vue en fin
 * d'après-midi, l'heure qui flatte le plus les reliefs. Seule la déclinaison
 * saisonnière fait varier la course du soleil.
 */
function sunElevationFor(turn: number): number {
  const phase = yearPhase(turn)
  // Minimum au solstice d'hiver (phase ≈ 0.97), maximum au solstice d'été (≈ 0.48)
  const seasonal = -Math.cos((phase - 0.055) * Math.PI * 2)
  return THREE.MathUtils.clamp(0.20 + seasonal * 0.17, 0.06, 0.44)
}

export interface Mood {
  readonly sky: SkyMood
  readonly ambience: AmbienceMood
  /** Force du vent transmise au shader des cultures, 0→1. */
  readonly windStrength: number
  /** Intensité de la pluie pour les particules, 0→1. */
  readonly rainIntensity: number
  /** Intensité de la neige, 0→1. */
  readonly snowIntensity: number
}

export function moodFor(turn: number, weather: Weather): Mood {
  const period = periodAt(turn)
  const season = period.season

  // --- couverture nuageuse déduite de la pluie et de l'ensoleillement
  const cloudiness = THREE.MathUtils.clamp(
    0.18 + (1 - weather.sunshine) * 0.85 + Math.min(weather.rainMm / 90, 0.45),
    0.05,
    0.98,
  )

  const rainIntensity = THREE.MathUtils.clamp((weather.rainMm - 12) / 70, 0, 1)
  // Il ne neige que s'il fait assez froid et qu'il tombe quelque chose.
  const snowIntensity =
    weather.tempMean < 2.5 && weather.rainMm > 8
      ? THREE.MathUtils.clamp((2.5 - weather.tempMean) / 4, 0, 1) *
        THREE.MathUtils.clamp(weather.rainMm / 40, 0, 1)
      : 0

  const windStrength = THREE.MathUtils.clamp((weather.windMaxKmh - 18) / 85, 0.08, 1)

  // --- palette du ciel
  // Le bleu du zénith s'affaiblit en hiver et sous les nuages.
  const seasonWarmth = season === 'été' ? 1 : season === 'printemps' ? 0.7 : season === 'automne' ? 0.5 : 0.2
  const top = mixHex(0x2d6ec0, 0x6d7f92, cloudiness * 0.85).lerp(
    new THREE.Color(0x35507a),
    (1 - seasonWarmth) * 0.35,
  )
  const horizon = mixHex(0xc9dcea, 0x9fa8b0, cloudiness * 0.8).lerp(
    new THREE.Color(0xe8d9bd),
    seasonWarmth * 0.4,
  )
  // Soleil plus doré quand il est bas, plus blanc au zénith d'été.
  const elevation = sunElevationFor(turn)
  const sun = mixHex(0xffc177, 0xfff0d4, THREE.MathUtils.clamp(elevation / 0.44, 0, 1)).lerp(
    new THREE.Color(0xb8c4d0),
    cloudiness * 0.55,
  )

  const sunIntensity = THREE.MathUtils.lerp(3.3, 0.75, cloudiness) * (0.7 + seasonWarmth * 0.4)
  const ambientIntensity = THREE.MathUtils.lerp(0.7, 1.5, cloudiness)

  // Brume : forte en hiver par temps calme, faible en été venteux.
  const stillness = 1 - THREE.MathUtils.clamp(weather.windMaxKmh / 70, 0, 1)
  const coldMist = season === 'hiver' || season === 'automne' ? 1 : 0.35
  const fogDensity = THREE.MathUtils.clamp(
    0.0013 + stillness * coldMist * 0.0022 + rainIntensity * 0.0016,
    0.0009,
    0.006,
  )

  const sky: SkyMood = {
    top,
    horizon,
    sun,
    sunIntensity,
    ambientIntensity,
    sunElevation: elevation,
    fogDensity,
    cloudiness,
  }

  // --- ambiance sonore
  // Les oiseaux suivent la saison : silence en décembre, plein chant en mai.
  const phase = yearPhase(turn)
  const birdSeason = THREE.MathUtils.clamp(
    Math.sin((phase - 0.13) * Math.PI * 2) * 0.5 + 0.5,
    0,
    1,
  )
  const ambience: AmbienceMood = {
    wind: windStrength,
    birds: birdSeason * (1 - rainIntensity * 0.7),
    rain: rainIntensity,
    brightness: THREE.MathUtils.clamp(seasonWarmth * 0.7 + (1 - cloudiness) * 0.4, 0.1, 1),
  }

  return { sky, ambience, windStrength, rainIntensity, snowIntensity }
}
