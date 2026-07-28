/**
 * Le monde : relief, parcelles, chemins, corps de ferme et végétation.
 * Tout est généré en code — aucun modèle 3D externe.
 */

import * as THREE from 'three'
import { fbm2D, valueNoise2D } from './noise'
import {
  BLOCK_HALF_DEPTH,
  BLOCK_HALF_WIDTH,
  FARMSTEAD,
  PARCELS,
  type ParcelDefinition,
} from '../sim/farm'
import { getSoil } from '../sim/soils'

const TERRAIN_SIZE = 900
const TERRAIN_SEGMENTS = 224
/** Rayon de la plaine plate qui porte l'exploitation. */
const FIELD_RADIUS = 104

/**
 * Hauteur à laquelle on pose ce qui recouvre le terrain.
 *
 * Une surface plaquée sur le relief ne peut pas l'épouser exactement : elle
 * interpole entre ses propres sommets, le terrain entre les siens. À 0,08 unité
 * d'écart le terrain ressortait entre deux sommets, ce qui donnait des bords
 * déchiquetés et un scintillement à chaque mouvement de caméra. On monte le
 * décalage bien au-dessus de l'erreur d'interpolation maximale (≈ 0,08 unité
 * pour un pas de 3), et `polygonOffset` règle le reste côté profondeur.
 */
const OVERLAY_LIFT = 0.3
/** Pas d'échantillonnage de tout ce qui doit suivre le relief. */
const OVERLAY_STEP = 3

/** Relief : ondulations douces sur la zone cultivée, coteaux au loin. */
export function heightAt(x: number, z: number): number {
  const distance = Math.hypot(x, z)
  const outer = THREE.MathUtils.smoothstep(distance, FIELD_RADIUS, 330)
  const gentle = (fbm2D(x * 0.011, z * 0.011, 3, 11) - 0.5) * 2.2
  const hills = (fbm2D(x * 0.0035, z * 0.0035, 4, 29) - 0.42) * 30
  return gentle + hills * outer
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
    }
  })
}

/**
 * Matériau des surfaces plaquées sur le terrain (champs voisins, chemins).
 * `polygonOffset` décale la profondeur écrite sans bouger la géométrie : c'est
 * exactement ce qu'il faut pour un décalque, et ça évite d'avoir à surélever
 * la surface au point qu'elle flotte visiblement.
 */
function overlayMaterial(options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    roughness: 0.97,
    metalness: 0,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...options,
  })
}

/**
 * Accumulateur de géométrie : on empile des quads plaqués sur le relief, puis
 * on en fait un seul maillage. Les champs voisins étaient auparavant deux cents
 * maillages distincts — autant d'appels de rendu pour un décor immobile.
 */
class SurfaceBuilder {
  private readonly positions: number[] = []
  private readonly colors: number[] = []

  /** Ajoute un rectangle horizontal, subdivisé pour épouser le relief. */
  addPatch(
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    angle: number,
    color: THREE.Color,
    lift = OVERLAY_LIFT,
  ): void {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const stepsX = Math.max(1, Math.round(width / OVERLAY_STEP))
    const stepsZ = Math.max(1, Math.round(depth / OVERLAY_STEP))

    const world = (u: number, v: number): [number, number] => {
      const localX = (u - 0.5) * width
      const localZ = (v - 0.5) * depth
      return [centerX + localX * cos - localZ * sin, centerZ + localX * sin + localZ * cos]
    }

    for (let j = 0; j < stepsZ; j++) {
      for (let i = 0; i < stepsX; i++) {
        const corners: Array<[number, number]> = [
          world(i / stepsX, j / stepsZ),
          world((i + 1) / stepsX, j / stepsZ),
          world((i + 1) / stepsX, (j + 1) / stepsZ),
          world(i / stepsX, (j + 1) / stepsZ),
        ]
        // Sens antihoraire vu du dessus : la normale doit pointer vers le ciel,
        // sinon la surface est éliminée par le tri des faces arrière.
        for (const index of [0, 2, 1, 0, 3, 2]) {
          const corner = corners[index]
          if (!corner) continue
          this.positions.push(corner[0], heightAt(corner[0], corner[1]) + lift, corner[1])
          this.colors.push(color.r, color.g, color.b)
        }
      }
    }
  }

