/**
 * Le parcours d'avant-partie.
 *
 * Organiser ou rejoindre, patienter au salon, donner le départ. Tout ce qui se
 * passe avant que le chrono ne parte, et rien de ce qui vient après.
 */

import { createSession, SessionClient, type SessionView } from '../../session/client'
import { SESSION_CODE_LENGTH, SESSION_DURATION_MS } from '../../session/protocol'
import { playerId } from '../../session/storage'
import { generateSeedCode } from '../../sim/rng'

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

export interface SessionLaunch {
  readonly client: SessionClient
  readonly seed: string
  readonly pseudo: string
  /** Faux quand l'animateur a choisi de rester à la régie. */
  readonly playing: boolean
}

type Mode = 'create' | 'join'

/**
 * Ouvre le parcours et appelle `onLaunch` quand la partie démarre.
 * L'appelant décide alors de lancer le jeu ou d'afficher la régie.
 */
export function openSessionFlow(mode: Mode, onLaunch: (launch: SessionLaunch) => void): void {
  const overlay = el('div', 'overlay session-overlay')
  const card = el('div', 'overlay-card session-card')
  overlay.append(card)
  document.body.append(overlay)

  const close = (): void => overlay.remove()

  const form = el('form', 'session-form')
  card.append(
    el('h1', 'title', mode === 'create' ? 'Organiser une session' : 'Rejoindre une session'),
  )

  const pseudo = el('input', 'session-input')
  pseudo.type = 'text'
  pseudo.maxLength = 24
  pseudo.autocomplete = 'off'
  pseudo.placeholder = 'Votre nom ou celui de l’équipe'
  form.append(labelled('Nom affiché au classement', pseudo))

  let codeInput: HTMLInputElement | null = null
  let plays: HTMLInputElement | null = null

  if (mode === 'join') {
    codeInput = el('input', 'session-input mono')
    codeInput.type = 'text'
    codeInput.maxLength = SESSION_CODE_LENGTH
    codeInput.autocapitalize = 'characters'
    codeInput.placeholder = 'Code annoncé par l’organisateur'
    codeInput.addEventListener('input', () => {
      const cleaned = codeInput!.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (cleaned !== codeInput!.value) codeInput!.value = cleaned
    })
    form.append(labelled('Code de session', codeInput))
  } else {
    plays = el('input')
    plays.type = 'checkbox'
    plays.checked = true
    const row = el('label', 'session-check')
    row.append(plays, el('span', '', 'Je participe à la partie'))
    form.append(row)
    form.append(
      el(
        'p',
        'muted',
        'Décochez pour rester à la régie : votre poste n’affichera que le chrono, ' +
          'puis le classement.',
      ),
    )
  }

  const error = el('p', 'session-error')
  error.hidden = true

  const submit = el('button', 'primary-button')
  submit.type = 'submit'
  submit.textContent = mode === 'create' ? 'Créer la session' : 'Rejoindre'

  const cancel = el('button', 'ghost-button', 'Annuler')
  cancel.type = 'button'
  cancel.addEventListener('click', close)

  const buttons = el('div', 'button-row')
  buttons.append(submit, cancel)
  form.append(error, buttons)
  card.append(form)

  window.setTimeout(() => pseudo.focus(), 50)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = pseudo.value.trim()
    if (!name) return fail('Indiquez un nom : le classement en a besoin.')
    if (mode === 'join' && (codeInput?.value.length ?? 0) < SESSION_CODE_LENGTH) {
      return fail('Le code de session est incomplet.')
    }

    submit.disabled = true
    error.hidden = true

    const wanted = mode === 'create' ? undefined : codeInput!.value

    void enter(name, wanted, plays?.checked ?? true).catch((reason: unknown) => {
      submit.disabled = false
      fail(reason instanceof Error ? reason.message : 'Connexion impossible.')
    })
  })

  function fail(message: string): void {
    error.textContent = message
    error.hidden = false
  }

  async function enter(name: string, wanted: string | undefined, playing: boolean): Promise<void> {
    const me = playerId()
    const seed = generateSeedCode()
    const code = wanted ?? (await createSession(seed, me, SESSION_DURATION_MS))

    const client = new SessionClient(code, me, name)
    showLobby(card, client, name, playing, (launch) => {
      close()
      onLaunch(launch)
    })
    client.connect()
  }
}

