/**
 * Contexte de rendu : renderer, caméra, contrôles orbitaux et boucle d'animation.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type FrameCallback = (delta: number, elapsed: number) => void

export class Viewport {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly controls: OrbitControls
  readonly canvas: HTMLCanvasElement

  private readonly clock = new THREE.Clock()
  private readonly callbacks: FrameCallback[] = []
  private running = false
  private resizeObserver: ResizeObserver | null = null

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.canvas = this.renderer.domElement
    this.canvas.classList.add('viewport')
    container.appendChild(this.canvas)

    // Le plan proche gouverne la précision du tampon de profondeur, et cette
    // précision se joue presque entièrement sur les premières unités. Avec
    // `minDistance = 30` sur les contrôles, rien ne s'approche jamais à moins
    // de trente unités : descendre le plan proche à une demi-unité revenait à
    // jeter l'essentiel de la résolution et à faire scintiller tout ce qui est
    // posé à plat sur le terrain.
    this.camera = new THREE.PerspectiveCamera(40, 1, 4, 900)
    this.camera.position.set(112, 96, 176)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 30
    this.controls.maxDistance = 320
    this.controls.maxPolarAngle = Math.PI * 0.485
    this.controls.minPolarAngle = Math.PI * 0.08
    this.controls.target.set(0, 2, 2)
    this.controls.enablePan = true
    this.controls.panSpeed = 0.6
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.8

    this.observeSize(container)
  }

  private observeSize(container: HTMLElement): void {
    const resize = (): void => {
      const width = container.clientWidth || window.innerWidth
      const height = container.clientHeight || window.innerHeight
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
    resize()
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(resize)
      this.resizeObserver.observe(container)
    } else {
      window.addEventListener('resize', resize)
    }
  }

  onFrame(callback: FrameCallback): void {
    this.callbacks.push(callback)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.renderer.setAnimationLoop(() => this.tick())
  }

  stop(): void {
    this.running = false
    this.renderer.setAnimationLoop(null)
  }

  private tick(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1)
    const elapsed = this.clock.getElapsedTime()
    this.controls.update()
    for (const callback of this.callbacks) callback(delta, elapsed)
    this.renderer.render(this.scene, this.camera)
  }

  /** Déplace doucement la caméra vers une cible — utilisé au focus sur une parcelle. */
  focusOn(target: THREE.Vector3, distance: number, duration = 0.9): void {
    const startTarget = this.controls.target.clone()
    const startPosition = this.camera.position.clone()
    const offset = startPosition.clone().sub(startTarget).normalize().multiplyScalar(distance)
    const endPosition = target.clone().add(offset)
    const startTime = performance.now()

    const animate = (): void => {
      const t = Math.min(1, (performance.now() - startTime) / (duration * 1000))
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      this.controls.target.lerpVectors(startTarget, target, eased)
      this.camera.position.lerpVectors(startPosition, endPosition, eased)
      if (t < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  dispose(): void {
    this.stop()
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