  get isEmpty(): boolean {
    return this.positions.length === 0
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.computeVertexNormals()
    return geometry
  }
}

// ---------------------------------------------------------------- terrain

function buildTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  )
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes['position'] as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)

  const meadow = new THREE.Color(0x6f8f4a)
  const dry = new THREE.Color(0x8d9a56)
  const deep = new THREE.Color(0x53743c)
  const scratch = new THREE.Color()

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const y = heightAt(x, z)
    position.setY(i, y)

    const variation = valueNoise2D(x * 0.06, z * 0.06, 5)
    scratch.copy(meadow).lerp(variation > 0.5 ? dry : deep, Math.abs(variation - 0.5) * 1.6)
    // Les sommets s'assèchent, les creux restent verts
    scratch.lerp(dry, THREE.MathUtils.clamp(y / 18, 0, 0.5))
    colors[i * 3] = scratch.r
    colors[i * 3 + 1] = scratch.g
    colors[i * 3 + 2] = scratch.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.96,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

// ---------------------------------------------------------------- parcelles

export interface ParcelVisual {
  readonly definition: ParcelDefinition
  readonly group: THREE.Group
  readonly soilMesh: THREE.Mesh
  /** Conteneur où le rendu des cultures vient s'accrocher. */
  readonly cropAnchor: THREE.Group
  /** Contour affiché au survol et à la sélection. */
  readonly outline: THREE.LineSegments
  readonly center: THREE.Vector3
}

/** Altitude de la surface d'une parcelle : la référence du couvert végétal. */
export function parcelSurfaceAt(x: number, z: number): number {
  return heightAt(x, z) + OVERLAY_LIFT
}

