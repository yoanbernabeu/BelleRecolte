/**
 * Traduction de l'état agronomique d'une parcelle en apparence visuelle.
 *
 * C'est ici que « blé au stade remplissage, vigueur 0,7, versé » devient une
 * couleur, une hauteur de couvert et un taux de dégradation. Le joueur doit
 * pouvoir lire l'état de son exploitation d'un seul regard sur le paysage,
 * sans ouvrir un seul panneau.
 */

import * as THREE from 'three'
import { getCrop } from '../sim/crops'
import type { CropBloom } from '../sim/crops'
import type { ParcelState } from '../sim/engine'
import type { CropAppearance } from './cropLayer'

const scratchA = new THREE.Color()
const scratchB = new THREE.Color()
const NO_BLOOM = new THREE.Color(0xf0d63f)

/** Terre nue : le couvert disparaît complètement. */
const BARE: CropAppearance = {
  base: new THREE.Color(0x6b5340),
  tip: new THREE.Color(0x6b5340),
  height: 0.001,
  cover: 0,
  rowSpacing: 0,
  rowAngle: 0,
  sway: 0,
  damage: 0,
  lodged: 0,
  flower: 0,
  flowerColor: NO_BLOOM,
}

/** Chaume après moisson : bas, clair, sans vie. */
function stubble(cropRipeColor: number): CropAppearance {
  const pale = scratchA.setHex(cropRipeColor).clone()
  pale.offsetHSL(0, -0.35, 0.12)
  return {
    base: pale.clone().offsetHSL(0, 0, -0.06),
    tip: pale,
    height: 0.055,
    cover: 0.62,
    // Le chaume garde la trace des passages de moissonneuse.
    rowSpacing: 2.4,
    rowAngle: 0,
    sway: 0.15,
    damage: 0,
    lodged: 0,
    flower: 0,
    flowerColor: NO_BLOOM,
  }
}

/** Orientation des rangs, stable pour une parcelle donnée. */
function rowAngleFor(parcelId: number): number {
  return ((parcelId * 37) % 180) * (Math.PI / 180)
}

/** Cloche de floraison : monte, culmine, retombe. */
function bloomIntensity(bloom: CropBloom | undefined, progress: number): number {
  if (!bloom) return 0
  if (progress <= bloom.from || progress >= bloom.to) return 0
  const rising = progress < bloom.peak
  const span = rising ? bloom.peak - bloom.from : bloom.to - bloom.peak
  if (span <= 0) return 0
  const t = rising ? (progress - bloom.from) / span : (bloom.to - progress) / span
  return THREE.MathUtils.smoothstep(t, 0, 1)
}

export function appearanceFor(state: ParcelState): CropAppearance {
  if (!state.crop) return BARE

  const crop = getCrop(state.crop)
  const look = crop.appearance

  if (state.harvested) {
    // Une parcelle perdue reste en terre nue, une parcelle moissonnée laisse du chaume.
    if (state.harvestedTonnes <= 0) return BARE
    return { ...stubble(look.ripe), rowAngle: rowAngleFor(state.id) }
  }

  const progress = Math.min(1.25, state.gdd / crop.physiology.gddMaturity)

  // Développement du couvert : rapide jusqu'à la fermeture des rangs, puis stable.
  // Le plancher compte : un semis qui vient de lever doit déjà se distinguer
  // d'une parcelle nue, sinon le joueur ne voit pas ce qu'il a fait.
  const canopy = THREE.MathUtils.clamp(progress / 0.45, 0, 1)
  const cover = THREE.MathUtils.lerp(0.28, 0.97, canopy) * THREE.MathUtils.lerp(0.7, 1, state.vigor)
  const height = look.height * THREE.MathUtils.lerp(0.09, 1, Math.min(1, progress / 0.75))

  // Couleur : jeune → pleine végétation → mûr. La floraison se superpose
  // par-dessus, elle ne remplace pas la teinte du couvert.
  let color: THREE.Color
  if (progress < 0.35) {
    color = scratchA.setHex(look.young).clone()
  } else if (progress < 0.72) {
    color = scratchA
      .setHex(look.young)
      .lerp(scratchB.setHex(look.mature), (progress - 0.35) / 0.37)
      .clone()
  } else {
    color = scratchA
      .setHex(look.mature)
      .lerp(scratchB.setHex(look.ripe), Math.min(1, (progress - 0.72) / 0.28))
      .clone()
  }

  const tip = color
  const base = color.clone().offsetHSL(0, 0.03, -0.09)

  // Les rangs se referment à mesure que le couvert se développe.
  const rowSpacing = look.rowSpacing > 0 ? look.rowSpacing * THREE.MathUtils.lerp(1, 0.55, canopy) : 0

  // Une culture malade ou desséchée fleurit mal : la floraison suit la vigueur.
  const flower = bloomIntensity(look.bloom, progress) * THREE.MathUtils.lerp(0.35, 1, state.vigor)

  return {
    base,
    tip,
    height,
    cover,
    rowSpacing,
    rowAngle: rowAngleFor(state.id),
    sway: look.sway,
    // Les dégâts se lisent d'abord comme un jaunissement par taches.
    damage: THREE.MathUtils.clamp(
      (1 - state.vigor) * 0.85 + Math.max(0, state.diseasePressure - 0.5) * 0.4,
      0,
      0.95,
    ),
    lodged: state.lodged ? 1 : 0,
    flower,
    flowerColor: look.bloom ? scratchB.setHex(look.bloom.color).clone() : NO_BLOOM,
  }
}
