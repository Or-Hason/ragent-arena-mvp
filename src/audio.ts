/**
 * Procedural audio engine built entirely on the Web Audio API.
 * All sounds are synthesised — no external audio files required.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private playerOsc: OscillatorNode | null = null;
  private playerGain: GainNode | null = null;
  private npcOsc: OscillatorNode | null = null;
  private npcGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private skidGain: GainNode | null = null;

  private hornOsc1: OscillatorNode | null = null;
  private hornOsc2: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;
  private hornActive = false;

  public isInitialized = false;
  public masterVolume = 0.5;

  /** Creates the AudioContext and all persistent oscillator nodes. Must be called from a user gesture. */
  init() {
    if (this.isInitialized) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // White-noise buffer used by skid and crash sounds.
    const bufferSize = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) { output[i] = Math.random() * 2 - 1; }

    // Player engine: sawtooth → lowpass filter → gain.
    this.playerOsc = this.ctx.createOscillator(); this.playerOsc.type = 'sawtooth';
    this.playerGain = this.ctx.createGain(); this.playerGain.gain.value = 0;
    const pFilter = this.ctx.createBiquadFilter(); pFilter.type = 'lowpass'; pFilter.frequency.value = 1000;
    this.playerOsc.connect(pFilter); pFilter.connect(this.playerGain); this.playerGain.connect(this.ctx.destination);

    // NPC engine: same chain with a slightly darker filter.
    this.npcOsc = this.ctx.createOscillator(); this.npcOsc.type = 'sawtooth';
    this.npcGain = this.ctx.createGain(); this.npcGain.gain.value = 0;
    const nFilter = this.ctx.createBiquadFilter(); nFilter.type = 'lowpass'; nFilter.frequency.value = 800;
    this.npcOsc.connect(nFilter); nFilter.connect(this.npcGain); this.npcGain.connect(this.ctx.destination);

    // Skid: looped white noise passed through a high-pass filter.
    const skidSource = this.ctx.createBufferSource();
    skidSource.buffer = this.noiseBuffer; skidSource.loop = true;
    const skidFilter = this.ctx.createBiquadFilter();
    skidFilter.type = 'highpass'; skidFilter.frequency.value = 2500;
    this.skidGain = this.ctx.createGain(); this.skidGain.gain.value = 0;
    skidSource.connect(skidFilter); skidFilter.connect(this.skidGain); this.skidGain.connect(this.ctx.destination);

    // Horn: two-tone square-wave chord (350 Hz + 440 Hz) through a low-pass.
    this.hornGain = this.ctx.createGain(); this.hornGain.gain.value = 0;
    this.hornGain.connect(this.ctx.destination);
    this.hornOsc1 = this.ctx.createOscillator(); this.hornOsc1.type = 'square'; this.hornOsc1.frequency.value = 350;
    this.hornOsc2 = this.ctx.createOscillator(); this.hornOsc2.type = 'square'; this.hornOsc2.frequency.value = 440;
    const hornFilter = this.ctx.createBiquadFilter(); hornFilter.type = 'lowpass'; hornFilter.frequency.value = 600;
    this.hornOsc1.connect(hornFilter); this.hornOsc2.connect(hornFilter);
    hornFilter.connect(this.hornGain);
    this.hornOsc1.start(); this.hornOsc2.start();

    this.playerOsc.start(); this.npcOsc.start(); skidSource.start();
    this.isInitialized = true;
    this.resumeContext();
  }

  /** Resumes the AudioContext if it was suspended (e.g. by the browser autoplay policy). */
  resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => { });
  }

  /** Suspends the AudioContext, silencing all audio (used on pause / game-over). */
  pauseContext() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => { });
  }

  /**
   * Plays a single countdown beep.
   * @param isGo True for the final "GO!" cue (higher pitch, longer decay).
   */
  playCountdownSound(isGo: boolean) {
    if (!this.ctx) return;
    this.resumeContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = isGo ? 880 : 440;
    const dur = isGo ? 0.6 : 0.3;
    gain.gain.setValueAtTime(this.masterVolume * 0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(); osc.stop(this.ctx.currentTime + dur);
  }

  /** Plays an arcade-style arpeggio for Win (going up) or Lose (going down). */
  playEndSound(isWin: boolean) {
    if (!this.ctx) return;
    this.resumeContext();
    const t = this.ctx.currentTime;
    // Win: A major arpeggio (A4, C#5, E5, A5)
    // Lose: Descending minor-sounding/dissonant sequence (A4, G#4, G4, F4)
    const notes = isWin ? [440, 554.37, 659.25, 880] : [440, 415.30, 392.00, 349.23];

    for (let i = 0; i < notes.length; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      // Sine for win (clean, happy), sawtooth for lose (harsh)
      osc.type = isWin ? 'sine' : 'sawtooth';
      osc.frequency.value = notes[i];

      // Start silent, ramp up quickly, exponential fade out
      gain.gain.setValueAtTime(0, t + i * 0.15);
      gain.gain.linearRampToValueAtTime(this.masterVolume * 0.4, t + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, t + i * 0.15 + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.4);
    }
  }

  setVolume(vol: number) { this.masterVolume = vol; }

  /** Turns the horn on or off. Edge-detected so it only acts on state changes. */
  setHorn(on: boolean) {
    if (!this.ctx || !this.hornGain || this.hornActive === on) return;
    this.hornActive = on;
    if (on) {
      this.hornGain.gain.setTargetAtTime(0.25 * this.masterVolume, this.ctx.currentTime, 0.02);
    } else {
      this.hornGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  /** Plays a short white-noise burst scaled by collision intensity. */
  playCrashSound(intensity: number) {
    if (!this.ctx || !this.noiseBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 400 + (intensity * 40);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.min(intensity * 0.05, 1) * this.masterVolume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
    source.start(); source.stop(this.ctx.currentTime + 0.3);
  }

  /**
   * Updates the continuous engine and skid sounds every frame.
   * Should be called even when silent (with zeros) so sounds fade out correctly.
   */
  updateEngineSound(
    pThrottle: number, pSpeed: number,
    nThrottle: number, nSpeed: number,
    dist: number, isSkidding: boolean
  ) {
    if (!this.isInitialized || !this.ctx) return;
    this.resumeContext();

    if (this.playerOsc && this.playerGain) {
      this.playerOsc.frequency.setTargetAtTime(50 + (Math.abs(pSpeed) * 2.5) + (pThrottle * 40), this.ctx.currentTime, 0.1);
      this.playerGain.gain.setTargetAtTime((0.1 + (pThrottle * 0.1) + (Math.abs(pSpeed) / 60) * 0.1) * this.masterVolume, this.ctx.currentTime, 0.1);
    }

    if (this.npcOsc && this.npcGain) {
      this.npcOsc.frequency.setTargetAtTime(50 + (Math.abs(nSpeed) * 2.5) + (nThrottle * 40), this.ctx.currentTime, 0.1);
      const distanceMod = Math.max(0, 1 - (dist / 100));
      this.npcGain.gain.setTargetAtTime((0.05 + (nThrottle * 0.1) + (Math.abs(nSpeed) / 60) * 0.1) * this.masterVolume * distanceMod, this.ctx.currentTime, 0.1);
    }

    if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(isSkidding ? 0.3 * this.masterVolume : 0, this.ctx.currentTime, 0.05);
    }
  }

  /** Forcibly stops all continuous background sounds (engines, skid). */
  stopEngines() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Cancel any ongoing exponential/linear ramps and force gain to 0 instantly
    if (this.playerGain) {
      this.playerGain.gain.cancelScheduledValues(t);
      this.playerGain.gain.setValueAtTime(this.playerGain.gain.value, t);
      this.playerGain.gain.linearRampToValueAtTime(0, t + 0.1);
    }
    if (this.npcGain) {
      this.npcGain.gain.cancelScheduledValues(t);
      this.npcGain.gain.setValueAtTime(this.npcGain.gain.value, t);
      this.npcGain.gain.linearRampToValueAtTime(0, t + 0.1);
    }
    if (this.skidGain) {
      this.skidGain.gain.cancelScheduledValues(t);
      this.skidGain.gain.setValueAtTime(this.skidGain.gain.value, t);
      this.skidGain.gain.linearRampToValueAtTime(0, t + 0.1);
    }
  }
}