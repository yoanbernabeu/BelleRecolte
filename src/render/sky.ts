/**
 * Ciel et lumière.
 *
 * Un dôme en shader donne le dégradé horizon→zénith, une lumière directionnelle
 * joue le soleil, une hémisphérique simule le rebond du ciel et du sol.
 * L'ensemble se recolore selon la saison et la météo du tour.
 */

import * as THREE from 'three'

export interface SkyMood {
  /** Couleur du zénith. */
  readonly top: THREE.Color
  /** Couleur à l'horizon. */
  readonly horizon: THREE.Color
  /** Couleur de la lumière solaire. */
  readonly sun: THREE.Color
  /** Intensité du soleil. */
  readonly sunIntensity: number
  /** Intensité de la lumière d'ambiance. */
  readonly ambientIntensity: number
  /** Hauteur du soleil, 0 = horizon, 1 = zénith. */
  readonly sunElevation: number
  /** Densité du brouillard atmosphérique. */
  readonly fogDensity: number
  /** Couverture nuageuse 0→1. */
  readonly cloudiness: number
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float cloudiness;
  uniform float time;
  varying vec3 vWorldPosition;

  // Bruit de valeur pour les nuages
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += noise(p) * a;
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = clamp(dir.y, 0.0, 1.0);

    // Dégradé vertical, resserré près de l'horizon
    vec3 sky = mix(horizonColor, topColor, pow(h, 0.55));

    // Halo solaire
    float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
    sky += sunColor * pow(sunDot, 12.0) * 0.55;
    sky += sunColor * pow(sunDot, 3.0) * 0.12;

    // Nuages projetés sur une couche plate au-dessus de la scène
    if (dir.y > 0.02) {
      vec2 cloudUv = dir.xz / (dir.y + 0.18) * 0.55;
      cloudUv += vec2(time * 0.008, time * 0.004);
      float density = fbm(cloudUv * 1.4);
      float coverage = smoothstep(0.62 - cloudiness * 0.45, 0.92 - cloudiness * 0.35, density);
      coverage *= smoothstep(0.0, 0.22, dir.y);
      vec3 cloudLit = mix(vec3(0.55, 0.56, 0.62), vec3(1.0, 0.98, 0.94), 1.0 - cloudiness * 0.7);
      cloudLit += sunColor * pow(sunDot, 6.0) * 0.35;
      sky = mix(sky, cloudLit, coverage * (0.35 + cloudiness * 0.6));
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`

export class Sky {
  readonly mesh: THREE.Mesh
  readonly sunLight: THREE.DirectionalLight
  readonly hemiLight: THREE.HemisphereLight
  readonly fog: THREE.FogExp2

  private readonly uniforms: {
    topColor: { value: THREE.Color }
    horizonColor: { value: THREE.Color }
    sunColor: { value: THREE.Color }
    sunDirection: { value: THREE.Vector3 }
    cloudiness: { value: number }
    time: { value: number }
  }

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      topColor: { value: new THREE.Color(0x4a86c8) },
      horizonColor: { value: new THREE.Color(0xdfe6ec) },
      sunColor: { value: new THREE.Color(0xffe6b8) },
      sunDirection: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
      cloudiness: { value: 0.3 },
      time: { value: 0 },
    }

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), material)
    this.mesh.renderOrder = -1000
    scene.add(this.mesh)

    this.sunLight = new THREE.DirectionalLight(0xffe6b8, 2.4)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(2048, 2048)
    this.sunLight.shadow.camera.near = 1
    this.sunLight.shadow.camera.far = 320
    this.sunLight.shadow.camera.left = -110
    this.sunLight.shadow.camera.right = 110
    this.sunLight.shadow.camera.top = 110
    this.sunLight.shadow.camera.bottom = -110
    this.sunLight.shadow.bias = -0.0006
    this.sunLight.shadow.normalBias = 0.035
    scene.add(this.sunLight)
    scene.add(this.sunLight.target)

    this.hemiLight = new THREE.HemisphereLight(0xbdd7f5, 0x6b5a3e, 1.1)
    scene.add(this.hemiLight)

    this.fog = new THREE.FogExp2(0xdfe6ec, 0.0028)
    scene.fog = this.fog
  }

  apply(mood: SkyMood): void {
    this.uniforms.topColor.value.copy(mood.top)
    this.uniforms.horizonColor.value.copy(mood.horizon)
    this.uniforms.sunColor.value.copy(mood.sun)
    this.uniforms.cloudiness.value = mood.cloudiness

    const elevation = Math.max(0.06, mood.sunElevation)
    const azimuth = Math.PI * 0.32
    const direction = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(elevation * Math.PI * 0.5),
      Math.sin(elevation * Math.PI * 0.5),
      Math.sin(azimuth) * Math.cos(elevation * Math.PI * 0.5),
    ).normalize()

    this.uniforms.sunDirection.value.copy(direction)
    this.sunLight.position.copy(direction).multiplyScalar(160)
    this.sunLight.target.position.set(0, 0, 0)
    this.sunLight.color.copy(mood.sun)
    this.sunLight.intensity = mood.sunIntensity

    this.hemiLight.intensity = mood.ambientIntensity
    this.hemiLight.color.copy(mood.horizon)

    this.fog.color.copy(mood.horizon)
    this.fog.density = mood.fogDensity
  }

  update(elapsed: number): void {
    this.uniforms.time.value = elapsed
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