function buildParcelSurface(parcel: ParcelDefinition): THREE.Mesh {
  const { footprint } = parcel
  const segmentsX = Math.max(6, Math.round(footprint.width / OVERLAY_STEP))
  const segmentsZ = Math.max(6, Math.round(footprint.depth / OVERLAY_STEP))
  const geometry = new THREE.PlaneGeometry(
    footprint.width,
    footprint.depth,
    segmentsX,
    segmentsZ,
  )
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes['position'] as THREE.BufferAttribute
  const soil = getSoil(parcel.soil)
  const colors = new Float32Array(position.count * 3)
  const base = new THREE.Color(soil.color)
  const scratch = new THREE.Color()

  // Les raies de labour suivent le grand côté de la parcelle, comme un
  // déchaumage réel. Leur période est calée sur la maille du maillage : plus
  // serrée, elle produirait un moiré au lieu de raies.
  const alongZ = footprint.depth > footprint.width
  const furrowPeriod = OVERLAY_STEP * 2

  for (let i = 0; i < position.count; i++) {
    const localX = position.getX(i)
    const localZ = position.getZ(i)
    const worldX = localX + footprint.x
    const worldZ = localZ + footprint.z
    position.setY(i, parcelSurfaceAt(worldX, worldZ))

    const across = alongZ ? localX : localZ
    const furrow = Math.sin((across / furrowPeriod) * Math.PI * 2) * 0.5 + 0.5
    const patch = valueNoise2D(worldX * 0.09, worldZ * 0.09, 17)
    scratch.copy(base)
    scratch.offsetHSL(0, 0, (furrow - 0.5) * 0.045 + (patch - 0.5) * 0.06)
    colors[i * 3] = scratch.r
    colors[i * 3 + 1] = scratch.g
    colors[i * 3 + 2] = scratch.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()

  // Pas de `polygonOffset` ici, contrairement aux autres décalques : son
  // décalage croît avec l'inclinaison du polygone vu de la caméra, et sous un
  // angle rasant il finissait par passer devant le couvert végétal posé
  // quelques centièmes d'unité plus haut. La surélévation seule suffit, le sol
  // d'une parcelle étant déjà franchement au-dessus du terrain.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.98,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(footprint.x, 0, footprint.z)
  mesh.receiveShadow = true
  mesh.userData['parcelId'] = parcel.id
  return mesh
}

function buildParcelOutline(parcel: ParcelDefinition): THREE.LineSegments {
  const { footprint } = parcel
  const halfW = footprint.width / 2
  const halfD = footprint.depth / 2
  const corners: Array<[number, number]> = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ]

  const points: number[] = []
  const steps = 10
  for (let c = 0; c < 4; c++) {
    const from = corners[c]
    const to = corners[(c + 1) % 4]
    if (!from || !to) continue
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps
      const t1 = (s + 1) / steps
      const x0 = from[0] + (to[0] - from[0]) * t0
      const z0 = from[1] + (to[1] - from[1]) * t0
      const x1 = from[0] + (to[0] - from[0]) * t1
      const z1 = from[1] + (to[1] - from[1]) * t1
      points.push(
        x0,
        heightAt(x0 + footprint.x, z0 + footprint.z) + 0.5,
        z0,
        x1,
        heightAt(x1 + footprint.x, z1 + footprint.z) + 0.5,
        z1,
      )
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const material = new THREE.LineBasicMaterial({
    color: 0xfff2c4,
    transparent: true,
    opacity: 0,
    depthTest: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.position.set(footprint.x, 0, footprint.z)
  lines.renderOrder = 900
  return lines
}

// ---------------------------------------------------------------- chemins

interface Axis {
  readonly center: number
  readonly half: number
}

/**
 * Les bandes occupées par les parcelles sur chaque axe, dans l'ordre.
 * On les déduit des emprises plutôt que de les redéclarer : les chemins et les
 * haies restent alignés même si le parcellaire change.
 */
function gridAxes(): { columns: Axis[]; rows: Axis[] } {
  const collect = (
    pick: (parcel: ParcelDefinition) => { center: number; half: number },
  ): Axis[] => {
    const byCenter = new Map<number, number>()
    for (const parcel of PARCELS) {
      const { center, half } = pick(parcel)
      byCenter.set(center, Math.max(byCenter.get(center) ?? 0, half))
    }
    return [...byCenter.entries()]
      .map(([center, half]) => ({ center, half }))
      .sort((a, b) => a.center - b.center)
  }

  return {
    columns: collect((p) => ({ center: p.footprint.x, half: p.footprint.width / 2 })),
    rows: collect((p) => ({ center: p.footprint.z, half: p.footprint.depth / 2 })),
  }
}

/** Milieu de chaque allée intérieure, plus les deux tours de plaine. */
function laneCenters(axes: Axis[], blockHalf: number, headland: number): number[] {
  const inner = axes.slice(0, -1).map((axis, index) => {
    const next = axes[index + 1]
    if (!next) return axis.center
    return (axis.center + axis.half + (next.center - next.half)) / 2
  })
  return [-(blockHalf + headland), ...inner, blockHalf + headland]
}

/**
 * Les chemins d'exploitation, dans les allées que laisse la grille.
 *
 * Ils ne servent pas qu'au décor : ce sont eux qui font lire le parcellaire
 * comme un ensemble organisé plutôt que comme huit rectangles posés au hasard,
 * et qui donnent à la caméra des lignes de fuite.
 */
function buildLanes(): THREE.Mesh {
  const builder = new SurfaceBuilder()
  const track = new THREE.Color(0xb2a179)
  const { columns, rows } = gridAxes()

  const headland = 3
  const laneWidth = 4
  const spanX = (BLOCK_HALF_WIDTH + headland) * 2 + laneWidth
  const spanZ = (BLOCK_HALF_DEPTH + headland) * 2 + laneWidth

  for (const z of laneCenters(rows, BLOCK_HALF_DEPTH, headland)) {
    builder.addPatch(0, z, spanX, laneWidth, 0, track)
  }
  for (const x of laneCenters(columns, BLOCK_HALF_WIDTH, headland)) {
    builder.addPatch(x, 0, laneWidth, spanZ, 0, track)
  }

  const mesh = new THREE.Mesh(builder.build(), overlayMaterial({ vertexColors: true, roughness: 1 }))
  mesh.receiveShadow = true
  return mesh
}

// ---------------------------------------------------------------- végétation

function buildTree(rng: () => number): THREE.Group {
  const group = new THREE.Group()
  const height = 2.6 + rng() * 2.4
  const trunkHeight = height * 0.4

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.26, trunkHeight, 5),
    new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1, flatShading: true }),
  )
  trunk.position.y = trunkHeight / 2
  trunk.castShadow = true
  group.add(trunk)

  const foliageColors = [0x4f7a3a, 0x5f8b3f, 0x456b34, 0x6d9448]
  const layers = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < layers; i++) {
    const t = i / layers
    const radius = (1.5 - t * 0.75) * (0.8 + rng() * 0.4)
    const color = foliageColors[Math.floor(rng() * foliageColors.length)] ?? 0x4f7a3a
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true }),
    )
    blob.position.set(
      (rng() - 0.5) * 0.7,
      trunkHeight + t * height * 0.45 + radius * 0.5,
      (rng() - 0.5) * 0.7,
    )
    blob.scale.y = 0.85 + rng() * 0.3
    blob.castShadow = true
    group.add(blob)
  }

  return group
}

