/**
 * Le passe-temps du salon d'attente : des taupes, un maillet.
 *
 * Rien de tout cela ne compte pour la campagne. C'est un jeu d'occupation, pour
 * que les cinq minutes où l'on attend les retardataires ne soient pas cinq
 * minutes à regarder un écran fixe. Le score n'est envoyé nulle part et personne
 * d'autre ne le voit.
 *
 * Tout se joue au clavier : on appuie sur la lettre que porte la taupe, et le
 * maillet s'abat dessus. D'où l'unicité des lettres à l'écran — deux taupes « J »
 * rendraient la touche ambiguë.
 *
 * Effet de bord assumé et bienvenu : faire tourner cette scène télécharge
 * Three.js pendant l'attente. Au top départ, la campagne s'ouvre donc
 * instantanément au lieu de faire patienter le joueur devant un demi-mégaoctet.
 *
 * La scène est autonome — son propre rendu, sa propre caméra, aucun contrôle
 * d'orbite : le clic ne doit servir qu'à frapper.
 */

import * as THREE from 'three'

/** Les trois lettres, et rien d'autre. Voisines sous la main droite. */
export const MOLE_LETTERS = ['J', 'M', 'K'] as const
export type MoleLetter = (typeof MOLE_LETTERS)[number]

/**
 * Disposition des trous : deux rangées, la seconde décalée.
 *
 * Six suffisent. Sept en tenaient trop peu de place chacun, et la lettre — qui
 * est tout l'intérêt — devenait illisible.
 */
const HOLES: readonly THREE.Vector2[] = [
  new THREE.Vector2(-3.3, -1.7),
  new THREE.Vector2(0, -2.3),
  new THREE.Vector2(3.3, -1.7),
  new THREE.Vector2(-3.7, 1.9),
  new THREE.Vector2(0, 2.3),
  new THREE.Vector2(3.7, 1.9),
]

const HOLE_RADIUS = 1.25
/** Profondeur de rentrée : au-delà, la coupe fait disparaître la taupe. */
const BURROW_DEPTH = 2.4

interface Mole {
  readonly group: THREE.Group
  readonly hole: number
  readonly letter: MoleLetter
  /** 0 enfouie, 1 entièrement sortie. */
  emergence: number
  /** Vers où elle tend. */
  target: number
  /** Secondes restantes en surface avant de replonger d'elle-même. */
  patience: number
  struck: boolean
  /** Petite bascule de dépit quand elle se fait avoir. */
  recoil: number
}

export interface MoleGame {
  readonly dispose: () => void
  /** Prévient à chaque coup porté : le salon affiche le score. */
  readonly onScore: (listener: (score: number) => void) => void
}

