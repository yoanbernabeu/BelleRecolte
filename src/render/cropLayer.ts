/**
 * Couche de culture posée sur une parcelle.
 *
 * À l'échelle de la scène (1 unité = 10 m), un épi de blé mesurerait moins d'un
 * centième d'unité : dessiner des plantes une par une n'aurait aucun sens. La
 * culture est donc rendue comme une surface épaisse — un dessus qui suit le
 * relief, une jupe verticale sur le pourtour — dont un shader anime le couvert.
 *
 * C'est ce shader qui fait le spectacle : lignes de semis, vagues de vent qui
 * traversent le champ, touffes qui accrochent la lumière, floraison, taches de
 * végétation abîmée, passage du vert au doré.
 *
 * Le couvert greffe son code sur un `MeshStandardMaterial` plutôt que de
 * repartir d'un shader nu. C'est délibéré : une culture doit recevoir la même
 * lumière, les mêmes ombres et le même brouillard que le reste de la scène.
 * Avec un éclairage réimplémenté à côté, les parcelles semées viraient au
 * bleu-gris pendant que la terre nue restait chaude — deux systèmes qui
 * dérivaient l'un de l'autre à chaque changement de saison.
 */

import * as THREE from 'three'
import { parcelSurfaceAt } from './world'
import type { ParcelDefinition } from '../sim/farm'

export interface CropAppearance {
  /** Couleur au pied de la végétation. */
  readonly base: THREE.Color
  /** Couleur en haut du couvert. */
  readonly tip: THREE.Color
  /** Hauteur du couvert en unités de monde (stylisée, pas à l'échelle). */
  readonly height: number
  /** Densité du couvert 0→1 : 0 laisse voir la terre, 1 couvre entièrement. */
  readonly cover: number
  /** Écartement des rangs, en unités. 0 = pas de rangs visibles (semis dense). */
  readonly rowSpacing: number
  /** Orientation des rangs, en radians. */
  readonly rowAngle: number
  /** Souplesse au vent : les céréales ondulent, la betterave non. */
  readonly sway: number
  /** Proportion de couvert dégradé 0→1 (maladie, sécheresse, gel). */
  readonly damage: number
  /** Verse : le couvert est couché. */
  readonly lodged: number
  /** Intensité de la floraison 0→1. */
  readonly flower: number
  /** Couleur des fleurs. */
  readonly flowerColor: THREE.Color
}

export const DEFAULT_APPEARANCE: CropAppearance = {
  base: new THREE.Color(0x5c7a3a),
  tip: new THREE.Color(0x86a44e),
  height: 0.2,
  cover: 0.7,
  rowSpacing: 0,
  rowAngle: 0,
  sway: 1,
  damage: 0,
  lodged: 0,
  flower: 0,
  flowerColor: new THREE.Color(0xf0d63f),
}

/** Déclarations partagées par les deux étages du shader. */
const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uSway;
  uniform float uWind;
  uniform float uLodged;
  uniform vec3 uBase;
  uniform vec3 uTip;
  uniform vec3 uSoil;
  uniform float uCover;
  uniform float uRowSpacing;
  uniform float uRowAngle;
  uniform float uDamage;
  uniform float uFlower;
  uniform vec3 uFlowerColor;

  varying float vCropTop;
  varying vec2 vCropField;

  float crHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float crNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(crHash(i), crHash(i + vec2(1.0, 0.0)), f.x),
      mix(crHash(i + vec2(0.0, 1.0)), crHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float crFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += crNoise(p) * a;
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }
  /** Relief du couvert : les touffes ne poussent pas toutes à la même hauteur. */
  float crTuft(vec2 field) {
    return crFbm(field * 0.55);
  }
`

const VERTEX_DECLARATIONS = /* glsl */ `
  attribute float aTop;   // 1 sur les sommets du dessus, 0 en bas de la jupe
  attribute vec2 aField;  // coordonnées locales dans la parcelle