function buildVegetation(rng: () => number): THREE.Group {
  const group = new THREE.Group()

  // Bosquets en couronne autour de la zone cultivée, puis boisements lointains
  // regroupés en taches pour éviter le semis uniforme qui fait « champ de pixels ».
  const clusters = 26
  for (let c = 0; c < clusters; c++) {
    const angle = rng() * Math.PI * 2
    const radius = FIELD_RADIUS + 10 + rng() * 250
    const cx = Math.cos(angle) * radius
    const cz = Math.sin(angle) * radius
    const spread = 6 + rng() * 22
    const count = 6 + Math.floor(rng() * 22)

    for (let i = 0; i < count; i++) {
      const x = cx + (rng() - 0.5) * spread * 2
      const z = cz + (rng() - 0.5) * spread * 2
      if (Math.hypot(x, z) < FIELD_RADIUS) continue
      if (Math.abs(x) > TERRAIN_SIZE * 0.45 || Math.abs(z) > TERRAIN_SIZE * 0.45) continue
      const tree = buildTree(rng)
      tree.position.set(x, heightAt(x, z) - 0.1, z)
      tree.rotation.y = rng() * Math.PI * 2
      tree.scale.setScalar(0.9 + rng() * 0.8)
      group.add(tree)
    }
  }

  return group
}

/**
 * Le paysage alentour : les champs des voisins.
 * Sans ce patchwork, l'horizon ressemble à un terrain de golf. Avec, on lit
 * immédiatement une plaine céréalière.
 */
const DISTANT_FIELD_COLORS: readonly number[] = [
  0x9aa84f, 0xd9bd63, 0xc9a94a, 0x7c8f43, 0x6f5a3f,
  0xa8b85c, 0xe0c96f, 0x5c7a3a, 0x8a7448, 0xb9c169,
]

function buildDistantFields(rng: () => number): THREE.Mesh {
  const builder = new SurfaceBuilder()
  // Les parcellaires réels s'orientent selon quelques axes dominants.
  const axes = [0, Math.PI * 0.5, Math.PI * 0.17, Math.PI * 0.67]
  const step = 40
  const reach = TERRAIN_SIZE * 0.42
  const color = new THREE.Color()
  // On laisse respirer nos propres parcelles : la diagonale du bloc cultivé,
  // plus la marge des chemins de tour de plaine.
  const clearance = Math.hypot(BLOCK_HALF_WIDTH, BLOCK_HALF_DEPTH) + 30
  let index = 0

  for (let gx = -reach; gx <= reach; gx += step) {
    for (let gz = -reach; gz <= reach; gz += step) {
      const cx = gx + (rng() - 0.5) * step * 0.55
      const cz = gz + (rng() - 0.5) * step * 0.55
      if (Math.hypot(cx, cz) < clearance) continue
      if (rng() < 0.18) continue

      const width = 22 + rng() * 30
      const depth = 18 + rng() * 26
      const angle = axes[Math.floor(rng() * axes.length)] ?? 0
      color.setHex(DISTANT_FIELD_COLORS[Math.floor(rng() * DISTANT_FIELD_COLORS.length)] ?? 0x9aa84f)

      // Les champs voisins se recouvrent par endroits. Deux surfaces exactement
      // coplanaires se disputent le tampon de profondeur et produisent le moiré
      // en damier que l'on voyait au loin : on les échelonne sur six hauteurs,
      // assez pour les départager, trop peu pour se voir.
      builder.addPatch(cx, cz, width, depth, angle, color, OVERLAY_LIFT + (index % 6) * 0.012)
      index += 1
    }
  }

  const mesh = new THREE.Mesh(builder.build(), overlayMaterial({ vertexColors: true }))
  mesh.receiveShadow = true
  return mesh
}