/** La lettre, peinte dans une texture — le plus net à cette taille. */
function letterTexture(letter: string): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.fillStyle = '#f0e7d6'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#2a2018'
    ctx.font = `700 ${size * 0.62}px 'Fraunces Variable', Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(letter, size / 2, size / 2 + size * 0.04)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function mountMoleGame(container: HTMLElement): MoleGame {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  // Les taupes sont tranchées net au ras du sol : c'est ce qui les fait
  // disparaître dans leur trou sans bricoler de géométrie de galerie.
  renderer.localClippingEnabled = true

  const canvas = renderer.domElement
  canvas.className = 'mole-canvas'
  container.append(canvas)

  const scene = new THREE.Scene()
  // Vue basse et rapprochée : c'est ce qui rend la lettre du torse lisible.
  // Depuis le dessus, on ne voyait que des dos.
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 120)
  camera.position.set(0, 7.2, 13.8)
  camera.lookAt(0, 1.1, 0)

  // ------------------------------------------------------------------ lumière

  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x6b5638, 1.5))
  const sun = new THREE.DirectionalLight(0xffe6b8, 2.4)
  sun.position.set(-7, 14, 9)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -14
  sun.shadow.camera.right = 14
  sun.shadow.camera.top = 14
  sun.shadow.camera.bottom = -14
  sun.shadow.camera.far = 40
  sun.shadow.bias = -0.0015
  scene.add(sun)

  // -------------------------------------------------------------------- décor

  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const groundGeometry = track(new THREE.CircleGeometry(11, 64))
  const groundMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0x9c7f4e, roughness: 0.96 }),
  )
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // Quelques touffes d'herbe au pourtour, pour que la terre ne flotte pas.
  const tuftGeometry = track(new THREE.ConeGeometry(0.5, 1.1, 5))
  const tuftMaterial = track(new THREE.MeshStandardMaterial({ color: 0x7f9a52, roughness: 1 }))
  const tufts = new THREE.InstancedMesh(tuftGeometry, tuftMaterial, 42)
  const dummy = new THREE.Object3D()
  for (let i = 0; i < 42; i++) {
    const angle = (i / 42) * Math.PI * 2 + (i % 3) * 0.14
    const radius = 10 + ((i * 37) % 17) / 14
    dummy.position.set(Math.cos(angle) * radius, 0.5, Math.sin(angle) * radius)
    dummy.rotation.y = angle
    dummy.scale.setScalar(0.7 + ((i * 13) % 9) / 22)
    dummy.updateMatrix()
    tufts.setMatrixAt(i, dummy.matrix)
  }
  tufts.castShadow = true
  scene.add(tufts)

  // Les trous : un bourrelet de terre retournée, et un fond qu'on ne voit pas.
  const rimGeometry = track(new THREE.TorusGeometry(HOLE_RADIUS, 0.3, 8, 28))
  const rimMaterial = track(new THREE.MeshStandardMaterial({ color: 0x6f5433, roughness: 1 }))
  const pitGeometry = track(new THREE.CircleGeometry(HOLE_RADIUS, 28))
  const pitMaterial = track(new THREE.MeshBasicMaterial({ color: 0x1b1208 }))

  for (const hole of HOLES) {
    const rim = new THREE.Mesh(rimGeometry, rimMaterial)
    rim.position.set(hole.x, 0.06, hole.y)
    rim.rotation.x = -Math.PI / 2
    rim.scale.y = 0.55
    rim.receiveShadow = true
    scene.add(rim)

    const pit = new THREE.Mesh(pitGeometry, pitMaterial)
    pit.position.set(hole.x, 0.02, hole.y)
    pit.rotation.x = -Math.PI / 2
    scene.add(pit)
  }

  // ------------------------------------------------------------------- taupes

  const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  const furMaterial = track(
    new THREE.MeshStandardMaterial({
      color: 0x63503d,
      roughness: 0.85,
      clippingPlanes: [clip],
    }),
  )
  const snoutMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0xd88b8b, roughness: 0.7, clippingPlanes: [clip] }),
  )
  const eyeMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.4, clippingPlanes: [clip] }),
  )

  const bodyGeometry = track(new THREE.CapsuleGeometry(0.92, 0.72, 6, 20))
  const snoutGeometry = track(new THREE.ConeGeometry(0.3, 0.52, 12))
  const eyeGeometry = track(new THREE.SphereGeometry(0.13, 10, 8))
  const badgeGeometry = track(new THREE.CircleGeometry(0.56, 28))

  const badgeMaterials = new Map<MoleLetter, THREE.MeshBasicMaterial>()
  for (const letter of MOLE_LETTERS) {
    const texture = track(letterTexture(letter))
    badgeMaterials.set(
      letter,
      track(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          clippingPlanes: [clip],
        }),
      ),
    )
  }

  function buildMole(letter: MoleLetter): THREE.Group {
    const group = new THREE.Group()

    const body = new THREE.Mesh(bodyGeometry, furMaterial)
    body.position.y = 1.12
    body.castShadow = true
    group.add(body)

    const snout = new THREE.Mesh(snoutGeometry, snoutMaterial)
    snout.position.set(0, 1.52, 0.88)
    snout.rotation.x = Math.PI / 2
    group.add(snout)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial)
      eye.position.set(0.29 * side, 1.82, 0.76)
      group.add(eye)
    }

    // La lettre, sur le torse et inclinée vers le haut : la caméra plonge d'une
    // vingtaine de degrés, un médaillon vertical se lirait de biais.
    // Devant la fourrure, pas dedans : le rayon de la capsule est de 0,92, un
    // médaillon posé plus près du centre s'y enfonçait et ne montrait qu'une
    // calotte blanche.
    const badge = new THREE.Mesh(badgeGeometry, badgeMaterials.get(letter))
    badge.position.set(0, 1.16, 1.0)
    badge.rotation.x = -0.26
    group.add(badge)

    group.userData['letter'] = letter
    return group
  }

  const moles: Mole[] = []

  // --------------------------------------------------------------- le maillet

  const malletGroup = new THREE.Group()
  const handleGeometry = track(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 12))
  const handleMaterial = track(new THREE.MeshStandardMaterial({ color: 0x8a6434, roughness: 0.8 }))
  const headGeometry = track(new THREE.BoxGeometry(1.5, 0.9, 0.9))
  const headMaterial = track(new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.42, metalness: 0.35 }))

  const handle = new THREE.Mesh(handleGeometry, handleMaterial)
  handle.position.y = 1.5
  handle.castShadow = true
  malletGroup.add(handle)

  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.position.y = 2.85
  head.castShadow = true
  malletGroup.add(head)

  // Dressé, légèrement penché en arrière : au repos il doit se lire comme un
  // maillet prêt à frapper, pas comme un outil oublié par terre.
  malletGroup.rotation.set(-0.34, 0, -0.24)
  scene.add(malletGroup)

  // ------------------------------------------------------------------ boucle

  /** Où le maillet doit se trouver : au-dessus de la dernière taupe visée. */
  const malletTarget = new THREE.Vector3(0, 0, 1.6)

  let score = 0
  let swing = 0
  let spawnDelay = 0.9
  let elapsed = 0
  let running = true
  let frame = 0

  const listeners = new Set<(score: number) => void>()
  const announce = (): void => {
    for (const listener of listeners) listener(score)
  }

  function freeHole(): number | null {
    const taken = new Set(moles.map((mole) => mole.hole))
    const free = HOLES.map((_, index) => index).filter((index) => !taken.has(index))
    return free.length === 0 ? null : (free[Math.floor(Math.random() * free.length)] ?? null)
  }

  function freeLetter(): MoleLetter | null {
    // Une lettre à la fois : sans cela, taper « J » deviendrait ambigu.
    const taken = new Set(moles.map((mole) => mole.letter))
    const free = MOLE_LETTERS.filter((letter) => !taken.has(letter))
    return free.length === 0 ? null : (free[Math.floor(Math.random() * free.length)] ?? null)
  }

  function spawn(): void {
    const hole = freeHole()
    const letter = freeLetter()
    if (hole === null || letter === null) return

    const group = buildMole(letter)
    const position = HOLES[hole]
    if (!position) return

    group.position.set(position.x, -BURROW_DEPTH, position.y)
    group.rotation.y = (Math.random() - 0.5) * 0.7
    scene.add(group)

    // Plus le temps passe, moins elles s'attardent. Doucement : c'est une
    // distraction, pas une épreuve.
    const patience = Math.max(0.85, 2.1 - elapsed * 0.012)

    moles.push({
      group,
      hole,
      letter,
      emergence: 0,
      target: 1,
      patience,
      struck: false,
      recoil: 0,
    })
  }

  function retire(mole: Mole): void {
    scene.remove(mole.group)
    moles.splice(moles.indexOf(mole), 1)
  }

  function strike(mole: Mole): void {
    if (mole.struck || mole.emergence < 0.35) return
    mole.struck = true
    mole.target = 0
    mole.recoil = 1
    score += 1
    announce()
  }

  // ------------------------------------------------------------------ entrées

  /**
   * Une touche, une taupe.
   *
   * Toucher une lettre dont aucune taupe n'est sortie fait quand même partir le
   * maillet, à vide : rater doit se voir, sinon on ne sait pas si la touche a
   * été prise en compte.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toUpperCase()
    if (!MOLE_LETTERS.includes(key as MoleLetter)) return

    event.preventDefault()
    const mole = moles.find((candidate) => candidate.letter === key && !candidate.struck)

    const position = mole ? HOLES[mole.hole] : null
    if (position) malletTarget.set(position.x + 0.55, 0, position.y + 0.5)
    swing = 1

    if (mole) strike(mole)
  }

  window.addEventListener('keydown', onKeyDown)

  // --------------------------------------------------------------------- vue

  function resize(): void {
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  const clock = new THREE.Clock()

  function tick(): void {
    if (!running) return
    frame = requestAnimationFrame(tick)

    const delta = Math.min(clock.getDelta(), 0.05)
    elapsed += delta

    spawnDelay -= delta
    if (spawnDelay <= 0) {
      spawn()
      spawnDelay = Math.max(0.45, 1.15 - elapsed * 0.01) * (0.7 + Math.random() * 0.7)
    }

    for (const mole of [...moles]) {
      // Montée franche, plongeon plus vif encore quand le coup a porté.
      const speed = mole.target > mole.emergence ? 5.2 : mole.struck ? 9 : 4.2
      mole.emergence += Math.sign(mole.target - mole.emergence) * speed * delta
      mole.emergence = THREE.MathUtils.clamp(mole.emergence, 0, 1)

      if (mole.target === 1 && mole.emergence >= 1) {
        mole.patience -= delta
        if (mole.patience <= 0) mole.target = 0
      }

      if (mole.recoil > 0) {
        mole.recoil = Math.max(0, mole.recoil - delta * 4)
        mole.group.rotation.z = Math.sin(mole.recoil * 18) * 0.3 * mole.recoil
        mole.group.scale.set(1 + mole.recoil * 0.2, 1 - mole.recoil * 0.25, 1 + mole.recoil * 0.2)
      }

      mole.group.position.y = THREE.MathUtils.lerp(-BURROW_DEPTH, 0, mole.emergence)

      if (mole.target === 0 && mole.emergence <= 0) retire(mole)
    }

    // Le maillet se porte sur la taupe visée, puis s'abat. Le déplacement est
    // vif : à ce rythme, un maillet qui traîne arriverait après la bataille.
    malletGroup.position.lerp(malletTarget, Math.min(1, delta * 16))
    if (swing > 0) swing = Math.max(0, swing - delta * 5)
    const strikeCurve = Math.sin(swing * Math.PI)
    malletGroup.rotation.x = -0.34 + strikeCurve * 1.5
    malletGroup.rotation.z = -0.24 + strikeCurve * 0.16

    renderer.render(scene, camera)
  }

  tick()

  return {
    onScore: (listener) => {
      listeners.add(listener)
      listener(score)
    },
    dispose: () => {
      running = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      for (const mole of [...moles]) retire(mole)
      for (const item of disposables) item.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
