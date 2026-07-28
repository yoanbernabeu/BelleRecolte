/**
 * Ambiance sonore générative.
 *
 * Tout est synthétisé à la volée avec la Web Audio API : aucun fichier audio,
 * aucune requête réseau. Trois couches se superposent — un lit de vent, des
 * chants d'oiseaux épars, et une nappe harmonique très douce — dont l'intensité
 * suit la saison et la météo du tour.
 */

export interface AmbienceMood {
  /** 0 = silence, 1 = vent de tempête. */
  readonly wind: number
  /** 0 = aucun oiseau (hiver), 1 = dawn chorus de mai. */
  readonly birds: number
  /** 0 = sec, 1 = averse. */
  readonly rain: number
  /** Teinte harmonique : 0 = grave et sombre, 1 = clair et lumineux. */
  readonly brightness: number
}

const MAJOR_PENTATONIC = [0, 2, 4, 7, 9] as const
const BASE_FREQUENCY = 146.83 // ré2

function noteFrequency(semitones: number): number {
  return BASE_FREQUENCY * Math.pow(2, semitones / 12)
}

/** Buffer de bruit blanc réutilisé pour le vent et la pluie. */
function createNoiseBuffer(context: AudioContext, seconds = 4): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

export class Ambience {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private rainGain: GainNode | null = null
  private rainFilter: BiquadFilterNode | null = null
  private padGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null

