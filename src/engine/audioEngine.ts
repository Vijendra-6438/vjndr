import { CameraMode, RoadSurface, VehicleId, WeatherType } from '../types/game';
import { VEHICLES } from '../data/vehicles';

type EngineProfileKey = VehicleId | 'car';

interface VehicleEngineProfile {
  baseHz: number;
  maxHz: number;
  cylWave: OscillatorType;
  subWave: OscillatorType;
  subGain: number;
  harm1Ratio: number;
  harm1Wave: OscillatorType;
  harm1Gain: number;
  harm2Ratio: number;
  harm2Wave: OscillatorType;
  harm2Gain: number;
  filterMinHz: number;
  filterMaxHz: number;
  filterQ: number;
  interiorGain: number;
  exteriorGain: number;
  turboStrength: number; // 0 for naturally aspirated V12
  turboBaseHz: number;
  turboSpanHz: number;
  hasAirBrakes: boolean;
  hasV12Overrun: boolean;
}

const ENGINE_PROFILES: Record<EngineProfileKey, VehicleEngineProfile> = {
  // Mahindra Scorpio: rugged 2.2L mHawk 4-cylinder turbo diesel SUV
  scorpio: {
    baseHz: 33,
    maxHz: 118,
    cylWave: 'sawtooth',
    subWave: 'triangle',
    subGain: 0.78,
    harm1Ratio: 1.5,
    harm1Wave: 'sawtooth',
    harm1Gain: 0.26,
    harm2Ratio: 2.0,
    harm2Wave: 'triangle',
    harm2Gain: 0.14,
    filterMinHz: 540,
    filterMaxHz: 1750,
    filterQ: 2.5,
    interiorGain: 0.16,
    exteriorGain: 0.24,
    turboStrength: 1.0,
    turboBaseHz: 980,
    turboSpanHz: 1450,
    hasAirBrakes: false,
    hasV12Overrun: false,
  },
  // Bus: heavy 7.2L OM926 6-cylinder diesel coach with deep bass & pneumatic air brakes
  bus: {
    baseHz: 21,
    maxHz: 70,
    cylWave: 'sawtooth',
    subWave: 'triangle',
    subGain: 1.08,
    harm1Ratio: 1.5,
    harm1Wave: 'triangle',
    harm1Gain: 0.22,
    harm2Ratio: 0.75,
    harm2Wave: 'sine',
    harm2Gain: 0.32,
    filterMinHz: 280,
    filterMaxHz: 860,
    filterQ: 1.8,
    interiorGain: 0.19,
    exteriorGain: 0.27,
    turboStrength: 0.85,
    turboBaseHz: 760,
    turboSpanHz: 1100,
    hasAirBrakes: true,
    hasV12Overrun: false,
  },
  // Lamborghini: aggressive 6.5L high-RPM naturally aspirated V12 supercar scream
  lamborghini: {
    baseHz: 58,
    maxHz: 252,
    cylWave: 'sawtooth',
    subWave: 'sawtooth',
    subGain: 0.36,
    harm1Ratio: 1.5,
    harm1Wave: 'sawtooth',
    harm1Gain: 0.58,
    harm2Ratio: 2.0,
    harm2Wave: 'sawtooth',
    harm2Gain: 0.46,
    filterMinHz: 940,
    filterMaxHz: 3650,
    filterQ: 3.1,
    interiorGain: 0.17,
    exteriorGain: 0.25,
    turboStrength: 0.0,
    turboBaseHz: 1200,
    turboSpanHz: 1500,
    hasAirBrakes: false,
    hasV12Overrun: true,
  },
  // Nissan IM03 Formula E Gen2: smooth dual MGU-K electric motor & straight-cut gearbox whine
  nissan: {
    baseHz: 112,
    maxHz: 510,
    cylWave: 'sine',
    subWave: 'sine',
    subGain: 0.24,
    harm1Ratio: 2.25,
    harm1Wave: 'triangle',
    harm1Gain: 0.34,
    harm2Ratio: 3.5,
    harm2Wave: 'sine',
    harm2Gain: 0.16,
    filterMinHz: 1450,
    filterMaxHz: 4600,
    filterQ: 1.6,
    interiorGain: 0.11,
    exteriorGain: 0.16,
    turboStrength: 0.55,
    turboBaseHz: 1480,
    turboSpanHz: 2550,
    hasAirBrakes: false,
    hasV12Overrun: false,
  },
  // Balanced 4-cyl DOHC petrol acoustic profile (available internally if referenced)
  car: {
    baseHz: 42,
    maxHz: 154,
    cylWave: 'sawtooth',
    subWave: 'triangle',
    subGain: 0.55,
    harm1Ratio: 1.5,
    harm1Wave: 'triangle',
    harm1Gain: 0.32,
    harm2Ratio: 2.0,
    harm2Wave: 'sine',
    harm2Gain: 0.22,
    filterMinHz: 720,
    filterMaxHz: 2300,
    filterQ: 2.2,
    interiorGain: 0.15,
    exteriorGain: 0.22,
    turboStrength: 0.4,
    turboBaseHz: 1100,
    turboSpanHz: 1300,
    hasAirBrakes: false,
    hasV12Overrun: false,
  },
};

