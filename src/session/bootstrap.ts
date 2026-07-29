/**
 * Amorçage des sessions.
 *
 * Tout ce module est chargé à la demande : au clic sur « Organiser » ou
 * « Rejoindre », ou au retour d'un poste qui avait une session en cours. Un
 * visiteur venu jouer seul n'en télécharge pas une ligne.
 */

import { SessionClient } from './client'
import { clearSession, isLive, loadSession, playerId } from './storage'
import type { SessionContext } from '../game'

/** Lance le jeu, fourni par l'appelant pour ne pas dupliquer le chargement. */
export type Launcher = (seed: string, session?: SessionContext) => void

export async function openSession(mode: 'create' | 'join', launch: Launcher): Promise<void> {
  const { openSessionFlow } = await import('../ui/session/flow')

  openSessionFlow(mode, (started) => {
    const view = started.client.state

    if (!started.playing) {
      void import('../ui/session/control').then(({ ControlRoom }) => {
        const room = new ControlRoom(document.body, started.client, () => room.dispose())
      })
      return
    }

    launch(started.seed, {
      client: started.client,
      code: view.code,
      pseudo: started.pseudo,
      host: view.host,
    })
  })
}

/**
 * Reprise après incident.
 *
 * Un onglet fermé par erreur, un navigateur qui plante : tant que le chrono
 * commun n'est pas écoulé, le joueur retrouve sa campagne exactement là où il
 * l'avait laissée. Le temps, lui, n'a pas été suspendu pendant la panne — c'est
 * le prix de l'incident, et c'est ce qui garde la course équitable.
 */
export function resume(launch: Launcher): void {
  const saved = loadSession()
  if (!saved) return

  if (!isLive(saved)) {
    clearSession()
    return
  }

  const client = new SessionClient(saved.code, playerId(), saved.pseudo)
  client.resume(saved.startedAt, saved.durationMs)
  client.connect()

  launch(saved.seed, {
    client,
    code: saved.code,
    pseudo: saved.pseudo,
    host: saved.host,
    resume: saved.journal,
  })
}
