import { createSystem } from "@iwsdk/core";
import { Signal } from "@preact/signals-core";
import { AudioAnalyzerSystem } from "./AudioAnalyzer.js";

/**
 * AudioReactorSystem
 *
 * Bidirectional audio-visual pipeline:
 *   - Forward: Music → AnalyserNode → frequency bands → visual signals
 *   - Reverse: Touch → parameter modulation → audio effects → analyser → visuals
 *
 * Audio chain:
 *   AudioBufferSource → [EffectsChain] → AnalyserNode → GainNode → destination
 *
 * Effects (in order):
 *   1. LowpassFilter  — sculpts overall timbre
 *   2. HighpassFilter — removes low-end mud
 *   3. Delay          — echo repeat for depth
 *   4. Reverb         — convolution-based space
 *   5. Distortion     — waveshaper for grit
 *
 * Each effect has baseline parameters that get modulated by touches.
 * Touch intensity decays back toward baseline after each interaction.
 */
export class AudioReactorSystem extends createSystem({}, {}) {
  // ── Readable signals (consumed by PsychedelicFXSystem) ──────────────────
  readonly energy = new Signal<number>(0);
  readonly bass = new Signal<number>(0);
  readonly mid = new Signal<number>(0);
  readonly treble = new Signal<number>(0);
  readonly beatDetected = new Signal<boolean>(false);
  readonly beatIntensity = new Signal<number>(0); // Direct beat intensity for PsychedelicFX
  readonly frequencyData = new Signal<Uint8Array>(new Uint8Array(256));
  readonly songDuration = new Signal<number>(394); // Song duration in seconds for rail length
  readonly pathLength = new Signal<number>(15000); // Distance for RailMovement to match song

  // ── Touch modulation state ─────────────────────────────────────────────
  // Each active touch writes its currentValue here, keyed by entity index.
  // Decays toward 0 each frame; effect parameters lerp toward touchValue × paramRange.
  readonly touchModulations = new Map<number, TouchModulation>();

  // ── Beat detection ─────────────────────────────────────────────────────
  private beatThreshold = 0.08;
  private lastBeatTime = 0;
  private beatCooldownMs = 40;
  private bassHistory: number[] = [];
  private bassHistorySize = 20;
  private averageEnergy = 0.5;
  private debugFrameCount = 0;

  // ── Analyzer output (for AudioAnalyzerSystem) ─────────────────────────
  private _analyzerSystem: AudioAnalyzerSystem | null = null;

  // ── Web Audio nodes ─────────────────────────────────────────────────────
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private frequencyBuffer = new Uint8Array(256);
  private isPlaying = false;

  // ── Effects chain ───────────────────────────────────────────────────────
  private lowpassFilter!: BiquadFilterNode;
  private highpassFilter!: BiquadFilterNode;
  private delayNode!: DelayNode;
  private delayFeedback!: GainNode;
  private reverbNode!: ConvolverNode;
  private reverbWet!: GainNode;
  private distortionNode!: WaveShaperNode;
  private distortionMix!: GainNode;
  private dryGain!: GainNode;

  // Baseline effect parameters (before touch modulation)
  private readonly BASELINE = {
    lowpassFreq: 500,
    highpassFreq: 200,
    delayTime: 0.15,
    delayFeedback: 0.2,
    reverbMix: 0.1,
    distortionDrive: 0,
    masterGain: 0.8,
  };

  // Current modulated values (lerp toward BASELINE each frame when no touch)
  private currentParams = { ...this.BASELINE };

  init() {}

  /** Call once after both systems are registered */
  setAnalyzer(analyzer: AudioAnalyzerSystem): void {
    this._analyzerSystem = analyzer;
  }

  // ─── Context & graph setup ──────────────────────────────────────────────

  initAudioContext() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();

    // Create analyser
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 512;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Create gain (master volume)
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.BASELINE.masterGain;

    // ── Build effects chain ───────────────────────────────────────────────
    // 1. Lowpass filter
    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = "lowpass";
    this.lowpassFilter.frequency.value = this.BASELINE.lowpassFreq;
    this.lowpassFilter.Q.value = 1.0;