`

/**
 * Déplacement des sommets.
 *
 * La géométrie ne stocke que l'altitude du sol ; la hauteur du couvert est
 * ajoutée ici, sinon mettre le maillage à l'échelle écraserait le relief.
 */
const VERTEX_BODY = /* glsl */ `
  vec3 transformed = vec3(position);
  vCropTop = aTop;
  vCropField = aField;

  // Le couvert n'est pas une nappe : les touffes montent inégalement, et c'est
  // ce relief qui accroche la lumière rasante.
  float tuft = crTuft(aField);
  transformed.y += aTop * uHeight * (0.68 + tuft * 0.64);

  // Ondulation : trois vagues croisées de périodes différentes, appliquées
  // seulement au sommet du couvert pour simuler la flexion des tiges.
  float wave =
    sin(aField.x * 0.35 + uTime * 1.15) * 0.55 +
    sin(aField.y * 0.27 - uTime * 0.83) * 0.45 +
    sin((aField.x + aField.y) * 0.19 + uTime * 1.6) * 0.3;

  float amplitude = aTop * uSway * uWind * uHeight * 0.6;
  transformed.x += wave * amplitude;
  transformed.z += wave * amplitude * 0.6;

  // Verse : le couvert s'affaisse et se couche dans une direction dominante.
  transformed.y -= aTop * uLodged * uHeight * 0.62;
  transformed.x += aTop * uLodged * uHeight * 0.5;
`

/**
 * Grain du couvert : on plie la normale au lieu de subdiviser la géométrie.
 *
 * Deux précautions. Le gradient est calculé dans le plan du champ, donc en
 * repère monde : il faut le ramener en repère vue, sinon il éclaire à contresens
 * dès que la caméra tourne. Et l'amplitude reste faible — une inclinaison trop
 * forte fait basculer des pans entiers de couvert à l'ombre du soleil, et le
 * champ vire au noir.
 */
const NORMAL_BODY = /* glsl */ `
  // Le couvert se rend en double face, et trois.js retourne alors la normale
  // des faces vues de dos. Nos normales sont posées à la main et pointent déjà
  // vers l'extérieur : on rétablit celle du sommet, sinon la nappe s'éclaire
  // par en dessous et le champ vire au noir.
  normal = normalize(vNormal);

  float tuftHere = crTuft(vCropField);
  float tuftX = crTuft(vCropField + vec2(0.7, 0.0));
  float tuftZ = crTuft(vCropField + vec2(0.0, 0.7));
  vec3 tuftSlope = vec3(tuftHere - tuftX, 0.0, tuftHere - tuftZ) * 2.2;
  vec3 tuftView = (viewMatrix * vec4(tuftSlope, 0.0)).xyz;
  normal = normalize(normal + tuftView * vCropTop * 0.45);
`

const COLOR_BODY = /* glsl */ `
  // Dégradé pied → sommet du couvert
  vec3 cropColor = mix(uBase, uTip, vCropTop * 0.85 + 0.15);

  // Lignes de semis : visibles tant que le couvert n'a pas refermé les rangs
  if (uRowSpacing > 0.001) {
    float c = cos(uRowAngle);
    float s = sin(uRowAngle);
    float across = vCropField.x * c - vCropField.y * s;
    float row = abs(fract(across / uRowSpacing) - 0.5) * 2.0;
    float gap = smoothstep(0.32, 0.95, row) * (1.0 - uCover * 0.75);
    cropColor = mix(cropColor, uSoil, gap * 0.75);
  }

  // Hétérogénéité naturelle du couvert
  float mottle = crFbm(vCropField * 0.09);
  cropColor *= 0.9 + mottle * 0.22;

  // Terre visible quand le couvert est clair. Le plafond compte autant que la
  // courbe : au-delà, une parcelle qui vient de lever devient indiscernable
  // d'une parcelle nue, et le joueur ne voit plus ce qu'il a semé.
  // Les bornes de smoothstep doivent être croissantes : l'ordre inverse est
  // un comportement indéfini en GLSL, et renvoie 1.0 sur certains pilotes.
  float bare = (1.0 - smoothstep(0.08, 0.62, uCover)) * (0.35 + mottle * 0.34);
  cropColor = mix(cropColor, uSoil, clamp(bare, 0.0, 0.58));

  // Floraison : le jaune du colza en avril, les capitules du tournesol en
  // juillet. C'est le seul moment de l'année où une parcelle se voit de loin.
  if (uFlower > 0.001) {
    float petals = smoothstep(0.42, 0.78, crNoise(vCropField * 5.5));
    float bloom = clamp(uFlower * (0.45 + petals * 0.75), 0.0, 1.0) * (0.35 + vCropTop * 0.65);
    cropColor = mix(cropColor, uFlowerColor, bloom);
  }

  // Zones abîmées : jaunissement puis brunissement par taches
  if (uDamage > 0.001) {
    float blotch = crFbm(vCropField * 0.14 + 31.0);
    float hit = smoothstep(1.0 - uDamage, 1.05 - uDamage * 0.7, blotch);
    vec3 sick = mix(vec3(0.72, 0.66, 0.32), vec3(0.42, 0.34, 0.22), uDamage);
    cropColor = mix(cropColor, sick, hit * 0.85);
  }

  // Vagues de vent : une nappe de lumière qui traverse le champ
  float gust = crFbm(vCropField * 0.05 + vec2(uTime * 0.28, uTime * 0.16));
  cropColor *= 1.0 + (gust - 0.5) * 0.34 * uWind * vCropTop;

  diffuseColor.rgb = cropColor;