  private birdTimer: number | null = null
  private padTimer: number | null = null
  private mood: AmbienceMood = { wind: 0.3, birds: 0.4, rain: 0, brightness: 0.6 }
  private enabled = false
  private volume = 0.7

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Doit être appelé depuis un geste utilisateur : les navigateurs l'exigent. */
  async enable(): Promise<void> {
    if (this.enabled) return
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const context = new Ctor()
    await context.resume()

    this.context = context
    this.noiseBuffer = createNoiseBuffer(context)

    this.master = context.createGain()
    this.master.gain.value = this.volume
    this.master.connect(context.destination)

    // --- vent : bruit rose filtré passe-bas, légèrement modulé
    const windSource = context.createBufferSource()
    windSource.buffer = this.noiseBuffer
    windSource.loop = true
    this.windFilter = context.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 420
    this.windFilter.Q.value = 0.6
    this.windGain = context.createGain()
    this.windGain.gain.value = 0
    windSource.connect(this.windFilter).connect(this.windGain).connect(this.master)
    windSource.start()

    // Modulation lente de la coupure : le vent « respire »
    const windLfo = context.createOscillator()
    const windLfoGain = context.createGain()
    windLfo.frequency.value = 0.07
    windLfoGain.gain.value = 180
    windLfo.connect(windLfoGain).connect(this.windFilter.frequency)
    windLfo.start()

    // --- pluie : bruit filtré passe-haut, plus dense et plus aigu
    const rainSource = context.createBufferSource()
    rainSource.buffer = this.noiseBuffer
    rainSource.loop = true
    this.rainFilter = context.createBiquadFilter()
    this.rainFilter.type = 'bandpass'
    this.rainFilter.frequency.value = 2400
    this.rainFilter.Q.value = 0.4
    this.rainGain = context.createGain()
    this.rainGain.gain.value = 0
    rainSource.connect(this.rainFilter).connect(this.rainGain).connect(this.master)
    rainSource.start()

    // --- nappe harmonique
    this.padGain = context.createGain()
    this.padGain.gain.value = 0.0
    const padReverb = context.createBiquadFilter()
    padReverb.type = 'lowpass'
    padReverb.frequency.value = 1800
    this.padGain.connect(padReverb).connect(this.master)

    this.enabled = true
    this.applyMood()
    this.scheduleBirds()
    this.schedulePad()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.2)
    }
  }

  setMood(mood: AmbienceMood): void {
    this.mood = mood
    this.applyMood()
  }

  private applyMood(): void {
    const context = this.context
    if (!context || !this.windGain || !this.rainGain || !this.windFilter || !this.rainFilter) return
    const now = context.currentTime

    this.windGain.gain.setTargetAtTime(0.018 + this.mood.wind * 0.075, now, 1.4)
    this.windFilter.frequency.setTargetAtTime(320 + this.mood.wind * 900, now, 1.4)
    this.rainGain.gain.setTargetAtTime(this.mood.rain * 0.085, now, 1.2)
    this.rainFilter.frequency.setTargetAtTime(1600 + this.mood.rain * 2200, now, 1.2)
  }

  /** Un chant d'oiseau : deux ou trois notes glissées, timbre sifflé. */
  private chirp(): void {
    const context = this.context
    if (!context || !this.master) return

    const notes = 2 + Math.floor(Math.random() * 3)
    const start = context.currentTime + Math.random() * 0.1
    const baseFreq = 2200 + Math.random() * 1800

    for (let i = 0; i < notes; i++) {
      const at = start + i * (0.07 + Math.random() * 0.06)
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'

      const from = baseFreq * (0.86 + Math.random() * 0.3)
      const to = from * (0.78 + Math.random() * 0.5)
      oscillator.frequency.setValueAtTime(from, at)
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(200, to), at + 0.075)

      const peak = 0.03 + Math.random() * 0.025
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09)

      // Léger placement stéréo pour que les oiseaux ne sortent pas du même point
      const panner = context.createStereoPanner()
      panner.pan.value = Math.random() * 1.6 - 0.8

      oscillator.connect(gain).connect(panner).connect(this.master)
      oscillator.start(at)
      oscillator.stop(at + 0.14)
    }
  }

  private scheduleBirds(): void {
    if (!this.enabled) return
    const density = this.mood.birds
    // Beaucoup d'oiseaux au printemps, presque aucun en janvier.
    const delay = density < 0.05 ? 9000 : 450 + (1 - density) * 6500 + Math.random() * 2200
    this.birdTimer = window.setTimeout(() => {
      if (density > 0.04 && this.mood.rain < 0.7 && Math.random() < 0.55 + density * 0.4) {
        this.chirp()
      }
      this.scheduleBirds()
    }, delay)
  }

  /** Une note tenue de la gamme pentatonique, très douce, toutes les ~8 s. */
  private playPadNote(): void {
    const context = this.context
    if (!context || !this.padGain) return

    const octave = Math.random() < 0.35 ? 12 : Math.random() < 0.6 ? 24 : 0
    const index = Math.floor(Math.random() * MAJOR_PENTATONIC.length)
    const semitone = (MAJOR_PENTATONIC[index] ?? 0) + octave
    const frequency = noteFrequency(semitone)

    const now = context.currentTime
    const duration = 5 + Math.random() * 4

    const oscillator = context.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    // Un très léger désaccord donne du corps sans sonner synthétique
    const detuned = context.createOscillator()
    detuned.type = 'sine'
    detuned.frequency.value = frequency * 1.004

    const gain = context.createGain()
    const peak = 0.02 + this.mood.brightness * 0.022
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + duration * 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    const tone = context.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 700 + this.mood.brightness * 2400

    oscillator.connect(gain)
    detuned.connect(gain)
    gain.connect(tone).connect(this.padGain)

    oscillator.start(now)
    detuned.start(now)
    oscillator.stop(now + duration + 0.1)
    detuned.stop(now + duration + 0.1)

    if (this.padGain.gain.value < 0.5) {
      this.padGain.gain.setTargetAtTime(0.6, now, 2)
    }
  }

  private schedulePad(): void {
    if (!this.enabled) return
    this.padTimer = window.setTimeout(() => {
      this.playPadNote()
      this.schedulePad()
    }, 5200 + Math.random() * 5200)
  }

  /** Petit retour sonore ponctuel pour les actions du joueur. */
  cue(kind: 'sow' | 'confirm' | 'harvest' | 'warning'): void {
    const context = this.context
    if (!context || !this.master) return
    const now = context.currentTime

    const settings: Record<typeof kind, { freqs: number[]; type: OscillatorType; decay: number }> = {
      sow: { freqs: [523.25, 659.25], type: 'sine', decay: 0.28 },
      confirm: { freqs: [392, 587.33, 784], type: 'triangle', decay: 0.5 },
      harvest: { freqs: [523.25, 659.25, 783.99, 1046.5], type: 'triangle', decay: 0.75 },
      warning: { freqs: [233.08, 220], type: 'sawtooth', decay: 0.45 },
    }
    const preset = settings[kind]

    preset.freqs.forEach((frequency, i) => {
      const at = now + i * 0.075
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 3200

      oscillator.type = preset.type
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.07, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + preset.decay)

      oscillator.connect(gain).connect(filter).connect(this.master!)
      oscillator.start(at)
      oscillator.stop(at + preset.decay + 0.05)
    })
  }

  async disable(): Promise<void> {
    if (this.birdTimer !== null) window.clearTimeout(this.birdTimer)
    if (this.padTimer !== null) window.clearTimeout(this.padTimer)
    this.birdTimer = null
    this.padTimer = null
    this.enabled = false
    if (this.context) {
      await this.context.close()
      this.context = null
    }
  }
}
