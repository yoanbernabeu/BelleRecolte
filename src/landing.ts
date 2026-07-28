/**
 * Page d'accueil.
 *
 * Le contenu est écrit en dur dans index.html : il est donc lisible par un
 * robot d'indexation et s'affiche avant même que le JavaScript ne s'exécute.
 * Ce module ne fait qu'animer ce qui existe déjà — le code de campagne, les
 * records, la ferme du bandeau d'accueil, et le passage au jeu.
 *
 * Le moteur 3D pèse plus de 500 ko : il n'a rien à faire dans le chemin
 * critique. Il reste donc chargé à la demande, après le premier affichage et
 * quand le fil d'exécution est libre — jamais avant. La capture qui illustre le
 * bandeau tient la place jusque-là, et reste seule sur les appareils où faire
 * tourner une scène 3D serait déplacé.
 */

import { generateSeedCode } from './sim/rng'
import { loadRecords, type Record } from './ui/records'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`
}

function renderRecords(slot: HTMLElement, records: readonly Record[]): void {
  slot.replaceChildren()
  if (records.length === 0) return

  const block = el('div', 'lp-records')
  block.append(el('h3', '', 'Vos meilleures campagnes'))

  const table = el('table', 'lp-records-table')
  const head = el('tr')
  head.append(el('th', '', 'Code'), el('th', '', 'Année'), el('th', '', 'Récolte'), el('th', '', 'Marge'))
  table.append(head)

  for (const record of records.slice(0, 5)) {
    const row = el('tr')
    row.append(
      el('td', 'mono', record.seed),
      el('td', '', record.yearName),
      el('td', '', `${record.tonnes.toFixed(0)} t`),
      el('td', '', euros(record.margin)),
    )
    table.append(row)
  }
  block.append(table)
  slot.append(block)
}

export interface LandingHandles {
  /** Masque la page et révèle le conteneur du jeu. */
  readonly enterGame: () => void
  /** Réaffiche la page d'accueil après une partie. */
  readonly leaveGame: () => void
}

interface NetworkHints {
  readonly saveData?: boolean
  readonly effectiveType?: string
}

/**
 * Faut-il animer le bandeau ?
 *
 * Trois refus, tous justifiés côté visiteur plutôt que côté machine : une
 * préférence système pour les animations réduites, un forfait mesuré ou une
 * connexion lente, et les écrans étroits où la scène serait de toute façon
 * illisible et coûterait cher en batterie.
 */
function shouldAnimateHero(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (window.innerWidth < 760) return false

  const connection = (navigator as Navigator & { connection?: NetworkHints }).connection
  if (connection?.saveData) return false
  if (connection?.effectiveType && /^(slow-)?2g$|^3g$/.test(connection.effectiveType)) return false

  return true
}

/** Repousse le travail jusqu'à ce que le navigateur n'ait plus rien d'urgent. */
function whenIdle(run: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback
  if (idle) idle(run)
  else window.setTimeout(run, 900)
}

/**
 * Remplace la capture du bandeau par la scène 3D, une fois celle-ci prête.
 * Le module n'est demandé qu'ici : tant que cette fonction n'est pas appelée,
 * ni Three.js ni le monde ne sont téléchargés.
 */
function mountHeroWhenReady(frame: HTMLElement): void {
  if (!shouldAnimateHero()) return

  const start = (): void => {
    whenIdle(() => {
      void import('./render/heroScene')
        .then(({ mountHeroScene }) => {
          const stage = el('div', 'lp-stage-live')
          // La scène se glisse dans le décor, au-dessus de la capture et sous
          // les voiles de lisibilité : le texte reste lisible sans retouche.
          frame.querySelector('.lp-stage')?.append(stage)
          mountHeroScene(stage)
          // Le fondu attend une image rendue, sinon on découvrirait un cadre
          // noir le temps que la scène se construise.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => frame.classList.add('is-live'))
          })
        })
        .catch(() => {
          // Une scène qui ne se charge pas n'est pas un incident : la capture
          // reste en place et la page fonctionne à l'identique.
        })
    })
  }

  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

export function setupLanding(onPlay: (seed: string) => void): LandingHandles {
  const landing = document.getElementById('landing')
  const app = document.getElementById('app')
  const seedInput = document.getElementById('landing-seed')
  const form = document.getElementById('start-form')
  const reroll = document.getElementById('reroll')
  const ctaBottom = document.getElementById('cta-bottom')
  const recordsSlot = document.getElementById('records-slot')
  const heroFrame = document.getElementById('hero-frame')

  if (!landing || !app || !(seedInput instanceof HTMLInputElement) || !form) {
    throw new Error('Structure de la page d’accueil introuvable')
  }

  // Chrome restaure la valeur saisie précédemment au rechargement, malgré
  // `autocomplete="off"`. On impose donc un code neuf au chargement et au
  // retour depuis le cache de navigation.
  const freshCode = (): void => {
    seedInput.value = generateSeedCode()
  }
  freshCode()
  window.addEventListener('pageshow', freshCode)

  if (recordsSlot) renderRecords(recordsSlot, loadRecords())
  if (heroFrame) mountHeroWhenReady(heroFrame)

  reroll?.addEventListener('click', () => {
    freshCode()
    seedInput.focus()
  })

  // On n'accepte que lettres, chiffres et tirets : le code sert de graine et
  // doit rester lisible et retranscriptible à la main.
  seedInput.addEventListener('input', () => {
    const cleaned = seedInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (cleaned !== seedInput.value) seedInput.value = cleaned
  })

  const play = (): void => {
    const seed = seedInput.value.trim() || generateSeedCode()
    onPlay(seed.toUpperCase())
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    play()
  })
  ctaBottom?.addEventListener('click', play)

  return {
    enterGame: () => {
      landing.classList.add('is-leaving')
      document.body.classList.add('is-playing')
      app.hidden = false
      // On retire la page du flux après la transition, pour qu'elle ne capte
      // plus ni le défilement ni le focus clavier pendant la partie.
      window.setTimeout(() => {
        landing.hidden = true
      }, 480)
    },
    leaveGame: () => {
      landing.hidden = false
      landing.classList.remove('is-leaving')
      document.body.classList.remove('is-playing')
      app.hidden = true
      if (recordsSlot) renderRecords(recordsSlot, loadRecords())
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    },
  }
}
