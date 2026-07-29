/**
 * Le chrono commun.
 *
 * Il ne compte pas le temps de ce poste mais celui de la salle : l'heure de
 * départ vient du serveur, et chaque poste corrige l'écart de sa propre
 * horloge. Une machine mal réglée joue donc exactement aussi longtemps que les
 * autres.
 */

import type { SessionClient } from '../../session/client'

/** Sous ce seuil, le bandeau s'alarme. */
const WARNING_MS = 5 * 60 * 1000
const CRITICAL_MS = 60 * 1000

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export class TimerBanner {
  readonly root: HTMLElement
  private readonly value: HTMLElement
  private frame = 0
  private fired = false

  constructor(
    parent: HTMLElement,
    private readonly client: SessionClient,
    private readonly onExpire: () => void,
  ) {
    this.root = document.createElement('div')
    this.root.className = 'session-timer'

    const label = document.createElement('span')
    label.className = 'session-timer-label'
    label.textContent = 'Temps restant'

    this.value = document.createElement('strong')
    this.value.className = 'session-timer-value'
    this.value.textContent = '--:--'

    this.root.append(label, this.value)
    parent.append(this.root)

    this.tick()
  }

  private tick = (): void => {
    const remaining = this.client.remainingMs()

    if (remaining !== null) {
      this.value.textContent = formatRemaining(remaining)
      this.root.classList.toggle('is-warning', remaining <= WARNING_MS && remaining > CRITICAL_MS)
      this.root.classList.toggle('is-critical', remaining <= CRITICAL_MS)

      if (remaining <= 0 && !this.fired) {
        this.fired = true
        this.onExpire()
        return
      }
    }

    this.frame = window.setTimeout(this.tick, 250)
  }

  dispose(): void {
    window.clearTimeout(this.frame)
    this.root.remove()
  }
}