    // 2. Highpass filter
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = "highpass";
    this.highpassFilter.frequency.value = this.BASELINE.highpassFreq;
    this.highpassFilter.Q.value = 0.7;

    // 3. Delay with feedback
    this.delayNode = this.audioContext.createDelay(2.0);
    this.delayNode.delayTime.value = this.BASELINE.delayTime;
    this.delayFeedback = this.audioContext.createGain();
    this.delayFeedback.gain.value = this.BASELINE.delayFeedback;
    // Feedback loop: delay → feedbackGain → delay
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

    // 4. Reverb (impulse-response convolution)
    this.reverbNode = this.audioContext.createConvolver();
    this.reverbWet = this.audioContext.createGain();
    this.reverbWet.gain.value = this.BASELINE.reverbMix;
    this.buildReverbImpulse();

    // 5. Distortion via waveshaper
    this.distortionNode = this.audioContext.createWaveShaper();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.distortionNode as any).curve = this.makeDistortionCurve(0);
    this.distortionNode.oversample = "2x";
    this.distortionMix = this.audioContext.createGain();
    this.distortionMix.gain.value = 0; // bypassed by default

    // Dry path (unprocessed)
    this.dryGain = this.audioContext.createGain();
    this.dryGain.gain.value = 1.0;

    // ── Connect chain ────────────────────────────────────────────────────
    // Post-filter → dry + delay + distortion → reverb wet/dry → analyser → gain → out
    this.lowpassFilter.connect(this.highpassFilter);

    // Dry path
    this.highpassFilter.connect(this.dryGain);

    // Delay path
    this.highpassFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);

    // Distortion path
    this.highpassFilter.connect(this.distortionNode);
    this.distortionNode.connect(this.distortionMix);

    // Reverb receives from delay feedback, distortion, and dry
    this.delayFeedback.connect(this.reverbNode);
    this.distortionMix.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbWet);

    // All paths converge at the analyser
    this.dryGain.connect(this.analyserNode);
    this.reverbWet.connect(this.analyserNode);

    // Analyser → master gain → destination
    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    this.frequencyBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
  }

  private buildReverbImpulse() {
    // Synthetic reverb impulse response (exponentially decaying noise)
    if (!this.audioContext) return;
    const sampleRate = this.audioContext.sampleRate;
    const length = sampleRate * 2; // 2-second reverb tail
    const impulse = this.audioContext.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.exp(-3 * i / length);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    this.reverbNode.buffer = impulse;
  }

  private makeDistortionCurve(drive: number): Float32Array {
    const k = drive * 100;
    const n = 441;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ─── Playback ──────────────────────────────────────────────────────────

  async loadSoundtrack(url: string): Promise<void> {
    this.initAudioContext();
    if (!this.audioContext || !this.analyserNode) return;
    try {
      console.log("[AudioReactor] loading:", url);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      console.log("[AudioReactor] loaded successfully, duration:", this.audioBuffer.duration, "channels:", this.audioBuffer.numberOfChannels);
      this.songDuration.value = this.audioBuffer.duration;
      // pathLength = speed (3.0) × duration so rail matches exactly
      this.pathLength.value = this.songDuration.value * 3.0;
    } catch (err) {
      console.warn("[AudioReactor] Failed to load:", url, err);
    }
  }

  play(): void {
    if (!this.audioContext || !this.audioBuffer || this.isPlaying) return;
    if (this.audioContext.state === "suspended") {
      console.log("[AudioReactor] resuming suspended audio context");
      this.audioContext.resume();
    }
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.loop = true;
    this.sourceNode.connect(this.lowpassFilter);
    this.sourceNode.start(0);
    this.isPlaying = true;
    console.log("[AudioReactor] playback started, buffer duration:", this.audioBuffer.duration);
  }

  pause(): void {
    try { this.sourceNode?.stop(); } catch {}
    this.isPlaying = false;
  }

  setGain(value: number): void {
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.1);
    }
  }

  // ─── Touch parameter modulation ────────────────────────────────────────

  /**
   * Called by GeometryTouchSystem when a touch begins.
   * `entityIndex` must be a stable unique id for the entity.
   * `param` identifies which audio parameter to modulate.
   * `touchValue` is the 0-1 normalized target (0 = baseline, 1 = max effect).
   */
  applyTouch(entityIndex: number, param: EffectParam, touchValue: number): void {
    const existing = this.touchModulations.get(entityIndex);
    if (existing && existing.param === param) {
      // Update target — don't reset decay timer
      existing.targetValue = touchValue;
    } else {
      this.touchModulations.set(entityIndex, {
        param,
        targetValue: touchValue,
        currentValue: existing?.currentValue ?? 0,
      });
    }
  }

  // ─── Frame update ───────────────────────────────────────────────────────

  update(delta: number, _time: number): void {
    if (!this.analyserNode) return;

    // 1. Decay and apply touch modulations
    this.updateTouchModulations(delta);

    // 2. Update Web Audio nodes with current parameters
    this.applyEffectParameters();

    // 3. Frequency analysis (only when playing)
    if (this.isPlaying) {
      this.analyserNode.getByteFrequencyData(this.frequencyBuffer);
      this.computeFrequencyBands();
    }

    // 4. Decay beatIntensity each frame
    this.beatIntensity.value = Math.max(0, this.beatIntensity.value - delta / 1000 * 2.0);
  }

  private updateTouchModulations(delta: number): void {
    const deltaSec = delta / 1000;
    const decayRate = 1.5; // per second

    for (const [entityIdx, mod] of this.touchModulations) {
      // Lerp currentValue toward targetValue
      const diff = mod.targetValue - mod.currentValue;
      if (Math.abs(diff) > 0.001) {
        mod.currentValue += diff * Math.min(1, deltaSec * 8);
      } else {
        // No active touch — decay toward 0
        mod.currentValue = Math.max(0, mod.currentValue - decayRate * deltaSec);
        if (mod.currentValue <= 0) {
          this.touchModulations.delete(entityIdx);
          continue;
        }
      }

      // Write the value into the currentParams mapping
      this.writeParamValue(mod.param, mod.currentValue);
    }
  }

  private writeParamValue(param: EffectParam, normalizedValue: number): void {
    const v = normalizedValue;
    switch (param) {
      case EffectParam.LOWPASS_FREQ:
        this.currentParams.lowpassFreq = this.lerp(500, 8000, v); break;
      case EffectParam.HIGHPASS_FREQ:
        this.currentParams.highpassFreq = this.lerp(200, 4000, v); break;
      case EffectParam.DELAY_FEEDBACK:
        this.currentParams.delayFeedback = this.lerp(0.2, 0.88, v); break;
      case EffectParam.DELAY_TIME:
        this.currentParams.delayTime = this.lerp(0.05, 0.6, v); break;
      case EffectParam.REVERB_MIX:
        this.currentParams.reverbMix = this.lerp(0.05, 0.95, v); break;
      case EffectParam.DISTORTION:
        this.currentParams.distortionDrive = v; break;
    }
  }

  private applyEffectParameters(): void {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    const t = 0.05; // smoothing time constant

    this.lowpassFilter.frequency.setTargetAtTime(this.currentParams.lowpassFreq, now, t);
    this.highpassFilter.frequency.setTargetAtTime(this.currentParams.highpassFreq, now, t);
    this.delayNode.delayTime.setTargetAtTime(this.currentParams.delayTime, now, t);
    this.delayFeedback.gain.setTargetAtTime(this.currentParams.delayFeedback, now, t);
    this.reverbWet.gain.setTargetAtTime(this.currentParams.reverbMix, now, t);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.distortionNode as any).curve = this.makeDistortionCurve(this.currentParams.distortionDrive);
    // Crossfade distortion in/out
    const distGain = this.currentParams.distortionDrive > 0.01 ? 1.0 : 0.0;
    this.distortionMix.gain.setTargetAtTime(distGain, now, t);
  }

  private computeFrequencyBands(): void {
    const bins = this.frequencyBuffer;
    const len = bins.length;
    const bassEnd = Math.floor(len * 0.25);
    const midEnd = Math.floor(len * 0.6);

    let sum = 0, bassSum = 0, midSum = 0, trebleSum = 0;
    for (let i = 0; i < len; i++) {
      const norm = bins[i] / 255.0;
      sum += norm;
      if (i < bassEnd) bassSum += norm;
      else if (i < midEnd) midSum += norm;
      else trebleSum += norm;
    }

    const e = sum / len;
    const b = bassSum / bassEnd;
    const m = midSum / (midEnd - bassEnd);
    const tr = trebleSum / (len - midEnd);

    // Keep bass history for beat detection
    this.bassHistory.push(b);
    if (this.bassHistory.length > this.bassHistorySize) {
      this.bassHistory.shift();
    }

    const smooth = 0.6;
    this.energy.value = this.energy.value * smooth + e * (1 - smooth);
    this.bass.value = this.bass.value * smooth + b * (1 - smooth);
    this.mid.value = this.mid.value * smooth + m * (1 - smooth);
    this.treble.value = this.treble.value * smooth + tr * (1 - smooth);

    const slice = new Uint8Array(256);
    slice.set(bins.subarray(0, 256));
    this.frequencyData.value = slice;

    // Downbeat detection: ANY significant bass spike above rolling average
    const now = performance.now();
    const bassAvg = this.bassHistory.length > 0
      ? this.bassHistory.reduce((a, v) => a + v, 0) / this.bassHistory.length
      : 0;
    // Lower threshold from 1.3 to 1.15 to fire more consistently
    const isBassHit = bassAvg > 0 && b > bassAvg * 1.15;
    const beatFired = isBassHit && now - this.lastBeatTime > this.beatCooldownMs;

    this.beatDetected.value = beatFired;
    this.beatIntensity.value = beatFired ? 1.0 : this.beatIntensity.value;
    if (beatFired) {
      this.lastBeatTime = now;
      console.log("[Vortexr] BEAT! bass=" + b.toFixed(3) + " avg=" + bassAvg.toFixed(3));
    }

    // Debug: log bass values every 60 frames so we can see what's happening
    this.debugFrameCount++;
    if (this.debugFrameCount >= 60) {
      this.debugFrameCount = 0;
      console.log("[Vortexr] bass=" + b.toFixed(3) + " avg=" + bassAvg.toFixed(3) + " isPlaying=" + this.isPlaying + " historyLen=" + this.bassHistory.length);
    }

    // Feed frame data to AudioAnalyzerSystem for VisualDNA generation
    this._analyzerSystem?.ingestFrame(b, m, tr, e, this.frequencyData.value, this.isPlaying);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }

  /** Get current modulated value for a parameter (for debugging/UI) */
  getParamValue(param: EffectParam): number {
    switch (param) {
      case EffectParam.LOWPASS_FREQ: return this.currentParams.lowpassFreq;
      case EffectParam.HIGHPASS_FREQ: return this.currentParams.highpassFreq;
      case EffectParam.DELAY_FEEDBACK: return this.currentParams.delayFeedback;
      case EffectParam.DELAY_TIME: return this.currentParams.delayTime;
      case EffectParam.REVERB_MIX: return this.currentParams.reverbMix;
      case EffectParam.DISTORTION: return this.currentParams.distortionDrive;
    }
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TouchModulation {
  param: EffectParam;
  targetValue: number;   // 0-1 normalized target
  currentValue: number;  // current interpolated value, decays to 0
}

export enum EffectParam {
  LOWPASS_FREQ   = "lowpass_freq",
  HIGHPASS_FREQ  = "highpass_freq",
  DELAY_FEEDBACK = "delay_feedback",
  DELAY_TIME     = "delay_time",
  REVERB_MIX     = "reverb_mix",
  DISTORTION     = "distortion",
}