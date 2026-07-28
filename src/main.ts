import './style.css'
import { setupLanding } from './landing'
import { generateSeedCode } from './sim/rng'

const container = document.getElementById('app')
if (!container) throw new Error('Conteneur #app introuvable')

// Le type est importé sans embarquer le module : `import type` disparaît à la
// compilation, seul le `import()` dynamique déclenche le chargement.
type GameModule = typeof import('./game')

let gameModule: GameModule | null = null
let game: InstanceType<GameModule['Game']> | null = null

const landing = setupLanding((seed) => void start(seed))

async function start(seed: string): Promise<void> {
  landing.enterGame()

  // Three.js et tout le moteur de rendu ne sont téléchargés qu'ici : la page
  // d'accueil reste légère, et son premier affichage n'attend rien.
  if (!gameModule) {
    container!.classList.add('is-loading')
    gameModule = await import('./game')
    container!.classList.remove('is-loading')
  }

  game?.dispose()
  game = new gameModule.Game(container as HTMLElement, seed, (nextSeed) => {
    void start(nextSeed ?? generateSeedCode())
  })

  // En développement seulement : une prise pour inspecter la partie en cours
  // depuis la console, indispensable pour régler le rendu sans rejouer quinze
  // tours à chaque essai. Le bloc disparaît du bundle de production.
  if (import.meta.env.DEV) {
    ;(window as unknown as { belleRecolte?: unknown }).belleRecolte = game
  }
}
