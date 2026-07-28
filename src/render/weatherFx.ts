/**
 * Précipitations.
 *
 * Un unique système de particules sert la pluie, la grêle et la neige : seules
 * changent la vitesse de chute, la taille, la dérive au vent et la couleur.
 * Les particules bouclent dans un volume qui suit la caméra, ce qui donne
 * l'illusion d'une averse sur toute la plaine pour quelques milliers de points.
 */

import * as THREE from 'three'

export type PrecipitationKind = 'pluie' | 'grele' | 'neige'

const MAX_PARTICLES = 6000
const VOLUME = new THREE.Vector3(150, 90, 150)

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFallSpeed;
  uniform float uDrift;
  uniform vec3 uVolume;
  uniform vec3 uOrigin;
  uniform float uSize;
  uniform float uCount;

  attribute float aSeed;

  varying float vFade;

  void main() {
    // Position de départ dispersée dans le volume, à partir de la graine
    vec3 p;
    p.x = fract(sin(aSeed * 12.9898) * 43758.5453) - 0.5;
    p.y = fract(sin(aSeed * 78.233) * 43758.5453);
    p.z = fract(sin(aSeed * 39.425) * 43758.5453) - 0.5;

    float speed = uFallSpeed * (0.75 + p.x * 0.5 + 0.25);
    // Chute avec bouclage : la particule qui touche le bas repart en haut
    float y = fract(p.y - uTime * speed / uVolume.y);

    vec3 world;
    world.x = uOrigin.x + p.x * uVolume.x + (1.0 - y) * uDrift * uVolume.x * 0.25;
    world.y = uOrigin.y + y * uVolume.y;
    world.z = uOrigin.z + p.z * uVolume.z + (1.0 - y) * uDrift * uVolume.z * 0.12;

    // On masque les particules au-delà du quota courant : l'intensité se règle
    // sans recréer la géométrie.
    vFade = step(aSeed, uCount);
    // Fondu en haut et en bas pour éviter l'apparition brutale
    vFade *= smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.82, y);

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uStretch;

  varying float vFade;

  void main() {
    if (vFade <= 0.001) discard;

    // Point étiré verticalement pour la pluie, rond pour la neige et la grêle
    vec2 uv = gl_PointCoord - 0.5;
    uv.x /= max(0.08, 1.0 - uStretch);
    float d = length(uv);
    if (d > 0.5) discard;

    float alpha = (1.0 - d * 2.0) * uOpacity * vFade;
    gl_FragColor = vec4(uColor, alpha);
  }
`

interface KindSettings {
  readonly fallSpeed: number
  readonly size: number
  readonly color: number
  readonly opacity: number
  readonly stretch: number
  readonly maxCount: number
}

const SETTINGS: Record<PrecipitationKind, KindSettings> = {
  pluie: { fallSpeed: 62, size: 1.5, color: 0xc9d8e6, opacity: 0.5, stretch: 0.82, maxCount: 5200 },
  grele: { fallSpeed: 78, size: 3.4, color: 0xf0f6ff, opacity: 0.9, stretch: 0.2, maxCount: 2200 },
  neige: { fallSpeed: 9, size: 3.2, color: 0xffffff, opacity: 0.85, stretch: 0, maxCount: 3600 },
}

export class Precipitation {
  readonly points: THREE.Points
  private readonly material: THREE.ShaderMaterial
  private kind: PrecipitationKind = 'pluie'
  private intensity = 0
  private displayedIntensity = 0

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry()
    const seeds = new Float32Array(MAX_PARTICLES)
    const positions = new Float32Array(MAX_PARTICLES * 3)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      seeds[i] = i / MAX_PARTICLES
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFallSpeed: { value: SETTINGS.pluie.fallSpeed },
        uDrift: { value: 0.2 },
        uVolume: { value: VOLUME.clone() },
        uOrigin: { value: new THREE.Vector3() },
        uSize: { value: SETTINGS.pluie.size },
        uCount: { value: 0 },
        uColor: { value: new THREE.Color(SETTINGS.pluie.color) },
        uOpacity: { value: SETTINGS.pluie.opacity },
        uStretch: { value: SETTINGS.pluie.stretch },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 800
    this.points.visible = false
    scene.add(this.points)
  }

  /** `intensity` 0→1. À 0, le système s'éteint complètement. */
  set(kind: PrecipitationKind, intensity: number): void {
    this.kind = kind
    this.intensity = THREE.MathUtils.clamp(intensity, 0, 1)
  }

  update(delta: number, elapsed: number, cameraTarget: THREE.Vector3, wind: number): void {
    // Transition douce : une averse ne démarre pas d'un coup.
    this.displayedIntensity += (this.intensity - this.displayedIntensity) * Math.min(1, delta * 1.1)
    if (this.displayedIntensity < 0.004) {
      this.points.visible = false
      return
    }
    this.points.visible = true

    const settings = SETTINGS[this.kind]
    const u = this.material.uniforms
    u['uTime']!.value = elapsed
    u['uFallSpeed']!.value = settings.fallSpeed
    u['uSize']!.value = settings.size
    u['uStretch']!.value = settings.stretch
    u['uOpacity']!.value = settings.opacity * Math.min(1, this.displayedIntensity * 1.6)
    ;(u['uColor']!.value as THREE.Color).setHex(settings.color)
    u['uDrift']!.value = wind * (this.kind === 'neige' ? 1.6 : 0.7)
    u['uCount']!.value = (settings.maxCount / MAX_PARTICLES) * this.displayedIntensity
    ;(u['uOrigin']!.value as THREE.Vector3).set(
      cameraTarget.x - VOLUME.x * 0,
      cameraTarget.y - 2,
      cameraTarget.z,
    )
  }

  dispose(): void {
    this.points.geometry.dispose()
    this.material.dispose()
    this.points.removeFromParent()
  }
}
