/**
 * La ferme en 3D sur la page d'accueil.
 *
 * Vendre un jeu 3D avec une capture d'écran fixe, c'est se priver du seul
 * argument qui compte : le paysage bouge, le blé ondule, on peut tourner
 * autour. Cette scène est la même que celle du jeu — même terrain, même
 * parcellaire, mêmes couverts — figée sur une fin de printemps où le colza
 * fleurit et où toutes les cultures sont en place.
 *
 * Elle ne s'affiche jamais dans le chemin critique : `landing.ts` ne la charge
 * qu'une fois la page peinte et le fil d'exécution libre, et seulement si
 * l'appareil et les préférences du visiteur s'y prêtent. L'image reste visible
 * en dessous jusqu'à la première image rendue.
 */

import * as THREE from 'three'
import { CropLayer, type CropAppearance } from './cropLayer'
import { Sky, type SkyMood } from './sky'
import { Viewport } from './viewport'
import { World } from './world'
import { CROPS, type CropId } from '../sim/crops'
import { getSoil } from '../sim/soils'

/**
 * L'assolement montré sur la page d'accueil, parcelle par parcelle.
 *
 * La scène représente une fin de printemps, et l'avancement suit : les cultures
 * d'hiver sont aux deux tiers de leur cycle — le colza en pleine floraison —
 * pendant que celles de printemps viennent tout juste de couvrir le sol. C'est
 * ce décalage qui donne au tableau ses jaunes, ses verts sombres et ses rangs
 * encore ouverts, et c'est exactement ce que le joueur verra en mai.
 */
const SHOWCASE: readonly { readonly crop: CropId; readonly progress: number }[] = [
  { crop: 'ble-tendre-hiver', progress: 0.6 },
  { crop: 'colza-hiver', progress: 0.62 },
  { crop: 'orge-hiver', progress: 0.66 },
  { crop: 'colza-hiver', progress: 0.6 },
  { crop: 'betterave', progress: 0.3 },
  { crop: 'tournesol', progress: 0.18 },
  { crop: 'ble-tendre-hiver', progress: 0.63 },
  { crop: 'mais-grain', progress: 0.22 },
]

/**
 * Une fin d'après-midi de mai, ciel dégagé.
 *
 * Les valeurs restent dans la plage que produit `moodFor` en jeu au printemps :
 * pousser le soleil plus haut délaverait les couverts et ferait mentir la
 * vitrine sur ce que le joueur verra vraiment.
 */
const HERO_MOOD: SkyMood = {
  top: new THREE.Color(0x3a72bb),
  horizon: new THREE.Color(0xd3d8cf),
  sun: new THREE.Color(0xffdda0),
  sunIntensity: 2.5,
  ambientIntensity: 0.9,
  sunElevation: 0.3,
  fogDensity: 0.0018,
  cloudiness: 0.28,
}

function appearanceFor(cropId: CropId, progress: number, parcelId: number): CropAppearance {
  const look = CROPS[cropId].appearance

  const canopy = THREE.MathUtils.clamp(progress / 0.45, 0, 1)
  const color = new THREE.Color(look.young).lerp(
    new THREE.Color(look.mature),
    THREE.MathUtils.clamp((progress - 0.3) / 0.45, 0, 1),
  )

  const bloom = look.bloom
  const flower =
    bloom && progress > bloom.from && progress < bloom.to
      ? THREE.MathUtils.smoothstep(
          progress < bloom.peak
            ? (progress - bloom.from) / Math.max(0.001, bloom.peak - bloom.from)
            : (bloom.to - progress) / Math.max(0.001, bloom.to - bloom.peak),
          0,
          1,
        )
      : 0

  return {
    base: color.clone().offsetHSL(0, 0.03, -0.09),
    tip: color,
    height: look.height * THREE.MathUtils.lerp(0.14, 1, Math.min(1, progress / 0.75)),
    cover: THREE.MathUtils.lerp(0.34, 0.96, canopy),
    rowSpacing:
      look.rowSpacing > 0 ? look.rowSpacing * THREE.MathUtils.lerp(1, 0.55, canopy) : 0,
    rowAngle: ((parcelId * 37) % 180) * (Math.PI / 180),
    sway: look.sway,
    damage: 0,
    lodged: 0,
    flower,
    flowerColor: new THREE.Color(bloom?.color ?? 0xf0d63f),
  }
}

export interface HeroScene {
  /** Le contexte de rendu, pour recadrer la vue — la capture de partage s'en sert. */
  readonly viewport: Viewport
  /** Arrête la boucle de rendu et libère la mémoire GPU. */
  readonly dispose: () => void
}

export function mountHeroScene(container: HTMLElement): HeroScene {
  const viewport = new Viewport(container)
  const sky = new Sky(viewport.scene)
  const world = new World(viewport.scene)

  sky.apply(HERO_MOOD)

  const layers = world.parcels.map((visual, index) => {
    const layer = new CropLayer(visual.definition, getSoil(visual.definition.soil).color)
    const shown = SHOWCASE[index] ?? { crop: 'ble-tendre-hiver' as CropId, progress: 0.6 }
    layer.setAppearance(appearanceFor(shown.crop, shown.progress, visual.definition.id))
    layer.settle()
    viewport.scene.add(layer.mesh)
    return layer
  })

  // Une vue rasante et lente : on veut donner envie d'entrer dans le paysage,
  // pas simuler un survol de drone.
  viewport.camera.position.set(78, 48, 104)
  viewport.controls.target.set(0, 2, 0)
  viewport.controls.autoRotate = true
  viewport.controls.autoRotateSpeed = 0.3
  viewport.controls.enableZoom = false
  viewport.controls.enablePan = false
  viewport.controls.minPolarAngle = Math.PI * 0.26
  viewport.controls.maxPolarAngle = Math.PI * 0.42

  viewport.onFrame((delta, elapsed) => {
    sky.update(elapsed)
    for (const layer of layers) layer.update(delta, elapsed, 0.45)
  })

  // Rien ne tourne quand la scène a quitté l'écran : une page d'accueil ne doit
  // pas faire chauffer un portable pendant qu'on lit le bas de page.
  //
  // On ne surveille pas l'onglet en arrière-plan pour autant. Le navigateur
  // suspend déjà `requestAnimationFrame` dans ce cas, et couper la boucle
  // nous-mêmes ne ferait qu'exposer un défaut : le tampon de rendu est vidé
  // après présentation, si bien qu'un canevas figé se retrouve vide.
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting ?? true) viewport.start()
      else viewport.stop()
    },
    { threshold: 0.05 },
  )
  observer.observe(container)

  viewport.start()

  return {
    viewport,
    dispose: () => {
      observer.disconnect()
      for (const layer of layers) layer.dispose()
      world.dispose()
      sky.dispose()
      viewport.dispose()
    },
  }
}
