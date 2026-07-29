import './style.css'
import { setupLanding } from './landing'
import { generateSeedCode } from './sim/rng'
import type { SessionContext } from './game'
import { SESSION_KEY } from './session/storage'

const container = document.getElementById('app')
if (!container) throw new Error('Conteneur #app introuvable')

// Le type est importé sans embarquer le module : `import type` disparaît à la
// compilation, seul le `import()` dynamique déclenche le chargement.
type GameModule = typeof import('./game')

let gameModule: GameModule | null = null
let game: InstanceType<GameModule['Game']> | null = null

const landing = setupLanding((seed) => void start(seed))

async function start(seed: string, session?: SessionContext): Promise<void> {
  landing.enterGame()

  // Three.js et tout le moteur de rendu ne sont téléchargés qu'ici : la page
  // d'accueil reste légère, et son premier affichage n'attend rien.
  if (!gameModule) {
    container!.classList.add('is-loading')
    gameModule = await import('./game')
    container!.classList.remove('is-loading')
  }

  game?.dispose()
  game = new gameModule.Game(
    container as HTMLElement,
    seed,
    (nextSeed) => {
      // En session, la campagne ne se rejoue pas : on quitte proprement.
      if (session) {
        session.client.dispose()
        landing.leaveGame()
        return
      }
      void start(nextSeed ?? generateSeedCode())
    },
    session,
  )

  // En développement seulement : une prise pour inspecter la partie en cours
  // depuis la console, indispensable pour régler le rendu sans rejouer quinze
  // tours à chaque essai. Le bloc disparaît du bundle de production.
  if (import.meta.env.DEV) {
    ;(window as unknown as { belleRecolte?: unknown }).belleRecolte = game
  }
}

// ------------------------------------------------------------------ sessions

/**
 * Tout le dispositif multijoueur vit derrière ces trois lignes.
 *
 * Le module d'amorçage n'est téléchargé qu'au clic sur « Organiser » ou
 * « Rejoindre », ou quand ce navigateur porte la trace d'une session en cours.
 * Un visiteur venu jouer seul n'en charge pas un octet — c'est la même
 * discipline que pour le moteur 3D.
 */
const launcher = (seed: string, session?: SessionContext): void => void start(seed, session)

document
  .getElementById('session-create')
  ?.addEventListener('click', () => void import('./session/bootstrap').then((m) => m.openSession('create', launcher)))

document
  .getElementById('session-join')
  ?.addEventListener('click', () => void import('./session/bootstrap').then((m) => m.openSession('join', launcher)))

// Un test à un octet, plutôt que de charger le module pour découvrir qu'il n'y
// a rien à reprendre.
if (localStorage.getItem(SESSION_KEY)) {
  void import('./session/bootstrap').then((m) => m.resume(launcher))
}