`

/**
 * Construit le volume du couvert : une nappe supérieure qui épouse le relief,
 * plus une jupe verticale sur le pourtour pour donner de l'épaisseur.
 *
 * Les positions ne contiennent que l'altitude du sol. L'attribut `aTop` marque
 * les sommets qui doivent être remontés à la hauteur du couvert — c'est le
 * vertex shader qui applique cette hauteur, ce qui permet de la faire varier
 * sans déformer le relief.
 */
function buildCropGeometry(parcel: ParcelDefinition): THREE.BufferGeometry {
  const { footprint } = parcel
  const segmentsX = Math.max(8, Math.round(footprint.width / 2))
  const segmentsZ = Math.max(8, Math.round(footprint.depth / 2))

  const positions: number[] = []
  const normals: number[] = []
  const tops: number[] = []
  const fields: number[] = []

  const halfW = footprint.width / 2
  const halfD = footprint.depth / 2

  const localX = (i: number): number => -halfW + (footprint.width * i) / segmentsX
  const localZ = (j: number): number => -halfD + (footprint.depth * j) / segmentsZ
  // Le couvert part de la surface labourée, pas du terrain nu. L'écart doit
  // rester franc : sous un angle rasant, la terre ressort entre les tiges dès
  // qu'il descend au niveau du bruit du tampon de profondeur.
  const groundAt = (lx: number, lz: number): number =>
    parcelSurfaceAt(lx + footprint.x, lz + footprint.z) + 0.06

  // --- nappe supérieure
  for (let j = 0; j < segmentsZ; j++) {
    for (let i = 0; i < segmentsX; i++) {
      const x0 = localX(i)
      const x1 = localX(i + 1)
      const z0 = localZ(j)
      const z1 = localZ(j + 1)

      const corners: Array<[number, number]> = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ]
      const ys = corners.map(([x, z]) => groundAt(x, z))

      const push = (index: number): void => {
        const corner = corners[index]
        const y = ys[index]
        if (!corner || y === undefined) return
        positions.push(corner[0], y, corner[1])
        normals.push(0, 1, 0)
        tops.push(1)
        fields.push(corner[0], corner[1])
      }

      // Sens antihoraire vu du dessus : la face regarde le ciel.
      push(0)
      push(2)
      push(1)
      push(0)
      push(3)
      push(2)
    }
  }

  // --- jupe périmétrique
  const addSkirtQuad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    nx: number,
    nz: number,
  ): void => {
    const ayGround = groundAt(ax, az)
    const byGround = groundAt(bx, bz)

    // Le quatrième champ est `aTop` : le shader remontera ces sommets.
    const vertices: Array<[number, number, number, number]> = [
      [ax, ayGround, az, 0],
      [bx, byGround, bz, 0],
      [bx, byGround, bz, 1],
      [ax, ayGround, az, 0],
      [bx, byGround, bz, 1],
      [ax, ayGround, az, 1],
    ]
    for (const [x, y, z, top] of vertices) {
      positions.push(x, y, z)
      normals.push(nx, 0.25, nz)
      tops.push(top)
      fields.push(x, z)
    }
  }

  for (let i = 0; i < segmentsX; i++) {
    addSkirtQuad(localX(i + 1), -halfD, localX(i), -halfD, 0, -1)
    addSkirtQuad(localX(i), halfD, localX(i + 1), halfD, 0, 1)
  }
  for (let j = 0; j < segmentsZ; j++) {
    addSkirtQuad(-halfW, localZ(j), -halfW, localZ(j + 1), -1, 0)
    addSkirtQuad(halfW, localZ(j + 1), halfW, localZ(j), 1, 0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1))
  geometry.setAttribute('aField', new THREE.Float32BufferAttribute(fields, 2))
  geometry.computeBoundingSphere()

  return geometry
}

type CropUniforms = Record<string, THREE.IUniform>

function buildUniforms(soilColor: number): CropUniforms {
  return {
    uTime: { value: 0 },
    uHeight: { value: 0.001 },
    uSway: { value: 1 },
    uWind: { value: 0.4 },
    uLodged: { value: 0 },
    uBase: { value: DEFAULT_APPEARANCE.base.clone() },
    uTip: { value: DEFAULT_APPEARANCE.tip.clone() },
    uSoil: { value: new THREE.Color(soilColor) },
    uCover: { value: 0 },
    uRowSpacing: { value: 0 },
    uRowAngle: { value: 0 },
    uDamage: { value: 0 },
    uFlower: { value: 0 },
    uFlowerColor: { value: DEFAULT_APPEARANCE.flowerColor.clone() },
  }
}

function buildMaterial(uniforms: CropUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHARED_GLSL}\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', VERTEX_BODY)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SHARED_GLSL}`)
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>\n${NORMAL_BODY}`,
      )
      .replace('#include <map_fragment>', COLOR_BODY)
  }

  // Tous les couverts partagent le même code : une clé de cache commune évite
  // de recompiler le programme huit fois au démarrage.
  material.customProgramCacheKey = () => 'belle-recolte-crop'

  return material
}

export class CropLayer {
  readonly mesh: THREE.Mesh
  private readonly parcel: ParcelDefinition
  private readonly material: THREE.MeshStandardMaterial
  private readonly uniforms: CropUniforms
  private currentHeight: number
  private targetAppearance: CropAppearance = DEFAULT_APPEARANCE

  constructor(parcel: ParcelDefinition, soilColor: number) {
    this.parcel = parcel
    this.currentHeight = 0.001

    this.uniforms = buildUniforms(soilColor)
    this.material = buildMaterial(this.uniforms)

    this.mesh = new THREE.Mesh(buildCropGeometry(parcel), this.material)
    this.mesh.position.set(parcel.footprint.x, 0, parcel.footprint.z)
    this.mesh.visible = false
    // Le couvert reçoit les ombres des arbres, des haies et des bâtiments. Il
    // n'en projette pas : la carte d'ombres est calculée sur la géométrie non
    // déplacée, elle dessinerait une dalle plate au lieu d'un champ.
    this.mesh.receiveShadow = true
    this.mesh.userData['parcelId'] = parcel.id
  }

  get parcelId(): number {
    return this.parcel.id
  }

  /** Cible d'apparence ; la transition se fait dans update(). */
  setAppearance(appearance: CropAppearance): void {
    this.targetAppearance = appearance
  }

  /**
   * Applique la cible sans transition.
   *
   * En jeu on veut voir le couvert changer ; sur une scène de présentation qui
   * démarre déjà en pleine végétation, la transition ne montrerait qu'un champ
   * qui pousse en une seconde au premier regard.
   */
  settle(): void {
    const target = this.targetAppearance
    const u = this.uniforms
    this.currentHeight = Math.max(target.height, 0.001)
    u['uHeight']!.value = this.currentHeight
    ;(u['uBase']!.value as THREE.Color).copy(target.base)
    ;(u['uTip']!.value as THREE.Color).copy(target.tip)
    ;(u['uFlowerColor']!.value as THREE.Color).copy(target.flowerColor)
    u['uCover']!.value = target.cover
    u['uDamage']!.value = target.damage
    u['uLodged']!.value = target.lodged
    u['uFlower']!.value = target.flower
    this.mesh.visible = target.cover > 0.02 && this.currentHeight > 0.004
  }

  update(delta: number, elapsed: number, windStrength: number): void {
    const target = this.targetAppearance
    const u = this.uniforms

    // Interpolation douce : une culture ne change pas d'aspect d'un coup.
    const rate = Math.min(1, delta * 2.2)
    this.currentHeight += (Math.max(target.height, 0.001) - this.currentHeight) * rate
    u['uHeight']!.value = this.currentHeight

    const base = u['uBase']!.value as THREE.Color
    const tip = u['uTip']!.value as THREE.Color
    base.lerp(target.base, rate)
    tip.lerp(target.tip, rate)
    ;(u['uFlowerColor']!.value as THREE.Color).lerp(target.flowerColor, rate)

    u['uCover']!.value += (target.cover - (u['uCover']!.value as number)) * rate
    u['uDamage']!.value += (target.damage - (u['uDamage']!.value as number)) * rate
    u['uLodged']!.value += (target.lodged - (u['uLodged']!.value as number)) * rate
    u['uFlower']!.value += (target.flower - (u['uFlower']!.value as number)) * rate
    u['uRowSpacing']!.value = target.rowSpacing
    u['uRowAngle']!.value = target.rowAngle
    u['uSway']!.value = target.sway
    u['uWind']!.value += (windStrength - (u['uWind']!.value as number)) * Math.min(1, delta * 1.5)
    u['uTime']!.value = elapsed

    this.mesh.visible = target.cover > 0.02 && this.currentHeight > 0.004
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.removeFromParent()
  }
}