function labelled(text: string, field: HTMLElement): HTMLElement {
  const wrapper = el('label', 'session-field')
  wrapper.append(el('span', 'session-label', text), field)
  return wrapper
}

/**
 * Le salon d'attente.
 *
 * L'organisateur y voit la salle se remplir et garde la main sur le départ :
 * c'est lui qui sait si tout le monde est prêt, pas un compteur.
 */
function showLobby(
  card: HTMLElement,
  client: SessionClient,
  pseudo: string,
  playing: boolean,
  onLaunch: (launch: SessionLaunch) => void,
): void {
  card.replaceChildren()
  card.append(el('h1', 'title', 'Salon d’attente'))

  const codeBlock = el('div', 'session-code-block')
  const codeValue = el('strong', 'session-code', '····')
  codeBlock.append(el('span', 'session-label', 'Code à annoncer'), codeValue)
  card.append(codeBlock)

  const seedLine = el('p', 'muted')
  card.append(seedLine)

  const list = el('ul', 'session-players')
  card.append(el('h2', 'section-title', 'Joueurs connectés'), list)

  const note = el('p', 'session-note')
  card.append(note)

  const arcade = mountWaitingGame(card)

  const launch = el('button', 'primary-button', 'Donner le départ')
  launch.hidden = true
  launch.addEventListener('click', () => {
    launch.disabled = true
    client.start(playing)
  })
  const buttons = el('div', 'button-row')
  buttons.append(launch)
  card.append(buttons)

  let launched = false

  client.onChange((view: SessionView) => {
    if (view.error) {
      note.textContent = view.error
      note.classList.add('is-bad')
      launch.hidden = true
      return
    }

    if (view.phase === 'salon') {
      codeValue.textContent = view.code
      seedLine.textContent = view.seed ? `Campagne ${view.seed} — la même pour tout le monde.` : ''
      renderPlayers(list, view)
      launch.hidden = !view.host
      note.classList.remove('is-bad')
      note.textContent = view.host
        ? 'Le départ ferme la porte : personne ne pourra plus rejoindre.'
        : 'En attente du départ donné par l’organisateur.'
    }

    if (view.phase === 'jeu' && !launched) {
      launched = true
      arcade.dispose()
      onLaunch({ client, seed: view.seed, pseudo, playing })
    }
  })
}

/**
 * Le passe-temps de l'attente.
 *
 * Il se monte pour tout le monde — organisateur comme joueurs déjà arrivés — et
 * disparaît sans un mot au top départ. Le score ne sort jamais de ce poste :
 * c'est une distraction, pas une manche préliminaire.
 *
 * La scène est chargée à la demande. Si la 3D n'est pas disponible, le salon
 * reste simplement ce qu'il était.
 */
function mountWaitingGame(card: HTMLElement): { dispose: () => void } {
  const block = el('div', 'mole-block')

  const head = el('div', 'mole-head')
  const title = el('span', 'session-label', 'En attendant — tapez les taupes')
  const score = el('strong', 'mole-score', '0')
  head.append(title, score)

  const stage = el('div', 'mole-stage')
  // Les lettres ne sont jamais énoncées : on les lit sur la taupe.
  const hint = el('p', 'mole-hint', 'Appuyez sur la lettre que porte la taupe')

  block.append(head, stage, hint)
  card.append(block)

  let game: { dispose: () => void } | null = null
  let cancelled = false

  void import('../../render/moleGame')
    .then(({ mountMoleGame }) => {
      if (cancelled) return
      const mounted = mountMoleGame(stage)
      mounted.onScore((value) => {
        score.textContent = String(value)
      })
      game = mounted
    })
    .catch(() => {
      block.remove()
    })

  return {
    dispose: () => {
      cancelled = true
      game?.dispose()
      block.remove()
    },
  }
}

function renderPlayers(list: HTMLElement, view: SessionView): void {
  list.replaceChildren()
  for (const player of view.players) {
    const item = el('li', player.connected ? 'session-player' : 'session-player is-away')
    item.append(el('span', 'session-dot'), el('span', '', player.pseudo))
    list.append(item)
  }
  if (view.players.length === 0) list.append(el('li', 'muted', 'Personne pour l’instant.'))
}