export class RacingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Single-Voice Multi-Harmonic Engine Graph (no overlapping engines on switch)
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private cylOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGainNode: GainNode | null = null;
  private harm1Osc: OscillatorNode | null = null;
  private harm1GainNode: GainNode | null = null;
  private harm2Osc: OscillatorNode | null = null;
  private harm2GainNode: GainNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  // Tire / Wet Surface Noise
  private tireGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;

  // Dual-Tone Horn
  private hornGain: GainNode | null = null;
  private hornOscA: OscillatorNode | null = null;
  private hornOscB: OscillatorNode | null = null;
  private hornActive = false;

  // Mountain Wind / Rain Ambience
  private ambienceGain: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;

  // Continuous Steel Guardrail Scrape Loop
  private scrapeGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;

  // Tunnel Acoustic Echo / Reverb Send (Engine & Horn reflection off tunnel walls)
  private tunnelEchoGain: GainNode | null = null;

  private nextReverseBeepTime = 0;
  private wasHeavyBraking = false;
  private nextAirBrakeTime = 0;
  private nextOverrunPopTime = 0;
  private nextFlamePopTime = 0;
  private prevThrottle = 0;

  private soundEnabled = true;
  private isPaused = false;
  private currentVehicle: VehicleId = 'scorpio';
  private initialized = false;

  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.syncMasterGain();
  }

  public setVehicle(vehicleId: VehicleId): void {
    const changed = this.currentVehicle !== vehicleId;
    this.currentVehicle = vehicleId;
    this.applyProfileToNodes(vehicleId);
    if (changed && this.ctx && this.engineGain) {
      // Smooth cross-ramp avoids clicks/overlapping residues on instant vehicle switch
      const now = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0.0, now, 0.02);
      this.turboGain?.gain.setTargetAtTime(0.0, now, 0.02);
    }
    if (this.ctx && this.hornOscA && this.hornOscB) {
      const [f1, f2] = VEHICLES[vehicleId].hornBaseFreq;
      this.hornOscA.frequency.setTargetAtTime(f1, this.ctx.currentTime, 0.02);
      this.hornOscB.frequency.setTargetAtTime(f2, this.ctx.currentTime, 0.02);
    }
  }

  private applyProfileToNodes(profileKey: EngineProfileKey): void {
    if (!this.ctx || !this.initialized) return;
    const p = ENGINE_PROFILES[profileKey] ?? ENGINE_PROFILES.scorpio;
    const now = this.ctx.currentTime;

    if (this.cylOsc) this.cylOsc.type = p.cylWave;
    if (this.subOsc) this.subOsc.type = p.subWave;
    if (this.harm1Osc) this.harm1Osc.type = p.harm1Wave;
    if (this.harm2Osc) this.harm2Osc.type = p.harm2Wave;

    this.subGainNode?.gain.setTargetAtTime(p.subGain, now, 0.03);
    this.harm1GainNode?.gain.setTargetAtTime(p.harm1Gain, now, 0.03);
    this.harm2GainNode?.gain.setTargetAtTime(p.harm2Gain, now, 0.03);
    this.engineFilter?.Q.setTargetAtTime(p.filterQ, now, 0.04);
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (paused) {
      this.setHorn(false);
      this.setDividerScrape(0);
    }
    this.syncMasterGain();
  }

  private syncMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const target = this.soundEnabled && !this.isPaused ? 0.56 : 0.0;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  public unlock(): void {
    if (!this.initialized) {
      this.initGraph();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private initGraph(): void {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.soundEnabled ? 0.56 : 0;
      master.connect(ctx.destination);
      this.masterGain = master;

      const noiseBuffer = this.createNoiseBuffer(ctx);
      this.noiseBuffer = noiseBuffer;

      // 1. Multi-Harmonic Vehicle-Specific Engine Graph
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 800;
      engineFilter.Q.value = 2.4;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.0;
      engineFilter.connect(engineGain);
      engineGain.connect(master);

      // Tunnel Slapback / Diffuse Concrete Echo Bus (connected in parallel from engine & horn)
      const tunnelDelay = ctx.createDelay(0.25);
      tunnelDelay.delayTime.value = 0.068;

      const tunnelFeedback = ctx.createGain();
      tunnelFeedback.gain.value = 0.32;

      const tunnelDamp = ctx.createBiquadFilter();
      tunnelDamp.type = 'lowpass';
      tunnelDamp.frequency.value = 1750;

      const tunnelEchoGain = ctx.createGain();
      tunnelEchoGain.gain.value = 0.0;

      tunnelDelay.connect(tunnelDamp);
      tunnelDamp.connect(tunnelFeedback);
      tunnelFeedback.connect(tunnelDelay);
      tunnelDamp.connect(tunnelEchoGain);
      tunnelEchoGain.connect(master);
      engineGain.connect(tunnelDelay);
      this.tunnelEchoGain = tunnelEchoGain;

      const cylOsc = ctx.createOscillator();
      cylOsc.type = 'sawtooth';
      cylOsc.frequency.value = 36;
      cylOsc.connect(engineFilter);
      cylOsc.start();

      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.value = 18;
      const subGainNode = ctx.createGain();
      subGainNode.gain.value = 0.7;
      subOsc.connect(subGainNode);
      subGainNode.connect(engineFilter);
      subOsc.start();

      const harm1Osc = ctx.createOscillator();
      harm1Osc.type = 'sawtooth';
      harm1Osc.frequency.value = 54;
      const harm1GainNode = ctx.createGain();
      harm1GainNode.gain.value = 0.26;
      harm1Osc.connect(harm1GainNode);
      harm1GainNode.connect(engineFilter);
      harm1Osc.start();

      const harm2Osc = ctx.createOscillator();
      harm2Osc.type = 'triangle';
      harm2Osc.frequency.value = 72;
      const harm2GainNode = ctx.createGain();
      harm2GainNode.gain.value = 0.14;
      harm2Osc.connect(harm2GainNode);
      harm2GainNode.connect(engineFilter);
      harm2Osc.start();

      const turboOsc = ctx.createOscillator();
      turboOsc.type = 'sine';
      turboOsc.frequency.value = 1100;
      const turboGain = ctx.createGain();
      turboGain.gain.value = 0.0;
      turboOsc.connect(turboGain);
      turboGain.connect(master);
      turboOsc.start();

      this.engineFilter = engineFilter;
      this.engineGain = engineGain;
      this.cylOsc = cylOsc;
      this.subOsc = subOsc;
      this.subGainNode = subGainNode;
      this.harm1Osc = harm1Osc;
      this.harm1GainNode = harm1GainNode;
      this.harm2Osc = harm2Osc;
      this.harm2GainNode = harm2GainNode;
      this.turboOsc = turboOsc;
      this.turboGain = turboGain;

      // 2. Tire Friction / Skid / Wet Asphalt Spray
      const tireSource = ctx.createBufferSource();
      tireSource.buffer = noiseBuffer;
      tireSource.loop = true;

      const tireFilter = ctx.createBiquadFilter();
      tireFilter.type = 'bandpass';
      tireFilter.frequency.value = 950;
      tireFilter.Q.value = 3.5;

      const tireGain = ctx.createGain();
      tireGain.gain.value = 0.0;

      tireSource.connect(tireFilter);
      tireFilter.connect(tireGain);
      tireGain.connect(master);
      tireSource.start();

      this.tireFilter = tireFilter;
      this.tireGain = tireGain;

      // 3. Dual-Tone Horn
      const [h1, h2] = VEHICLES[this.currentVehicle].hornBaseFreq;
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'bandpass';
      hornFilter.frequency.value = 1180;
      hornFilter.Q.value = 1.4;

      const hornGain = ctx.createGain();
      hornGain.gain.value = 0.0;

      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = h1;

      const oscB = ctx.createOscillator();
      oscB.type = 'sawtooth';
      oscB.frequency.value = h2;

      oscA.connect(hornFilter);
      oscB.connect(hornFilter);
      hornFilter.connect(hornGain);
      hornGain.connect(master);
      hornGain.connect(tunnelDelay);
      oscA.start();
      oscB.start();

      this.hornOscA = oscA;
      this.hornOscB = oscB;
      this.hornGain = hornGain;

      // 4. Mountain Wind & Rain Ambience
      const ambSource = ctx.createBufferSource();
      ambSource.buffer = noiseBuffer;
      ambSource.loop = true;

      const ambFilter = ctx.createBiquadFilter();
      ambFilter.type = 'lowpass';
      ambFilter.frequency.value = 480;

      const ambGain = ctx.createGain();
      ambGain.gain.value = 0.05;

      ambSource.connect(ambFilter);
      ambFilter.connect(ambGain);
      ambGain.connect(master);
      ambSource.start();

      this.ambienceFilter = ambFilter;
      this.ambienceGain = ambGain;

      // 5. Continuous Steel Guardrail Scraping Loop
      const scrapeSource = ctx.createBufferSource();
      scrapeSource.buffer = noiseBuffer;
      scrapeSource.loop = true;

      const scrapeFilter = ctx.createBiquadFilter();
      scrapeFilter.type = 'bandpass';
      scrapeFilter.frequency.value = 1600;
      scrapeFilter.Q.value = 2.2;

      const scrapeGain = ctx.createGain();
      scrapeGain.gain.value = 0.0;

      scrapeSource.connect(scrapeFilter);
      scrapeFilter.connect(scrapeGain);
      scrapeGain.connect(master);
      scrapeSource.start();

      this.scrapeFilter = scrapeFilter;
      this.scrapeGain = scrapeGain;

      this.initialized = true;
      this.applyProfileToNodes(this.currentVehicle);
    } catch {
      // Ignore Web Audio unsupported errors
    }
  }

  public playEngineIgnition(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || !this.soundEnabled) return;
    const now = this.ctx.currentTime;
    const p = ENGINE_PROFILES[this.currentVehicle] ?? ENGINE_PROFILES.scorpio;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass';

    if (this.currentVehicle === 'bus') {
      // Heavy slow diesel crank into deep bass idle
      osc.type = 'sawtooth';
      lpf.frequency.setValueAtTime(420, now);
      osc.frequency.setValueAtTime(16, now);
      osc.frequency.setValueAtTime(19, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.44);
      osc.frequency.exponentialRampToValueAtTime(p.baseHz, now + 0.85);
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.34);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
    } else if (this.currentVehicle === 'nissan') {
      // Formula E electric powertrain arming sweep & inverter chime
      osc.type = 'sine';
      lpf.frequency.setValueAtTime(3200, now);
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.24);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.48);
      gain.gain.setValueAtTime(0.005, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.54);
    } else if (this.currentVehicle === 'lamborghini') {
      // Crisp high-speed starter into sharp V12 bark flare
      osc.type = 'sawtooth';
      lpf.frequency.setValueAtTime(2400, now);
      osc.frequency.setValueAtTime(46, now);
      osc.frequency.exponentialRampToValueAtTime(178, now + 0.26);
      osc.frequency.exponentialRampToValueAtTime(p.baseHz, now + 0.72);
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.24, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    } else {
      // Scorpio rugged mHawk diesel crank & surge
      osc.type = 'sawtooth';
      lpf.frequency.setValueAtTime(920, now);
      osc.frequency.setValueAtTime(24, now);
      osc.frequency.setValueAtTime(28, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(72, now + 0.34);
      osc.frequency.exponentialRampToValueAtTime(p.baseHz, now + 0.68);
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    }

    osc.connect(lpf);
    lpf.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.92);
  }

  private playAirBrakeHiss(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || !this.soundEnabled || this.isPaused) {
      return;
    }
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(2800, now);
    bpf.Q.value = 1.6;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    src.connect(bpf);
    bpf.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.34);
  }

  private playExhaustBurble(): void {
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playExhaustFlamePop(vehicleId: VehicleId, isOverrun = false): void {
    if (vehicleId !== 'lamborghini' && vehicleId !== 'scorpio') return;
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const now = this.ctx.currentTime;
    if (now < this.nextFlamePopTime) return;
    this.nextFlamePopTime = now + 0.28;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (vehicleId === 'lamborghini') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(isOverrun ? 182 : 164, now);
      osc.frequency.exponentialRampToValueAtTime(56, now + 0.085);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(isOverrun ? 0.115 : 0.09, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.105);

      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bpf = this.ctx.createBiquadFilter();
        bpf.type = 'bandpass';
        bpf.frequency.setValueAtTime(1450, now);
        bpf.Q.value = 1.9;
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.001, now);
        ng.gain.linearRampToValueAtTime(0.075, now + 0.01);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        src.connect(bpf);
        bpf.connect(ng);
        ng.connect(this.masterGain);
        src.start(now);
        src.stop(now + 0.09);
      }
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(106, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.095);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.062, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.115);
    }
  }

  public playEngineShutdown(): void {
    if (!this.ctx || !this.engineGain) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.0, now, 0.14);
    if (this.turboGain) this.turboGain.gain.setTargetAtTime(0.0, now, 0.08);
    if (this.tireGain) this.tireGain.gain.setTargetAtTime(0.0, now, 0.08);
    if (this.scrapeGain) this.scrapeGain.gain.setTargetAtTime(0.0, now, 0.04);
  }

  public playGearShift(): void {
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    if (this.currentVehicle === 'nissan') {
      // Subtle Formula E regenerative / paddle torque pulse
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(610, now + 0.05);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else if (this.currentVehicle === 'lamborghini') {
      // Snappy ISR paddle-shift blip
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(195, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.07);
      g.gain.setValueAtTime(0.15, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    } else if (this.currentVehicle === 'bus') {
      // Heavy gearbox clunk + faint air actuator puff
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(84, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.12);
      g.gain.setValueAtTime(0.16, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.09);
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    }

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playCollision(intensity: number): void {
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.18);
    g.gain.setValueAtTime(Math.min(0.35, 0.12 + intensity * 0.22), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public setDividerScrape(intensity: number): void {
    if (!this.ctx || !this.scrapeGain || !this.scrapeFilter) return;
    const now = this.ctx.currentTime;
    if (intensity <= 0.005 || this.isPaused || !this.soundEnabled) {
      this.scrapeGain.gain.setTargetAtTime(0.0, now, 0.035);
      return;
    }
    const clamped = Math.max(0, Math.min(1, intensity));
    this.scrapeFilter.frequency.setTargetAtTime(1150 + clamped * 1250, now, 0.04);
    this.scrapeGain.gain.setTargetAtTime(0.035 + clamped * 0.125, now, 0.025);
  }

  public playDividerCollision(intensity: number): void {
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const clamped = Math.max(0.2, Math.min(1.0, intensity));
    const now = this.ctx.currentTime;

    // 1. Heavy metallic steel guardrail impact thud
    const thudOsc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(145 + clamped * 45, now);
    thudOsc.frequency.exponentialRampToValueAtTime(36, now + 0.2);
    thudGain.gain.setValueAtTime(0.001, now);
    thudGain.gain.linearRampToValueAtTime(0.14 + clamped * 0.14, now + 0.01);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    thudOsc.connect(thudGain);
    thudGain.connect(this.masterGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.23);

    // 2. Crisp steel barrier metallic crunch burst
    if (this.noiseBuffer) {
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.noiseBuffer;

      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.setValueAtTime(1950 + clamped * 550, now);
      bpf.frequency.exponentialRampToValueAtTime(760, now + 0.22);
      bpf.Q.value = 2.4;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.linearRampToValueAtTime(0.11 + clamped * 0.13, now + 0.012);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);

      noiseSrc.connect(bpf);
      bpf.connect(nGain);
      nGain.connect(this.masterGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.24);
    }
  }

  public playAccidentCrash(): void {
    this.unlock();
    this.setDividerScrape(0);
    if (!this.ctx || !this.masterGain || !this.soundEnabled) return;
    const now = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.55);
    subGain.gain.setValueAtTime(0.52, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.64);

    const noiseLen = Math.floor(this.ctx.sampleRate * 0.85);
    const buf = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      const env = Math.pow(1 - i / noiseLen, 1.8);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.8);
    filter.Q.value = 0.85;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.65, now);
    nGain.gain.exponentialRampToValueAtTime(0.005, now + 0.84);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.86);

    // Short post-impact tire skid screech
    if (this.noiseBuffer) {
      const skidSrc = this.ctx.createBufferSource();
      skidSrc.buffer = this.noiseBuffer;

      const skidBpf = this.ctx.createBiquadFilter();
      skidBpf.type = 'bandpass';
      skidBpf.frequency.setValueAtTime(1420, now + 0.04);
      skidBpf.frequency.exponentialRampToValueAtTime(920, now + 0.65);
      skidBpf.Q.value = 3.2;

      const skidGain = this.ctx.createGain();
      skidGain.gain.setValueAtTime(0.001, now);
      skidGain.gain.linearRampToValueAtTime(0.11, now + 0.08);
      skidGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

      skidSrc.connect(skidBpf);
      skidBpf.connect(skidGain);
      skidGain.connect(this.masterGain);
      skidSrc.start(now + 0.02);
      skidSrc.stop(now + 0.7);
    }
  }

  private playReverseWarningBeep(): void {
    if (!this.ctx || !this.masterGain || !this.soundEnabled || this.isPaused) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.currentVehicle === 'bus' ? 980 : 1180, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.065, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public setHorn(active: boolean): void {
    if (active) this.unlock();
    if (this.hornActive === active) return;
    this.hornActive = active;
    if (!this.ctx || !this.hornGain) return;
    const now = this.ctx.currentTime;
    const target = active && this.soundEnabled && !this.isPaused ? 0.34 : 0.0;
    this.hornGain.gain.setTargetAtTime(target, now, active ? 0.012 : 0.03);
  }

  public updateFrame(params: {
    rpm: number;
    speedKmh: number;
    throttle: number;
    brake: number;
    gear?: number;
    nitroActive?: boolean;
    isDrifting: boolean;
    surface: RoadSurface;
    cameraMode: CameraMode;
    weather: WeatherType;
    activeRacing: boolean;
    tunnelAmount?: number;
  }): void {
    if (!this.ctx || !this.initialized) return;
    const now = this.ctx.currentTime;

    if (!params.activeRacing || this.isPaused || !this.soundEnabled) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.08);
      this.turboGain?.gain.setTargetAtTime(0, now, 0.08);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.08);
      this.scrapeGain?.gain.setTargetAtTime(0, now, 0.04);
      this.tunnelEchoGain?.gain.setTargetAtTime(0, now, 0.08);
      this.wasHeavyBraking = false;
      this.prevThrottle = 0;
      return;
    }

    const tunnelAmt = Math.max(0, Math.min(1, params.tunnelAmount ?? 0));
    this.tunnelEchoGain?.gain.setTargetAtTime(tunnelAmt * 0.28, now, 0.09);

    const p = ENGINE_PROFILES[this.currentVehicle] ?? ENGINE_PROFILES.scorpio;
    const isFormulaEv = this.currentVehicle === 'nissan';
    const speedNorm = Math.max(0, Math.min(1, params.speedKmh / 280));
    const rpmNorm = isFormulaEv
      ? Math.max(0, Math.min(1, speedNorm * 0.92 + params.throttle * 0.08))
      : Math.max(0, Math.min(1, (params.rpm - 800) / 3400));
    const nitroPitchBoost = params.nitroActive
      ? isFormulaEv
        ? 45
        : this.currentVehicle === 'lamborghini'
        ? 28
        : 13
      : 0;
    const baseFreq = p.baseHz + rpmNorm * (p.maxHz - p.baseHz) + nitroPitchBoost;

    const isInterior = params.cameraMode === 'driver' || params.cameraMode === 'steering';
    const filterSpan = p.filterMaxHz - p.filterMinHz;
    const filterBase =
      p.filterMinHz +
      rpmNorm * filterSpan +
      params.throttle * filterSpan * 0.28 +
      (params.nitroActive ? 420 : 0);
    const filterCutoff = isInterior ? filterBase * 0.58 : filterBase;

    const freqLag =
      this.currentVehicle === 'bus'
        ? 0.065
        : this.currentVehicle === 'lamborghini'
        ? 0.025
        : isFormulaEv
        ? 0.032
        : 0.04;
    this.cylOsc?.frequency.setTargetAtTime(baseFreq, now, freqLag);
    this.subOsc?.frequency.setTargetAtTime(baseFreq * 0.5, now, freqLag);
    this.harm1Osc?.frequency.setTargetAtTime(baseFreq * p.harm1Ratio, now, freqLag);
    this.harm2Osc?.frequency.setTargetAtTime(baseFreq * p.harm2Ratio, now, freqLag);
    this.engineFilter?.frequency.setTargetAtTime(filterCutoff, now, 0.05);

    const evIdleQuiet = isFormulaEv && params.speedKmh < 2 && params.throttle < 0.05 ? 0.18 : 1.0;
    const engVol =
      ((isInterior ? p.interiorGain : p.exteriorGain) +
        params.throttle * (isFormulaEv ? 0.055 : 0.085) +
        rpmNorm * (isFormulaEv ? 0.055 : 0.065) +
        (params.nitroActive ? 0.045 : 0)) *
      evIdleQuiet;
    this.engineGain?.gain.setTargetAtTime(engVol, now, 0.045);

    // Turbocharger spool whistle (Scorpio & Bus) or EV MGU-K inverter whine (Nissan Formula E)
    const turboFreq = p.turboBaseHz + rpmNorm * p.turboSpanHz + (params.nitroActive ? 650 : 0);
    const turboVol =
      p.turboStrength <= 0
        ? 0
        : isFormulaEv
        ? (params.speedKmh > 3 || params.throttle > 0.08
            ? (0.008 + (params.throttle * 0.65 + rpmNorm * 0.35) * (isInterior ? 0.016 : 0.026)) *
              (params.nitroActive ? 1.45 : 1.0)
            : 0) * p.turboStrength
        : (params.nitroActive
            ? isInterior
              ? 0.055
              : 0.09
            : params.throttle > 0.28
            ? rpmNorm * params.throttle * (isInterior ? 0.025 : 0.045)
            : 0) * p.turboStrength;
    this.turboOsc?.frequency.setTargetAtTime(turboFreq, now, 0.06);
    this.turboGain?.gain.setTargetAtTime(turboVol, now, 0.07);

    // Heavy Coach Air-Brake Release Hiss (Bus)
    const heavyBrakeNow = params.brake > 0.55 && params.speedKmh > 18;
    if (p.hasAirBrakes && this.wasHeavyBraking && !heavyBrakeNow && now > this.nextAirBrakeTime) {
      this.nextAirBrakeTime = now + 0.9;
      this.playAirBrakeHiss();
    }
    this.wasHeavyBraking = heavyBrakeNow;

    // V12 Exhaust Overrun Burble when lifting throttle at speed (Lamborghini)
    if (
      p.hasV12Overrun &&
      this.prevThrottle > 0.45 &&
      params.throttle < 0.06 &&
      params.speedKmh > 65 &&
      now > this.nextOverrunPopTime
    ) {
      this.nextOverrunPopTime = now + 0.65;
      this.playExhaustBurble();
    }
    this.prevThrottle = params.throttle;

    // Reverse Warning Chime when in Reverse gear
    if (params.gear === -1 && now > this.nextReverseBeepTime) {
      this.nextReverseBeepTime = now + 0.52;
      this.playReverseWarningBeep();
    }

    // Tire skid, wet-asphalt spray & braking friction
    let tireVol = 0;
    let tireFreq = 1000;
    if (params.isDrifting && params.speedKmh > 25) {
      tireFreq = 1280;
      tireVol = Math.min(0.24, (params.speedKmh / 150) * 0.22);
    } else if (params.brake > 0.6 && params.speedKmh > 35) {
      tireFreq = 1050;
      tireVol = 0.09;
    } else if (params.weather === 'rain' && params.speedKmh > 20) {
      tireFreq = 920 + params.speedKmh * 2.5;
      tireVol = Math.min(0.08, (params.speedKmh / 180) * 0.08);
    }
    this.tireFilter?.frequency.setTargetAtTime(tireFreq, now, 0.04);
    this.tireGain?.gain.setTargetAtTime(tireVol * (isInterior ? 0.65 : 1.0), now, 0.05);

    // Mountain Wind / Rain Ambience
    const isRain = params.weather === 'rain';
    const windCutoff = isRain ? 1650 : 380 + params.speedKmh * 4.5;
    const windVol = isRain ? 0.11 : 0.035 + (params.speedKmh / 200) * (isInterior ? 0.03 : 0.07);
    this.ambienceFilter?.frequency.setTargetAtTime(windCutoff, now, 0.1);
    this.ambienceGain?.gain.setTargetAtTime(windVol, now, 0.1);
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.initialized = false;
  }
}