/**
 * Haie basse le long d'un segment — sépare les parcelles et casse le vent.
 *
 * À l'échelle de la scène (1 unité = 10 m), une haie bocagère fait 0,3 à 0,5
 * unité de haut. Les blobs d'une unité et demie que portait la version
 * précédente représentaient des buissons de quinze mètres, et écrasaient tout
 * le parcellaire.
 */
function buildHedge(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  rng: () => number,
  material: THREE.Material,
  /** Renvoie vrai là où la haie doit s'interrompre — un passage d'engin. */
  isGap: (x: number, z: number) => boolean = () => false,
): THREE.Group {
  const group = new THREE.Group()
  const length = Math.hypot(x1 - x0, z1 - z0)
  const count = Math.max(2, Math.round(length / 0.75))

  for (let i = 0; i <= count; i++) {
    const t = i / count
    const x = x0 + (x1 - x0) * t + (rng() - 0.5) * 0.35
    const z = z0 + (z1 - z0) * t + (rng() - 0.5) * 0.35
    if (isGap(x, z)) continue
    const radius = 0.42 + rng() * 0.16
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), material)
    blob.position.set(x, heightAt(x, z) + radius * 0.65, z)
    blob.scale.set(1, 0.85 + rng() * 0.35, 1)
    blob.rotation.y = rng() * Math.PI
    blob.castShadow = true
    blob.receiveShadow = true
    group.add(blob)
  }
  return group
}

/**
 * Le bocage : une haie sur le tour de plaine et sur les séparations est-ouest.
 *
 * On n'en met pas partout. Un bocage complet enfermerait chaque parcelle et
 * masquerait les cultures — or c'est le couvert que le joueur doit lire.
 */
function buildHedgerows(rng: () => number): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: 0x46662f,
    roughness: 0.95,
    flatShading: true,
  })

  const { columns, rows } = gridAxes()
  // La haie borde la parcelle sans mordre sur le chemin qui longe l'allée.
  const setback = 0.9
  const reach = BLOCK_HALF_WIDTH + 1

  // Les chemins nord-sud traversent les haies : on ménage un passage à chaque
  // croisement, sinon les engins sortiraient à travers le bocage.
  const crossings = laneCenters(columns, BLOCK_HALF_WIDTH, 3)
  const opensFor = (x: number): boolean => crossings.some((lane) => Math.abs(x - lane) < 3.4)

  for (const row of rows) {
    for (const side of [-1, 1]) {
      const lineZ = row.center + side * (row.half + setback)
      group.add(buildHedge(-reach, lineZ, reach, lineZ, rng, material, (x) => opensFor(x)))
    }
  }

  // Deux rideaux nord-sud sur les bords extérieurs, pour fermer le tableau sans
  // cloisonner l'intérieur du parcellaire.
  const depthReach = BLOCK_HALF_DEPTH + 1
  const rowCrossings = laneCenters(rows, BLOCK_HALF_DEPTH, 3)
  for (const side of [-1, 1]) {
    const lineX = side * (BLOCK_HALF_WIDTH + setback)
    group.add(
      buildHedge(lineX, -depthReach, lineX, depthReach, rng, material, (_x, z) =>
        rowCrossings.some((lane) => Math.abs(z - lane) < 3.4),
      ),
    )
  }

  return group
}

// ---------------------------------------------------------------- bâtiments

function buildFarmstead(): THREE.Group {
  const group = new THREE.Group()
  const wall = new THREE.MeshStandardMaterial({
    color: 0xe4d6b8,
    roughness: 0.9,
    flatShading: true,
  })
  const roof = new THREE.MeshStandardMaterial({
    color: 0x8d4a3a,
    roughness: 0.85,
    flatShading: true,
  })
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa3aa,
    roughness: 0.55,
    metalness: 0.35,
    flatShading: true,
  })

  const addBuilding = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    rotation: number,
    roofMaterial: THREE.Material,
  ): void => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wall)
    base.position.set(x, heightAt(x, z) + height / 2, z)
    base.rotation.y = rotation
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    const roofMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0, Math.hypot(width, depth) * 0.52, height * 0.6, 4),
      roofMaterial,
    )
    roofMesh.position.set(x, heightAt(x, z) + height + height * 0.3 - 0.05, z)
    roofMesh.rotation.y = rotation + Math.PI / 4
    roofMesh.scale.set(1, 1, depth / width)
    roofMesh.castShadow = true
    group.add(roofMesh)
  }

  const { x, z } = FARMSTEAD
  addBuilding(x - 8, z - 4, 8, 5.5, 3.2, 0, roof)
  addBuilding(x + 2, z - 2, 11, 7, 4.4, 0, metal)

  // Silos
  for (let i = 0; i < 2; i++) {
    const sx = x + 11 + i * 3.5
    const sz = z - 7
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 10), metal)
    silo.position.set(sx, heightAt(sx, sz) + 3, sz)
    silo.castShadow = true
    group.add(silo)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.4, 10), metal)
    cap.position.set(sx, heightAt(sx, sz) + 6.7, sz)
    cap.castShadow = true
    group.add(cap)
  }

  // La cour : une dalle claire qui ancre les bâtiments au sol.
  const yard = new SurfaceBuilder()
  yard.addPatch(x + 1, z - 2, 26, 12, 0, new THREE.Color(0xc4b591))
  const yardMesh = new THREE.Mesh(yard.build(), overlayMaterial({ vertexColors: true, roughness: 1 }))
  yardMesh.receiveShadow = true
  group.add(yardMesh)

  return group
}

// ---------------------------------------------------------------- monde

export class World {
  readonly root = new THREE.Group()
  readonly parcels: readonly ParcelVisual[]
  readonly terrain: THREE.Mesh

  constructor(scene: THREE.Scene, seed = 1) {
    let state = seed >>> 0
    const rng = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }

    this.terrain = buildTerrain()
    this.root.add(this.terrain)

    // Les décalques du terrain d'abord — les parcelles se posent par-dessus.
    this.root.add(buildDistantFields(rng))
    this.root.add(buildLanes())

    const visuals: ParcelVisual[] = []
    for (const definition of PARCELS) {
      const group = new THREE.Group()
      const soilMesh = buildParcelSurface(definition)
      const outline = buildParcelOutline(definition)
      const cropAnchor = new THREE.Group()
      cropAnchor.position.set(definition.footprint.x, 0, definition.footprint.z)

      group.add(soilMesh, outline, cropAnchor)
      this.root.add(group)

      visuals.push({
        definition,
        group,
        soilMesh,
        cropAnchor,
        outline,
        center: new THREE.Vector3(
          definition.footprint.x,
          heightAt(definition.footprint.x, definition.footprint.z),
          definition.footprint.z,
        ),
      })
    }
    this.parcels = visuals

    this.root.add(buildHedgerows(rng))
    this.root.add(buildVegetation(rng))
    this.root.add(buildFarmstead())

    scene.add(this.root)
  }

  parcelAt(id: number): ParcelVisual | undefined {
    return this.parcels.find((p) => p.definition.id === id)
  }

  /** Met en évidence une parcelle (survol ou sélection). */
  setHighlight(id: number | null, selected: number | null): void {
    for (const parcel of this.parcels) {
      const material = parcel.outline.material as THREE.LineBasicMaterial
      const isSelected = parcel.definition.id === selected
      const isHovered = parcel.definition.id === id
      material.opacity = isSelected ? 0.95 : isHovered ? 0.5 : 0
      material.color.setHex(isSelected ? 0xfff2c4 : 0xffffff)
    }
  }

  dispose(): void {
    disposeObject(this.root)
    this.root.removeFromParent()
  }
}
