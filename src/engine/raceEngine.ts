import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CameraMode,
  ControlInputState,
  GameScreen,
  GraphicsQuality,
  LevelConfig,
  RaceStatus,
  ReplayCameraAngle,
  ReplayTelemetryData,
  TelemetryData,
  VehicleId,
  WeatherType,
} from '../types/game';
import { MOUNTAIN_ROUTES } from '../data/levels';
import { VEHICLES } from '../data/vehicles';
import { createProceduralTextureSet, ProceduralTextureSet } from './textures';
import {
  buildVehicleModel,
  preloadScorpioGlb,
  VehicleRig,
} from './vehicleModels';
import {
  buildTrafficVehicleModel,
  TrafficVehicleKind,
  TrafficVehicleRig,
} from './trafficModels';
import {
  buildLevelWorld,
  BuiltWorld,
  getWeatherAtmosphere,
  TrackSample,
  TunnelLightingState,
} from './worldBuilder';
import { getTunnelGlbError, preloadTunnelGlb } from './tunnelGlbLoader';
import { RacingAudioEngine } from './audioEngine';

export const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
})();

interface TrafficVehicleState {
  rig: TrafficVehicleRig;
  kind: TrafficVehicleKind;
  active: boolean;
  dir: 1 | -1; // +1 = left-lane forward cruise, -1 = right-lane oncoming traffic
  s: number;
  lat: number;
  targetLat: number;
  pendingTargetLat: number | null;
  indicatorDir: -1 | 0 | 1; // -1 = Left Blinker, +1 = Right Blinker, 0 = Off
  indicatorLeadTimer: number;
  laneChangeTimer: number;
  speedMs: number;
  baseSpeedMs: number;
  wheelSpin: number;
  braking: boolean;
  overtaken: boolean;
  crashed: boolean;
}

type ParticleKind = 'smoke' | 'spark';

interface ParticleItem {
  active: boolean;
  life: number;
  maxLife: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  kind: ParticleKind;
}

interface ReplayTrafficFrame {
  active: boolean;
  s: number;
  lat: number;
  dir: 1 | -1;
  wheelSpin: number;
  braking: boolean;
  indicator: -1 | 0 | 1;
  crashed: boolean;
}

interface ReplayFrame {
  time: number;
  s: number;
  lat: number;
  headingRel: number;
  driftAngle: number;
  speedMs: number;
  wheelSpin: number;
  steerAngle: number;
  gear: number;
  rpm: number;
  gearShiftAnim: number;
  suspPitch: number;
  suspRoll: number;
  suspHeave: number;
  throttle: number;
  brake: number;
  drifting: boolean;
  horn: boolean;
  crashed: boolean;
  exhaustFlame: number;
  traffic: ReplayTrafficFrame[];
}

const MAX_TRAFFIC_POOL = 16;
const MAX_REPLAY_FRAMES = 1800; // Rolling ~90s ring buffer @ 20Hz for constant RAM during endless runs

// Pre-allocated module-level math scratch objects (Zero GC in render loop)
const _sampleA: TrackSample = {
  position: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  surface: 'asphalt',
  mudIntensity: 0,
  slope: 0,
  bankAngle: 0,
  minLat: -4,
  maxLat: 4,
};
const _sampleB: TrackSample = {
  position: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  surface: 'asphalt',
  mudIntensity: 0,
  slope: 0,
  bankAngle: 0,
  minLat: -4,
  maxLat: 4,
};
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _fwdAxis = new THREE.Vector3(0, 0, -1);
const _negFwd = new THREE.Vector3();
const _camDesiredPos = new THREE.Vector3();
const _camDesiredLook = new THREE.Vector3();
const _localOffset = new THREE.Vector3();
const _localLook = new THREE.Vector3();
const _pDummy = new THREE.Object3D();
const _pColor = new THREE.Color();
const _tunnelLightState: TunnelLightingState = {
  insideFactor: 0,
  approachFactor: 0,
  activeLampCount: 0,
  lampPositions: [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ],
};
const _tunnelSunColor = new THREE.Color();
const _tunnelHemiSky = new THREE.Color();
const _tunnelHemiGround = new THREE.Color();
const _tunnelFogColor = new THREE.Color();
const _tunnelDarkFogColor = new THREE.Color(0x22201d);
const _tunnelWarmSun = new THREE.Color(0xffe5b4);
const _tunnelWarmHemiSky = new THREE.Color(0x7d6d56);
const _tunnelWarmHemiGround = new THREE.Color(0x1e1b18);

const TRAFFIC_PLATES = [
  'KA 01 MJ 4491',
  'HP 01 AA 3910',
  'UK 07 PA 2278',
  'MH 12 DN 8820',
  'DL 8C AX 3319',
  'HR 26 DK 5102',
  'PB 10 GT 7711',
  'RJ 14 GC 9044',
];

const TRAFFIC_PAINTS = ['#171a21', '#15803d', '#f1f5f9', '#eab308', '#2563eb'];
const SCORPIO_PAINTS = TRAFFIC_PAINTS;
const BUS_PAINTS = ['#2563eb', '#f1f5f9', '#eab308', '#15803d', '#171a21'];
const LAMBO_PAINTS = ['#eab308', '#15803d', '#2563eb', '#f1f5f9', '#171a21'];

export class ForestHighwayRaceEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private textures: ProceduralTextureSet;
  public audio: RacingAudioEngine;

  private world: BuiltWorld | null = null;
  private worldConfigKey = '';
  private currentRunSeed = 10007;
  private currentTunnelFactor = 0;
  private tunnelLights: THREE.PointLight[] = [];
  private playerRig: VehicleRig | null = null;
  private trafficVehicles: TrafficVehicleState[] = [];
  private activeTrafficTier = 1;

  // Pooled Tire-Smoke / Wet-Spray / Collision-Spark Particle System
  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleItem[] = [];
  private particleCursor = 0;
  private particleEmitAccum = 0;

  // Pooled Tire Skid Mark Decal System
  private skidMesh: THREE.InstancedMesh;
  private skidCursor = 0;
  private skidEmitAccum = 0;
  private readonly maxSkidMarks = 280;

  // Game & Physics State
  private screen: GameScreen = 'title';
  private raceStatus: RaceStatus = 'countdown';
  private currentLevel: LevelConfig = MOUNTAIN_ROUTES[0];
  private currentVehicleId: VehicleId = 'scorpio';
  private currentPaintHex: string = VEHICLES.scorpio.colors[0].hex;
  private cameraMode: CameraMode = 'thirdPerson';
  private quality: GraphicsQuality = 'high';
  private weatherOverride: 'auto' | WeatherType = 'auto';
  private activeWeather: WeatherType = 'sunny';
  private steeringSensitivity = 1.0;

  // Player Kinematics & Vehicle Systems
  private playerS = 0;
  private maxDistanceM = 0;
  private playerLat = -2.2;
  private playerHeadingRel = 0;
  private playerDriftAngle = 0;
  private playerSpeedMs = 0;
  private playerWheelSpin = 0;
  private playerSteerAngle = 0;
  private playerGear = 1;
  private playerRpm = 850;
  private playerNitro = 100;
  private playerNitroActive = false;
  private playerHighBeam = false;
  private playerHazard = false;
  private playerIndicatorDir: -1 | 0 | 1 = 0;
  private gearShiftAnim = 0;
  private suspPitch = 0;
  private suspRoll = 0;
  private suspHeave = 0;
  private prevSpeedMs = 0;

  // High-Speed Intermittent Exhaust Flame Burst State (Scorpio & Lamborghini only)
  private exhaustBurstTimer = 0;
  private exhaustBurstDuration = 0.16;
  private exhaustCooldownTimer = 0.45;
  private exhaustOverrunCooldown = 0;
  private prevThrottleForFlame = 0;
  private prevGearForFlame = 1;
  private currentExhaustFlame = 0;

  // Guardrail Divider Contact Debounce
  private dividerSoundCooldown = 0;
  private dividerSparkAccum = 0;
  private wasTouchingDivider: -1 | 0 | 1 = 0;

  // Endless Score & Permanent High-Score State
  private currentScore = 0;
  private scoreBonusAccum = 0;
  private bestScore = 0;
  private bestDistanceM = 0;
  private runStartBestScore = 0;
  private runStartBestDistanceM = 0;
  private isNewBestScore = false;
  private lastBestPersistTime = 0;
  private bestRecordDirty = false;

  // Interactive Drag-to-Orbit Camera Offset During Racing & Garage Presets
  private raceCamYaw = 0;
  private raceCamPitch = 0;
  private raceCamIdleTimer = 0;
  private raceCamPointerId: number | null = null;
  private raceCamLastX = 0;
  private raceCamLastY = 0;
  private garagePresetPos: THREE.Vector3 | null = null;
  private garagePresetTarget: THREE.Vector3 | null = null;

  private countdownTimer = 3.0;
  private raceElapsedTime = 0;
  private accidentTimer = 0;
  private accidentNotified = false;
  private accidentReason = '';
  private accidentSpeedKmh = 0;
  private overtakesCount = 0;
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private timeScale = 1.0;
  private crashSlowMoActive = false;
  private crashSlowMoElapsed = 0;
  private crashCamAngle = 0;
  private crashCamSide: -1 | 1 = 1;
  private titleCamAngle = 0.55;

  private smoothCamPos = new THREE.Vector3(0, 3, 8);
  private smoothCamLook = new THREE.Vector3(0, 1, -10);
  private camSnapNext = true;

  // Replay Circular Ring Buffer (Zero shift/GC during endless drives) & Playback State
  private replayFrames: ReplayFrame[] = [];
  private replayHead = 0;
  private replayCount = 0;
  private replayRecordAccum = 0;
  private replayPlaybackTime = 0;
  private replayBaseTime = 0;
  private replayDuration = 0;
  private replayPlaying = false;
  private replaySpeed = 1;
  private replayAngle: ReplayCameraAngle = 'chase';
  private replayOrbitAngle = 0.55;
  private replayTracksideAnchorS = -9999;
  private replayTracksidePos = new THREE.Vector3();
  private replayCurThrottle = 0;
  private replayCurBrake = 0;
  private replayCurDrifting = false;
  private replayCurHorn = false;
  private replayCurCrashed = false;

  public controlsInput: ControlInputState = {
    steer: 0,
    throttle: 0,
    brake: 0,
    reverse: 0,
    handbrake: false,
    nitro: false,
    horn: false,
  };

  private onTelemetry?: (data: TelemetryData) => void;
  private onReplayTelemetry?: (data: ReplayTelemetryData) => void;
  private onHighScoreUpdate?: (bestScore: number, bestDistanceM: number) => void;
  private onAccident?: (result: {
    reason: string;
    speedKmh: number;
    distanceM: number;
    timeSec: number;
    overtakes: number;
    score: number;
    bestScore: number;
    previousBestScore: number;
    bestDistanceM: number;
    previousBestDistanceM: number;
    isNewBest: boolean;
    vehicleId: VehicleId;
    hasReplay: boolean;
  }) => void;
  private onModelError?: (message: string | null) => void;
  private onModelLoadState?: (loaded: boolean, vehicleId: VehicleId) => void;

  private frameId = 0;
  private lastTimestamp = 0;
  private telemetryAccum = 0;
  private disposed = false;
  private contextLost = false;

  constructor(
    container: HTMLElement,
    callbacks: {
      onTelemetry: (data: TelemetryData) => void;
      onReplayTelemetry?: (data: ReplayTelemetryData) => void;
      onHighScoreUpdate?: (bestScore: number, bestDistanceM: number) => void;
      onAccident?: (result: {
        reason: string;
        speedKmh: number;
        distanceM: number;
        timeSec: number;
        overtakes: number;
        score: number;
        bestScore: number;
        previousBestScore: number;
        bestDistanceM: number;
        previousBestDistanceM: number;
        isNewBest: boolean;
        vehicleId: VehicleId;
        hasReplay: boolean;
      }) => void;
      onModelError?: (message: string | null) => void;
      onModelLoadState?: (loaded: boolean, vehicleId: VehicleId) => void;
    },
  ) {
    this.container = container;
    this.onTelemetry = callbacks.onTelemetry;
    this.onReplayTelemetry = callbacks.onReplayTelemetry;
    this.onHighScoreUpdate = callbacks.onHighScoreUpdate;
    this.onAccident = callbacks.onAccident;
    this.onModelError = callbacks.onModelError;
    this.onModelLoadState = callbacks.onModelLoadState;
    this.audio = new RacingAudioEngine();

    preloadScorpioGlb().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.onModelError?.(msg);
    });
    preloadTunnelGlb().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.onModelError?.(msg);
    });

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.setPixelRatio(
      isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio, 1.5),
    );
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    this.renderer.shadowMap.enabled = !isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.handleContextLost,
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );

    this.scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(
      62,
      (container.clientWidth || window.innerWidth) /
        (container.clientHeight || window.innerHeight),
      0.08,
      1100,
    );

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = !isSoftwareGl;
    this.orbitControls.dampingFactor = 0.07;
    this.orbitControls.enablePan = false;
    this.orbitControls.minDistance = 3.5;
    this.orbitControls.maxDistance = 8.6;
    this.orbitControls.minPolarAngle = 0.28;
    this.orbitControls.maxPolarAngle = Math.PI * 0.47;
    this.orbitControls.enabled = false;

    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x45433c, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8ed, 2.25);
    this.sunLight.position.set(60, 100, 40);
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 220;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Pre-allocate pooled tunnel ceiling lights before renderer.compile() to avoid mid-race shader recompilation
    for (let i = 0; i < 4; i++) {
      const tl = new THREE.PointLight(0xffe6b3, 0, 58, 1.42);
      tl.castShadow = false;
      tl.position.set(0, -100, 0);
      this.scene.add(tl);
      this.tunnelLights.push(tl);
    }

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextureSet(maxAniso);

    // Pooled Particle InstancedMesh (120 puffs)
    const puffGeo = new THREE.DodecahedronGeometry(0.28, 0);
    const puffMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(puffGeo, puffMat, 120);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(120 * 3),
      3,
    );
    for (let i = 0; i < 120; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 0.6,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        scale: 0.001,
        kind: 'smoke',
      });
      _pDummy.position.set(0, -100, 0);
      _pDummy.scale.setScalar(0.001);
      _pDummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _pDummy.matrix);
      this.particleMesh.setColorAt(i, _pColor.setHex(0xd6d3d1));
    }
    this.scene.add(this.particleMesh);

    // Pooled Tire Skid Mark Decal Strips
    const skidGeo = new THREE.PlaneGeometry(0.26, 0.95);
    skidGeo.rotateX(-Math.PI * 0.5);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x09090b,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, this.maxSkidMarks);
    this.skidMesh.frustumCulled = false;
    this.clearSkidMarks();
    this.scene.add(this.skidMesh);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    canvas.addEventListener('pointermove', this.handleCanvasPointerMove);
    canvas.addEventListener('pointerup', this.handleCanvasPointerUp);
    canvas.addEventListener('pointercancel', this.handleCanvasPointerUp);
    this.orbitControls.addEventListener('start', this.handleGarageOrbitStart);

    window.addEventListener('resize', this.handleResize);

    this.loadStage(MOUNTAIN_ROUTES[0], 'scorpio', VEHICLES.scorpio.colors[0].hex);
    this.setScreenMode('title');

    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // Ignore compile error if WebGL context is unavailable
    }

    this.lastTimestamp = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    cancelAnimationFrame(this.frameId);
  };

  private handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      // Ignore compile error during restore
    }
    this.lastTimestamp = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  };

  private handleGarageOrbitStart = (): void => {
    this.garagePresetPos = null;
    this.garagePresetTarget = null;
  };

  private handleCanvasPointerDown = (e: PointerEvent): void => {
    if (this.screen !== 'playing' || this.raceStatus === 'replay') return;
    this.raceCamPointerId = e.pointerId;
    this.raceCamLastX = e.clientX;
    this.raceCamLastY = e.clientY;
  };

  private handleCanvasPointerMove = (e: PointerEvent): void => {
    if (this.raceCamPointerId !== e.pointerId || this.screen !== 'playing') return;
    const dx = e.clientX - this.raceCamLastX;
    const dy = e.clientY - this.raceCamLastY;
    this.raceCamLastX = e.clientX;
    this.raceCamLastY = e.clientY;
    this.raceCamYaw = THREE.MathUtils.clamp(this.raceCamYaw - dx * 0.006, -Math.PI, Math.PI);
    this.raceCamPitch = THREE.MathUtils.clamp(this.raceCamPitch + dy * 0.004, -0.25, 0.55);
    this.raceCamIdleTimer = 2.6;
  };

  private handleCanvasPointerUp = (e: PointerEvent): void => {
    if (this.raceCamPointerId === e.pointerId) {
      this.raceCamPointerId = null;
    }
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  public setHighScoreBaseline(bestScore: number, bestDistanceM: number): void {
    this.bestScore = Math.max(0, Math.floor(bestScore));
    this.bestDistanceM = Math.max(0, Math.floor(bestDistanceM));
  }

  public applySettings(settings: {
    soundEnabled: boolean;
    graphicsQuality: GraphicsQuality;
    defaultCamera: CameraMode;
    weatherOverride: 'auto' | WeatherType;
    steeringSensitivity: number;
  }): void {
    this.audio.setSoundEnabled(settings.soundEnabled);
    this.steeringSensitivity = settings.steeringSensitivity;

    const qualityChanged = this.quality !== settings.graphicsQuality;
    const weatherChanged = this.weatherOverride !== settings.weatherOverride;
    this.quality = settings.graphicsQuality;
    this.weatherOverride = settings.weatherOverride;

    if (!isSoftwareGl) {
      const targetPR =
        this.quality === 'low'
          ? 1
          : this.quality === 'medium'
          ? Math.min(window.devicePixelRatio, 1.25)
          : Math.min(window.devicePixelRatio, 1.5);
      this.renderer.setPixelRatio(targetPR);
      this.renderer.shadowMap.enabled = this.quality !== 'low';
    }

    if (qualityChanged || weatherChanged) {
      this.rebuildEnvironmentOnly();
    }
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.raceCamYaw = 0;
    this.raceCamPitch = 0;
    this.camSnapNext =
      mode === 'driver' || mode === 'steering' || mode === 'front' || mode === 'side';
  }

  public cycleCameraMode(): CameraMode {
    const order: CameraMode[] = [
      'thirdPerson',
      'closeChase',
      'front',
      'side',
      'top',
      'driver',
      'steering',
    ];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.setCameraMode(next);
    return next;
  }

  public setGarageCameraPreset(
    preset: 'hero' | 'front' | 'side' | 'rear' | 'top' | 'interior',
  ): void {
    if (!this.playerRig || this.screen !== 'garage') return;
    const p = this.playerRig.root.position;
    const isBus = this.currentVehicleId === 'bus';
    const isSports =
      this.currentVehicleId === 'lamborghini' || this.currentVehicleId === 'nissan';
    const dist = isBus ? 7.8 : isSports ? 4.45 : 4.75;
    const targetY = p.y + (isBus ? 1.32 : isSports ? 0.52 : 0.78);

    this.garagePresetTarget = new THREE.Vector3(p.x, targetY, p.z);
    if (preset === 'front') {
      this.garagePresetPos = new THREE.Vector3(p.x, targetY + 0.25, p.z - dist);
    } else if (preset === 'side') {
      this.garagePresetPos = new THREE.Vector3(p.x + dist * 1.04, targetY + 0.2, p.z);
    } else if (preset === 'rear') {
      this.garagePresetPos = new THREE.Vector3(p.x, targetY + 0.4, p.z + dist);
    } else if (preset === 'top') {
      this.garagePresetPos = new THREE.Vector3(p.x, targetY + dist * 1.15, p.z + 0.8);
    } else if (preset === 'interior') {
      const [dx, dy, dz] = this.playerRig.driverEyeOffset;
      this.garagePresetTarget = new THREE.Vector3(p.x + dx - 0.1, p.y + dy - 0.25, p.z + dz - 1.2);
      this.garagePresetPos = new THREE.Vector3(p.x + dx - 0.15, p.y + dy + 0.06, p.z + dz + 0.35);
    } else {
      this.garagePresetPos = new THREE.Vector3(
        p.x + (isBus ? 5.8 : isSports ? 3.55 : 3.8),
        p.y + (isBus ? 2.75 : isSports ? 1.58 : 1.9),
        p.z - (isBus ? 6.5 : isSports ? 3.75 : 4.0),
      );
    }
  }

  public toggleHighBeam(): boolean {
    this.playerHighBeam = !this.playerHighBeam;
    return this.playerHighBeam;
  }

  public toggleHazardLights(): boolean {
    this.playerHazard = !this.playerHazard;
    if (this.playerHazard) this.playerIndicatorDir = 0;
    return this.playerHazard;
  }

  public toggleIndicator(dir: -1 | 1): -1 | 0 | 1 {
    this.playerHazard = false;
    this.playerIndicatorDir = this.playerIndicatorDir === dir ? 0 : dir;
    return this.playerIndicatorDir;
  }

  public resetVehicleToRoad(): void {
    if (this.screen !== 'playing' || !this.playerRig || this.raceStatus !== 'racing') return;
    this.playerLat = -(this.currentLevel.roadWidth * 0.23);
    this.playerHeadingRel = 0;
    this.playerDriftAngle = 0;
    this.playerSpeedMs = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.suspHeave = 0;
    this.dividerSparkAccum = 0;
    this.wasTouchingDivider = 0;
    this.audio.setDividerScrape(0);
    this.world?.updateAtDistance(this.playerS);
    this.positionPlayerWithGround(this.playerRig, this.playerS, this.playerLat, 0);
  }

  public setVehicleAndColor(vehicleId: VehicleId, colorHex: string): void {
    const vehicleChanged = this.currentVehicleId !== vehicleId;
    this.currentVehicleId = vehicleId;
    this.currentPaintHex = colorHex;
    this.audio.setVehicle(vehicleId);

    if (vehicleChanged || !this.playerRig) {
      if (this.playerRig) {
        this.scene.remove(this.playerRig.root);
        this.playerRig.dispose?.();
      }
      this.onModelError?.(getTunnelGlbError() ?? null);
      this.onModelLoadState?.(false, vehicleId);
      this.playerRig = buildVehicleModel(
        vehicleId,
        colorHex,
        this.textures.contactShadowMap,
        isSoftwareGl,
        undefined,
        {
          onModelError: (msg) => {
            this.onModelLoadState?.(true, vehicleId);
            this.onModelError?.(msg);
          },
          onModelLoaded: () => {
            if (!this.playerRig || this.disposed) return;
            this.onModelError?.(getTunnelGlbError() ?? null);
            this.onModelLoadState?.(true, vehicleId);
            this.playerRig.updateVisuals({
              steerAngle: this.screen === 'playing' ? this.playerSteerAngle : 0.14,
              wheelSpinRad: this.playerWheelSpin,
              braking: false,
              headlightsOn: getWeatherAtmosphere(this.activeWeather).lightsOn,
              pitchRad: this.suspPitch,
              rollRad: this.suspRoll,
              heaveY: this.suspHeave,
              gearShiftAnim: this.gearShiftAnim,
              roadBump: 0,
              hideDriverHead: false,
              exhaustFlame: 0,
            });
            if (!this.contextLost) {
              try {
                this.renderer.compile(this.playerRig.root, this.camera, this.scene);
              } catch {
                // Ignore compile error
              }
            }
          },
        },
      );
      this.scene.add(this.playerRig.root);
      this.positionPlayerWithGround(
        this.playerRig,
        this.playerS,
        this.playerLat,
        this.playerHeadingRel,
      );
    } else {
      this.playerRig.setPaintColor(colorHex);
    }
  }

  private applyAtmosphere(weather: WeatherType): void {
    this.activeWeather = weather;
    const atmos = getWeatherAtmosphere(weather);
    this.scene.background = new THREE.Color(atmos.fogColor);
    this.scene.fog = new THREE.FogExp2(atmos.fogColor, atmos.fogDensity);

    this.sunLight.color.setHex(atmos.sunColor);
    this.sunLight.intensity = atmos.sunIntensity;
    this.hemiLight.color.setHex(atmos.hemiSky);
    this.hemiLight.groundColor.setHex(atmos.hemiGround);
    this.hemiLight.intensity = atmos.hemiIntensity;
  }

  private updateTunnelAtmosphereAndLights(): void {
    const atmos = getWeatherAtmosphere(this.activeWeather);
    if (!this.world || this.screen !== 'playing') {
      this.currentTunnelFactor = 0;
      this.sunLight.color.setHex(atmos.sunColor);
      this.sunLight.intensity = atmos.sunIntensity;
      this.hemiLight.color.setHex(atmos.hemiSky);
      this.hemiLight.groundColor.setHex(atmos.hemiGround);
      this.hemiLight.intensity = atmos.hemiIntensity;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(atmos.fogColor);
        this.scene.fog.density = atmos.fogDensity;
      }
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.setHex(atmos.fogColor);
      }
      for (let k = 0; k < this.tunnelLights.length; k++) {
        this.tunnelLights[k].intensity = 0;
      }
      return;
    }

    this.world.getTunnelLightingState(this.playerS, _tunnelLightState);
    const inside = _tunnelLightState.insideFactor;
    this.currentTunnelFactor = inside;

    this.sunLight.intensity = THREE.MathUtils.lerp(atmos.sunIntensity, 0.24, inside);
    _tunnelSunColor.setHex(atmos.sunColor).lerp(_tunnelWarmSun, inside * 0.68);
    this.sunLight.color.copy(_tunnelSunColor);

    this.hemiLight.intensity = THREE.MathUtils.lerp(atmos.hemiIntensity, 0.48, inside);
    _tunnelHemiSky.setHex(atmos.hemiSky).lerp(_tunnelWarmHemiSky, inside);
    _tunnelHemiGround.setHex(atmos.hemiGround).lerp(_tunnelWarmHemiGround, inside);
    this.hemiLight.color.copy(_tunnelHemiSky);
    this.hemiLight.groundColor.copy(_tunnelHemiGround);

    _tunnelFogColor.setHex(atmos.fogColor).lerp(_tunnelDarkFogColor, inside * 0.82);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(_tunnelFogColor);
      this.scene.fog.density = THREE.MathUtils.lerp(
        atmos.fogDensity,
        Math.max(atmos.fogDensity, 0.003),
        inside,
      );
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(_tunnelFogColor);
    }

    const app = _tunnelLightState.approachFactor;
    const maxLights = this.quality === 'low' ? 2 : 4;
    for (let k = 0; k < this.tunnelLights.length; k++) {
      const tl = this.tunnelLights[k];
      if (k < _tunnelLightState.activeLampCount && k < maxLights && app > 0.01) {
        tl.position.copy(_tunnelLightState.lampPositions[k]);
        tl.intensity = 76.0 * app;
      } else {
        tl.intensity = 0;
      }
    }
  }

  private rebuildEnvironmentOnly(): void {
    const effectiveWeather =
      this.weatherOverride === 'auto'
        ? this.currentLevel.weather
        : this.weatherOverride;
    const nextKey = `${this.currentLevel.id}:${effectiveWeather}:${this.quality}:${this.currentRunSeed}`;

    if (this.world && this.worldConfigKey === nextKey) {
      this.applyAtmosphere(effectiveWeather);
      this.world.updateAtDistance(this.playerS);
      return;
    }

    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.worldConfigKey = nextKey;
    this.applyAtmosphere(effectiveWeather);
    const builtWorld = buildLevelWorld(
      this.currentLevel,
      effectiveWeather,
      this.quality,
      this.textures,
      isSoftwareGl,
      this.currentRunSeed,
      (msg) => this.onModelError?.(msg),
      (slotGroups) => {
        if (this.disposed || this.world !== builtWorld || this.contextLost) return;
        try {
          for (let i = 0; i < slotGroups.length; i++) {
            this.renderer.compile(slotGroups[i], this.camera, this.scene);
          }
        } catch {
          // Ignore compile error if WebGL context is recovering
        }
      },
    );
    this.world = builtWorld;
    this.world.updateAtDistance(this.playerS);
    this.scene.add(this.world.group);
  }

  public loadStage(
    level: LevelConfig,
    vehicleId: VehicleId,
    paintHex: string,
  ): void {
    this.currentLevel = level;
    this.rebuildEnvironmentOnly();
    this.setVehicleAndColor(vehicleId, paintHex);
  }

  private hideTrafficVehicles(): void {
    for (const tv of this.trafficVehicles) {
      tv.active = false;
      tv.rig.root.visible = false;
    }
  }

  private clearTrafficVehicles(): void {
    for (const tv of this.trafficVehicles) {
      this.scene.remove(tv.rig.root);
      tv.rig.dispose?.();
    }
    this.trafficVehicles = [];
  }

  private getTrafficTargetCountAndTier(distM: number): { count: number; tier: number } {
    if (distM < 400) return { count: 6, tier: 1 };
    if (distM < 1000) return { count: 8, tier: 2 };
    if (distM < 2000) return { count: 10, tier: 3 };
    if (distM < 3500) return { count: 12, tier: 4 };
    if (distM < 6000) return { count: 14, tier: 5 };
    return { count: MAX_TRAFFIC_POOL, tier: 6 };
  }

  private computeDynamicBaseSpeed(
    kind: TrafficVehicleKind,
    dir: 1 | -1,
    distM: number,
  ): number {
    // Progressive speed climb as endless distance increases, capped cleanly
    const distScale = 1 + Math.min(0.42, Math.max(0, distM) / 10000);
    const speedMul = this.currentLevel.aiSpeedFactor * distScale;
    const jitter = 0.92 + Math.random() * 0.16;
    if (kind === 'bus') {
      return (dir === 1 ? 10.6 : 12.2) * speedMul * jitter;
    }
    if (kind === 'lamborghini') {
      return (dir === 1 ? 22.5 : 24.5) * speedMul * jitter;
    }
    return (dir === 1 ? 16.8 : 18.6) * speedMul * jitter;
  }

  private pickSafeSpawnAhead(
    tvIndex: number,
    tv: TrafficVehicleState,
    minOffsetAhead: number,
    randSpan: number,
  ): { s: number; lat: number } {
    const roadW = this.currentLevel.roadWidth;
    const outerLat = tv.dir === 1 ? -(roadW * 0.32) : roadW * 0.32;
    const innerLat = tv.dir === 1 ? -(roadW * 0.14) : roadW * 0.14;
    // Heavy buses prefer outer lane most of the time
    const candidateLats =
      tv.kind === 'bus'
        ? [outerLat, innerLat]
        : Math.random() > 0.48
        ? [innerLat, outerLat]
        : [outerLat, innerLat];

    let bestS = this.playerS + minOffsetAhead + Math.random() * randSpan;
    let bestLat = candidateLats[0];

    for (let attempt = 0; attempt < 8; attempt++) {
      const candLat = candidateLats[attempt % candidateLats.length];
      let candS =
        this.playerS +
        minOffsetAhead +
        Math.random() * randSpan +
        Math.floor(attempt / 2) * 32;

      let laneConflict = false;
      let lanesOccupiedNearby = 0;

      for (let j = 0; j < this.trafficVehicles.length; j++) {
        if (j === tvIndex) continue;
        const other = this.trafficVehicles[j];
        if (!other.active) continue;

        const dz = Math.abs(other.s - candS);
        const minSafeGap = tv.rig.halfLength + other.rig.halfLength + 34;

        if (
          Math.abs(other.lat - candLat) <
            tv.rig.halfWidth + other.rig.halfWidth + 0.8 &&
          dz < minSafeGap
        ) {
          laneConflict = true;
          candS = Math.max(candS, other.s + minSafeGap + 6);
        }

        if (dz < 24) {
          lanesOccupiedNearby++;
        }
      }

      // Never create an impassable wall across all 4 lanes at the same s band
      if (!laneConflict && lanesOccupiedNearby < 3) {
        bestS = candS;
        bestLat = candLat;
        break;
      }
      bestS = candS;
      bestLat = candLat;
    }

    return { s: bestS, lat: bestLat };
  }

  private spawnTrafficVehicles(level: LevelConfig): void {
    // Only real uploaded GLB vehicles: Bus, Lamborghini, Mahindra Scorpio
    const kindPool: TrafficVehicleKind[] = [
      'scorpio',
      'bus',
      'lamborghini',
      'scorpio',
      'lamborghini',
      'bus',
      'scorpio',
      'scorpio',
      'lamborghini',
      'bus',
      'scorpio',
      'lamborghini',
      'scorpio',
      'bus',
      'lamborghini',
      'scorpio',
    ];

    const initialTier = this.getTrafficTargetCountAndTier(0);
    this.activeTrafficTier = initialTier.tier;

    // Reuse existing pooled GLB traffic rigs on restarts instead of re-cloning 16 GLBs!
    if (this.trafficVehicles.length === MAX_TRAFFIC_POOL) {
      for (let i = 0; i < MAX_TRAFFIC_POOL; i++) {
        const tv = this.trafficVehicles[i];
        const isInitiallyActive = i < initialTier.count;
        const dir: 1 | -1 = i % 3 === 1 ? -1 : 1;
        const laneLat =
          dir === 1
            ? -(level.roadWidth * (i % 2 === 0 ? 0.32 : 0.14))
            : level.roadWidth * (i % 2 === 0 ? 0.32 : 0.14);
        const startS = isInitiallyActive ? 115 + i * 48 + Math.random() * 18 : -500;
        const baseSpeedMs = this.computeDynamicBaseSpeed(tv.kind, dir, 0);

        tv.active = isInitiallyActive;
        tv.dir = dir;
        tv.s = startS;
        tv.lat = laneLat;
        tv.targetLat = laneLat;
        tv.pendingTargetLat = null;
        tv.indicatorDir = 0;
        tv.indicatorLeadTimer = 0;
        tv.laneChangeTimer = 2.5 + (i % 4) * 1.15;
        tv.speedMs = baseSpeedMs;
        tv.baseSpeedMs = baseSpeedMs;
        tv.wheelSpin = 0;
        tv.braking = false;
        tv.overtaken = false;
        tv.crashed = false;
        tv.rig.root.visible = isInitiallyActive && tv.rig.loaded;

        if (isInitiallyActive) {
          this.positionTrafficOnTrack(tv.rig, tv.s, tv.lat, tv.dir === -1 ? Math.PI : 0);
        }
      }
      return;
    }

    this.clearTrafficVehicles();

    for (let i = 0; i < MAX_TRAFFIC_POOL; i++) {
      const kind = kindPool[i % kindPool.length];
      const paint =
        kind === 'lamborghini'
          ? LAMBO_PAINTS[(i + 2) % LAMBO_PAINTS.length]
          : kind === 'scorpio'
          ? SCORPIO_PAINTS[(i + 1) % SCORPIO_PAINTS.length]
          : BUS_PAINTS[i % BUS_PAINTS.length];
      const plate = TRAFFIC_PLATES[i % TRAFFIC_PLATES.length];

      const isInitiallyActive = i < initialTier.count;
      const rig = buildTrafficVehicleModel(
        kind,
        paint,
        plate,
        this.textures.contactShadowMap,
        {
          onError: (msg) => {
            if (this.disposed || this.screen !== 'playing') return;
            this.onModelError?.(msg);
          },
          onLoaded: () => {
            const state = this.trafficVehicles[i];
            if (state) {
              state.rig.root.visible = state.active && this.screen === 'playing';
            }
            this.telemetryAccum = Math.max(this.telemetryAccum, 0.085);
          },
        },
      );
      if (!isInitiallyActive) {
        rig.root.visible = false;
      }
      this.scene.add(rig.root);

      // Left-hand Indian Highway: Left lanes (-lat) go forward (+1); Right lanes (+lat) oncoming (-1)
      const dir: 1 | -1 = i % 3 === 1 ? -1 : 1;
      const laneLat =
        dir === 1
          ? -(level.roadWidth * (i % 2 === 0 ? 0.32 : 0.14))
          : level.roadWidth * (i % 2 === 0 ? 0.32 : 0.14);

      const startS = isInitiallyActive ? 115 + i * 48 + Math.random() * 18 : -500;
      const baseSpeedMs = this.computeDynamicBaseSpeed(kind, dir, 0);

      const tv: TrafficVehicleState = {
        rig,
        kind,
        active: isInitiallyActive,
        dir,
        s: startS,
        lat: laneLat,
        targetLat: laneLat,
        pendingTargetLat: null,
        indicatorDir: 0,
        indicatorLeadTimer: 0,
        laneChangeTimer: 2.5 + (i % 4) * 1.15,
        speedMs: baseSpeedMs,
        baseSpeedMs,
        wheelSpin: 0,
        braking: false,
        overtaken: false,
        crashed: false,
      };
      if (isInitiallyActive) {
        this.positionTrafficOnTrack(tv.rig, tv.s, tv.lat, tv.dir === -1 ? Math.PI : 0);
      }
      this.trafficVehicles.push(tv);
    }
  }

  public setScreenMode(screen: GameScreen): void {
    this.screen = screen;
    this.orbitControls.enabled = screen === 'garage';
    this.audio.setHorn(false);
    this.audio.setDividerScrape(0);
    this.wasTouchingDivider = 0;
    this.timeScale = 1.0;
    this.crashSlowMoActive = false;
    this.crashSlowMoElapsed = 0;
    this.crashCamAngle = 0;
    this.resetExhaustFlameState();

    if (screen === 'title' || screen === 'levels' || screen === 'settings') {
      this.hideTrafficVehicles();
      this.playerS = 14;
      this.playerLat = 0;
      this.playerHeadingRel = 0;
      this.world?.updateAtDistance(14);
      if (this.playerRig) {
        this.positionPlayerWithGround(this.playerRig, 14, 0, 0);
        this.playerRig.updateVisuals({
          steerAngle: 0.2,
          wheelSpinRad: 0,
          braking: false,
          headlightsOn: true,
          pitchRad: 0,
          rollRad: 0,
          heaveY: 0,
          gearShiftAnim: 0,
          roadBump: 0,
          hideDriverHead: false,
          exhaustFlame: 0,
        });
      }
    } else if (screen === 'garage') {
      this.hideTrafficVehicles();
      this.garagePresetPos = null;
      this.garagePresetTarget = null;
      this.playerS = 22;
      this.playerLat = 0;
      this.playerHeadingRel = 0;
      this.world?.updateAtDistance(22);
      if (this.playerRig) {
        this.positionPlayerWithGround(this.playerRig, 22, 0, 0);
        this.playerRig.updateVisuals({
          steerAngle: 0.18,
          wheelSpinRad: 0,
          braking: false,
          headlightsOn: true,
          pitchRad: 0,
          rollRad: 0,
          heaveY: 0,
          gearShiftAnim: 0,
          roadBump: 0,
          hideDriverHead: false,
          exhaustFlame: 0,
        });

        const isBus = this.currentVehicleId === 'bus';
        const isSports =
          this.currentVehicleId === 'lamborghini' || this.currentVehicleId === 'nissan';
        this.orbitControls.minDistance = isBus ? 5.2 : isSports ? 3.1 : 3.4;
        this.orbitControls.maxDistance = isBus ? 13.0 : isSports ? 8.0 : 8.6;
        const carPos = this.playerRig.root.position;
        this.orbitControls.target.set(
          carPos.x,
          carPos.y + (isBus ? 1.32 : isSports ? 0.52 : 0.78),
          carPos.z,
        );
        this.camera.position.set(
          carPos.x + (isBus ? 5.8 : isSports ? 3.55 : 3.8),
          carPos.y + (isBus ? 2.75 : isSports ? 1.58 : 1.9),
          carPos.z - (isBus ? 6.5 : isSports ? 3.75 : 4.0),
        );
        this.camera.fov = 48;
        this.camera.updateProjectionMatrix();
        this.orbitControls.update();
      }
    }
  }

  public startRace(
    level: LevelConfig,
    vehicleId: VehicleId,
    paintHex: string,
    defaultCam: CameraMode,
    bestScoreBaseline?: number,
    bestDistanceBaseline?: number,
  ): void {
    this.orbitControls.enabled = false;
    this.garagePresetPos = null;
    this.garagePresetTarget = null;

    if (bestScoreBaseline !== undefined) {
      this.bestScore = Math.max(0, Math.floor(bestScoreBaseline));
    }
    if (bestDistanceBaseline !== undefined) {
      this.bestDistanceM = Math.max(0, Math.floor(bestDistanceBaseline));
    }

    this.playerS = 0;
    this.maxDistanceM = 0;
    this.currentRunSeed = Math.floor(Math.random() * 1_000_000_000) + 1;
    this.currentTunnelFactor = 0;
    this.loadStage(level, vehicleId, paintHex);
    this.spawnTrafficVehicles(level);

    this.screen = 'playing';
    this.raceStatus = 'countdown';
    this.cameraMode = defaultCam;
    this.camSnapNext = true;
    this.raceCamYaw = 0;
    this.raceCamPitch = 0;

    this.playerLat = -(level.roadWidth * 0.23);
    this.playerHeadingRel = 0;
    this.playerDriftAngle = 0;
    this.playerSpeedMs = 0;
    this.prevSpeedMs = 0;
    this.playerWheelSpin = 0;
    this.playerSteerAngle = 0;
    this.playerGear = 1;
    this.playerRpm = 850;
    this.playerNitro = 100;
    this.playerNitroActive = false;
    this.playerHighBeam = false;
    this.playerHazard = false;
    this.playerIndicatorDir = 0;
    this.gearShiftAnim = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.suspHeave = 0;
    this.resetExhaustFlameState();

    // Score ALWAYS resets cleanly to 0 at start of every run; capture previous best baseline
    this.runStartBestScore = this.bestScore;
    this.runStartBestDistanceM = this.bestDistanceM;
    this.currentScore = 0;
    this.scoreBonusAccum = 0;
    this.isNewBestScore = false;
    this.bestRecordDirty = false;
    this.lastBestPersistTime = 0;
    this.dividerSoundCooldown = 0;
    this.dividerSparkAccum = 0;
    this.wasTouchingDivider = 0;
    this.audio.setDividerScrape(0);

    this.countdownTimer = 2.6;
    this.raceElapsedTime = 0;
    this.accidentTimer = 0;
    this.accidentNotified = false;
    this.accidentReason = '';
    this.accidentSpeedKmh = 0;
    this.overtakesCount = 0;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.timeScale = 1.0;
    this.crashSlowMoActive = false;
    this.crashSlowMoElapsed = 0;
    this.crashCamAngle = 0;

    this.replayHead = 0;
    this.replayCount = 0;
    this.replayRecordAccum = 0;
    this.replayPlaybackTime = 0;
    this.replayBaseTime = 0;
    this.replayDuration = 0;
    this.replayPlaying = false;
    this.replayCurCrashed = false;
    this.clearAllParticles();
    this.clearSkidMarks();

    if (this.playerRig) {
      this.positionPlayerWithGround(this.playerRig, this.playerS, this.playerLat, 0);
      this.playerRig.updateVisuals({
        steerAngle: 0,
        wheelSpinRad: 0,
        braking: true,
        headlightsOn: getWeatherAtmosphere(this.activeWeather).lightsOn,
        highBeamOn: false,
        pitchRad: 0,
        rollRad: 0,
        heaveY: 0,
        gearShiftAnim: 0,
        roadBump: 0,
        hideDriverHead: false,
        exhaustFlame: 0,
      });
    }

    this.audio.setPaused(false);
    this.audio.playEngineIgnition();
    this.pushTelemetryNow();
  }

  private clearSkidMarks(): void {
    this.skidCursor = 0;
    for (let i = 0; i < this.maxSkidMarks; i++) {
      _pDummy.position.set(0, -100, 0);
      _pDummy.scale.setScalar(0.001);
      _pDummy.updateMatrix();
      this.skidMesh.setMatrixAt(i, _pDummy.matrix);
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  private emitSkidMarks(): void {
    if (!this.playerRig || !this.world) return;
    const hw = this.playerRig.halfWidth * 0.78;
    const rz = this.playerRig.halfLength * 0.56;
    for (const s of [-1, 1]) {
      _localOffset.set(s * hw, 0.03, rz);
      this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
      _pDummy.position.set(_camDesiredPos.x, _camDesiredPos.y, _camDesiredPos.z);
      _pDummy.quaternion.copy(this.playerRig.root.quaternion);
      _pDummy.scale.set(1, 1, 1);
      _pDummy.updateMatrix();
      this.skidMesh.setMatrixAt(this.skidCursor, _pDummy.matrix);
      this.skidCursor = (this.skidCursor + 1) % this.maxSkidMarks;
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  private clearAllParticles(): void {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].active = false;
      _pDummy.position.set(0, -100, 0);
      _pDummy.scale.setScalar(0.001);
      _pDummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _pDummy.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  private getReplayFrameAt(logicalIdx: number): ReplayFrame {
    return this.replayFrames[(this.replayHead + logicalIdx) % MAX_REPLAY_FRAMES];
  }

  private recordReplaySnapshot(timeSec: number): void {
    if (
      this.replayCount > 0 &&
      timeSec <= this.getReplayFrameAt(this.replayCount - 1).time + 0.001
    ) {
      return;
    }

    const isDrifting =
      Math.abs(this.playerDriftAngle) > 0.14 ||
      (this.controlsInput.handbrake && Math.abs(this.playerSpeedMs) > 8);

    const writeIdx =
      this.replayCount < MAX_REPLAY_FRAMES
        ? (this.replayHead + this.replayCount) % MAX_REPLAY_FRAMES
        : this.replayHead;

    if (this.replayCount >= MAX_REPLAY_FRAMES) {
      this.replayHead = (this.replayHead + 1) % MAX_REPLAY_FRAMES;
    } else {
      this.replayCount++;
    }

    let slot = this.replayFrames[writeIdx];
    if (!slot) {
      const trafficSnap: ReplayTrafficFrame[] = new Array(this.trafficVehicles.length);
      for (let i = 0; i < this.trafficVehicles.length; i++) {
        trafficSnap[i] = {
          active: false,
          s: 0,
          lat: 0,
          dir: 1,
          wheelSpin: 0,
          braking: false,
          indicator: 0,
          crashed: false,
        };
      }
      slot = {
        time: 0,
        s: 0,
        lat: 0,
        headingRel: 0,
        driftAngle: 0,
        speedMs: 0,
        wheelSpin: 0,
        steerAngle: 0,
        gear: 1,
        rpm: 850,
        gearShiftAnim: 0,
        suspPitch: 0,
        suspRoll: 0,
        suspHeave: 0,
        throttle: 0,
        brake: 0,
        drifting: false,
        horn: false,
        crashed: false,
        exhaustFlame: 0,
        traffic: trafficSnap,
      };
      this.replayFrames[writeIdx] = slot;
    }

    slot.time = timeSec;
    slot.s = this.playerS;
    slot.lat = this.playerLat;
    slot.headingRel = this.playerHeadingRel;
    slot.driftAngle = this.playerDriftAngle;
    slot.speedMs = this.playerSpeedMs;
    slot.wheelSpin = this.playerWheelSpin;
    slot.steerAngle = this.playerSteerAngle;
    slot.gear = this.playerGear;
    slot.rpm = this.playerRpm;
    slot.gearShiftAnim = this.gearShiftAnim;
    slot.suspPitch = this.suspPitch;
    slot.suspRoll = this.suspRoll;
    slot.suspHeave = this.suspHeave;
    slot.throttle = this.raceStatus === 'accident' ? 0 : this.controlsInput.throttle;
    slot.brake =
      this.raceStatus === 'accident'
        ? 0.82
        : Math.max(this.controlsInput.brake, this.controlsInput.handbrake ? 1 : 0);
    slot.drifting = isDrifting;
    slot.horn = this.controlsInput.horn && this.raceStatus === 'racing';
    slot.crashed = this.raceStatus === 'accident';
    slot.exhaustFlame = this.currentExhaustFlame;

    for (let i = 0; i < this.trafficVehicles.length; i++) {
      const t = this.trafficVehicles[i];
      const tf = slot.traffic[i];
      tf.active = t.active;
      tf.s = t.s;
      tf.lat = t.lat;
      tf.dir = t.dir;
      tf.wheelSpin = t.wheelSpin;
      tf.braking = t.braking;
      tf.indicator = t.indicatorDir;
      tf.crashed = t.crashed;
    }

    this.replayBaseTime = this.getReplayFrameAt(0).time;
    this.replayDuration = Math.max(
      0.05,
      this.getReplayFrameAt(this.replayCount - 1).time - this.replayBaseTime,
    );
  }

  public hasReplay(): boolean {
    return this.replayCount >= 2;
  }

  public startReplay(): void {
    if (this.replayCount < 2) return;
    this.raceStatus = 'replay';
    this.replayBaseTime = this.getReplayFrameAt(0).time;
    this.replayDuration = Math.max(
      0.05,
      this.getReplayFrameAt(this.replayCount - 1).time - this.replayBaseTime,
    );
    this.replayPlaybackTime = 0;
    this.replayPlaying = true;
    this.replaySpeed = 1;
    this.replayAngle = 'chase';
    this.replayOrbitAngle = 0.55;
    this.replayTracksideAnchorS = -9999;
    this.camSnapNext = true;
    this.clearAllParticles();
    this.audio.setPaused(false);
    this.applyReplayFrameAt(0, 0.016);
    this.pushReplayTelemetryNow();
  }

  public exitReplay(): void {
    if (this.raceStatus !== 'replay') return;
    if (this.replayCount > 0) {
      this.applyReplayFrameAt(this.replayDuration, 0.016);
    }
    this.replayPlaying = false;
    this.replayCurHorn = false;
    this.raceStatus = 'accident';
    this.audio.setHorn(false);
    this.audio.playEngineShutdown();
  }

  public setReplayPlaying(playing: boolean): void {
    if (this.raceStatus !== 'replay') return;
    if (playing && this.replayPlaybackTime >= this.replayDuration - 0.05) {
      this.replayPlaybackTime = 0;
      this.clearAllParticles();
      this.camSnapNext = true;
    }
    this.replayPlaying = playing;
    this.pushReplayTelemetryNow();
  }

  public toggleReplayPlaying(): boolean {
    this.setReplayPlaying(!this.replayPlaying);
    return this.replayPlaying;
  }

  public seekReplay(timeSec: number): void {
    if (this.raceStatus !== 'replay' || this.replayCount === 0) return;
    this.replayPlaybackTime = THREE.MathUtils.clamp(
      timeSec,
      0,
      this.replayDuration,
    );
    this.camSnapNext = true;
    this.replayTracksideAnchorS = -9999;
    this.applyReplayFrameAt(this.replayPlaybackTime, 0.016);
    this.pushReplayTelemetryNow();
  }

  public setReplaySpeed(mult: number): void {
    this.replaySpeed = THREE.MathUtils.clamp(mult, 0.25, 4);
    this.pushReplayTelemetryNow();
  }

  public setReplayCameraAngle(angle: ReplayCameraAngle): void {
    this.replayAngle = angle;
    this.camSnapNext = true;
    this.replayTracksideAnchorS = -9999;
    this.pushReplayTelemetryNow();
  }

  public cycleReplayCameraAngle(): ReplayCameraAngle {
    const order: ReplayCameraAngle[] = ['chase', 'cinematic', 'trackside'];
    const next = order[(order.indexOf(this.replayAngle) + 1) % order.length];
    this.setReplayCameraAngle(next);
    return next;
  }

  private applyReplayFrameAt(relTimeSec: number, dt: number): void {
    if (!this.world || !this.playerRig || this.replayCount === 0) return;
    const absTarget = this.replayBaseTime + THREE.MathUtils.clamp(relTimeSec, 0, this.replayDuration);

    let lo = 0;
    let hi = this.replayCount - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.getReplayFrameAt(mid).time <= absTarget) lo = mid;
      else hi = mid;
    }

    const f0 = this.getReplayFrameAt(lo);
    const f1 = this.getReplayFrameAt(hi);
    const span = Math.max(0.0001, f1.time - f0.time);
    const alpha = f0 === f1 ? 0 : THREE.MathUtils.clamp((absTarget - f0.time) / span, 0, 1);

    this.playerS = THREE.MathUtils.lerp(f0.s, f1.s, alpha);
    this.playerLat = THREE.MathUtils.lerp(f0.lat, f1.lat, alpha);
    this.playerHeadingRel = THREE.MathUtils.lerp(f0.headingRel, f1.headingRel, alpha);
    this.playerDriftAngle = THREE.MathUtils.lerp(f0.driftAngle, f1.driftAngle, alpha);
    this.playerSpeedMs = THREE.MathUtils.lerp(f0.speedMs, f1.speedMs, alpha);
    this.playerWheelSpin = THREE.MathUtils.lerp(f0.wheelSpin, f1.wheelSpin, alpha);
    this.playerSteerAngle = THREE.MathUtils.lerp(f0.steerAngle, f1.steerAngle, alpha);
    this.playerRpm = THREE.MathUtils.lerp(f0.rpm, f1.rpm, alpha);
    this.gearShiftAnim = THREE.MathUtils.lerp(f0.gearShiftAnim, f1.gearShiftAnim, alpha);
    this.suspPitch = THREE.MathUtils.lerp(f0.suspPitch, f1.suspPitch, alpha);
    this.suspRoll = THREE.MathUtils.lerp(f0.suspRoll, f1.suspRoll, alpha);
    this.suspHeave = THREE.MathUtils.lerp(f0.suspHeave, f1.suspHeave, alpha);

    // Ensure endless mountain highway chunks are loaded for any scrubbed replay distance
    this.world.updateAtDistance(this.playerS);

    const near = alpha < 0.5 ? f0 : f1;
    this.playerGear = near.gear;
    this.replayCurThrottle = THREE.MathUtils.lerp(f0.throttle, f1.throttle, alpha);
    this.replayCurBrake = THREE.MathUtils.lerp(f0.brake, f1.brake, alpha);
    this.replayCurDrifting = near.drifting;
    this.replayCurHorn = near.horn && this.replayPlaying;
    this.replayCurCrashed = near.crashed;

    const visualHeading = this.playerHeadingRel + this.playerDriftAngle * 0.65;
    this.positionPlayerWithGround(
      this.playerRig,
      this.playerS,
      this.playerLat,
      visualHeading,
    );

    const atmos = getWeatherAtmosphere(this.activeWeather);
    const replayTunnelAmt = this.world.getTunnelFactorAt(this.playerS);
    const hazardBlinkOn = Math.floor(absTarget * 4) % 2 === 0;
    this.playerRig.updateVisuals({
      steerAngle: this.playerSteerAngle,
      wheelSpinRad: this.playerWheelSpin,
      braking: this.replayCurBrake > 0.12,
      headlightsOn: atmos.lightsOn || replayTunnelAmt > 0.38,
      hazardActive: this.replayCurCrashed,
      hazardBlinkOn,
      pitchRad: this.suspPitch,
      rollRad: this.suspRoll,
      heaveY: this.suspHeave,
      gearShiftAnim: this.gearShiftAnim,
      roadBump: this.suspHeave * 4,
      hideDriverHead: false,
      exhaustFlame: THREE.MathUtils.lerp(f0.exhaustFlame ?? 0, f1.exhaustFlame ?? 0, alpha),
    });

    for (let i = 0; i < this.trafficVehicles.length; i++) {
      const tv = this.trafficVehicles[i];
      if (!tv.rig.loaded) continue;
      const t0 = f0.traffic[i];
      const t1 = f1.traffic[i];
      if (!t0 || !t1) continue;

      const isActive = near.traffic[i]?.active ?? false;
      tv.rig.root.visible = isActive;
      if (!isActive) continue;

      if (Math.abs(t1.s - t0.s) > 45 || !t0.active || !t1.active) {
        const pick = alpha < 0.5 ? t0 : t1;
        tv.s = pick.s;
        tv.lat = pick.lat;
        tv.wheelSpin = pick.wheelSpin;
      } else {
        tv.s = THREE.MathUtils.lerp(t0.s, t1.s, alpha);
        tv.lat = THREE.MathUtils.lerp(t0.lat, t1.lat, alpha);
        tv.wheelSpin = THREE.MathUtils.lerp(t0.wheelSpin, t1.wheelSpin, alpha);
      }
      tv.braking = near.traffic[i]?.braking ?? false;
      tv.indicatorDir = near.traffic[i]?.indicator ?? 0;
      tv.crashed = near.traffic[i]?.crashed ?? false;

      const indBlinkPhase = Math.floor(absTarget * 3.6) % 2 === 0;
      const tvTunnelAmt = this.world.getTunnelFactorAt(tv.s);
      this.positionTrafficOnTrack(tv.rig, tv.s, tv.lat, tv.dir === -1 ? Math.PI : 0);
      tv.rig.updateVisuals({
        wheelSpinRad: tv.wheelSpin,
        braking: tv.braking || tv.crashed,
        headlightsOn: atmos.lightsOn || tvTunnelAmt > 0.38,
        leftBlink: tv.indicatorDir === -1 && indBlinkPhase,
        rightBlink: tv.indicatorDir === 1 && indBlinkPhase,
        hazardBlink: tv.crashed && hazardBlinkOn,
      });
    }

    if (this.replayPlaying) {
      const isRain = this.activeWeather === 'rain';
      if (this.replayCurDrifting || (isRain && Math.abs(this.playerSpeedMs) > 16)) {
        this.particleEmitAccum += dt * 20;
        while (this.particleEmitAccum >= 1) {
          this.particleEmitAccum -= 1;
          const carPos = this.playerRig.root.position;
          this.emitSurfaceParticle(
            carPos.x,
            carPos.y,
            carPos.z,
            'smoke',
            Math.abs(this.playerSpeedMs),
          );
        }
      }
    }
  }

  private pushReplayTelemetryNow(): void {
    if (!this.onReplayTelemetry) return;
    this.onReplayTelemetry({
      currentTime: this.replayPlaybackTime,
      duration: this.replayDuration,
      playing: this.replayPlaying,
      speedMultiplier: this.replaySpeed,
      angle: this.replayAngle,
      speedKmh: Math.round(Math.abs(this.playerSpeedMs) * 3.6),
      gear: this.playerGear,
      distanceM: Math.max(0, Math.round(this.playerS)),
    });
  }

  private flushBestRecordIfDirty(force = false): void {
    if (!this.bestRecordDirty) return;
    if (force || this.raceElapsedTime - this.lastBestPersistTime >= 20.0) {
      this.bestRecordDirty = false;
      this.lastBestPersistTime = this.raceElapsedTime;
      this.onHighScoreUpdate?.(this.bestScore, this.bestDistanceM);
    }
  }

  public setPaused(paused: boolean): void {
    if (this.screen !== 'playing') return;
    if (paused && (this.raceStatus === 'racing' || this.raceStatus === 'countdown')) {
      this.flushBestRecordIfDirty(true);
      this.raceStatus = 'paused';
      this.audio.setDividerScrape(0);
      this.audio.setPaused(true);
    } else if (!paused && this.raceStatus === 'paused') {
      this.raceStatus = this.countdownTimer > 0 ? 'countdown' : 'racing';
      this.audio.setPaused(false);
    }
  }

  public restartRace(): void {
    this.flushBestRecordIfDirty(true);
    this.startRace(
      this.currentLevel,
      this.currentVehicleId,
      this.currentPaintHex,
      this.cameraMode,
      this.bestScore,
      this.bestDistanceM,
    );
  }

  private positionPlayerWithGround(
    rig: VehicleRig,
    s: number,
    lat: number,
    headingRel: number,
  ): void {
    if (!this.world) return;
    this.world.sampleGroundAt(s, lat, _sampleA);

    rig.root.position.set(
      _sampleA.position.x + _sampleA.right.x * lat,
      _sampleA.position.y,
      _sampleA.position.z + _sampleA.right.z * lat,
    );

    _negFwd.copy(_sampleA.forward).negate();
    _mat4.makeBasis(_sampleA.right, _upAxis, _negFwd);
    _quat.setFromRotationMatrix(_mat4);

    if (Math.abs(headingRel) > 0.0001) {
      _yawQuat.setFromAxisAngle(_upAxis, headingRel);
      _quat.multiply(_yawQuat);
    }
    if (Math.abs(_sampleA.bankAngle) > 0.0001) {
      _rollQuat.setFromAxisAngle(_fwdAxis, _sampleA.bankAngle);
      _quat.multiply(_rollQuat);
    }
    rig.root.quaternion.copy(_quat);
  }

  private applyTrafficSampleToRig(
    rig: TrafficVehicleRig,
    sample: TrackSample,
    lat: number,
    headingRel: number,
  ): void {
    rig.root.position.set(
      sample.position.x + sample.right.x * lat,
      sample.position.y,
      sample.position.z + sample.right.z * lat,
    );

    _negFwd.copy(sample.forward).negate();
    _mat4.makeBasis(sample.right, _upAxis, _negFwd);
    _quat.setFromRotationMatrix(_mat4);

    if (Math.abs(headingRel) > 0.0001) {
      _yawQuat.setFromAxisAngle(_upAxis, headingRel);
      _quat.multiply(_yawQuat);
    }
    rig.root.quaternion.copy(_quat);
  }

  private positionTrafficOnTrack(
    rig: TrafficVehicleRig,
    s: number,
    lat: number,
    headingRel: number,
  ): void {
    if (!this.world) return;
    this.world.sampleAtDistance(s, _sampleB);
    this.applyTrafficSampleToRig(rig, _sampleB, lat, headingRel);
  }

  private emitSurfaceParticle(
    worldX: number,
    worldY: number,
    worldZ: number,
    kind: ParticleKind,
    speedMs: number,
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;

    p.active = true;
    p.life = 0;
    p.maxLife = kind === 'spark' ? 0.45 : 0.72;
    p.pos.set(
      worldX + (Math.random() - 0.5) * 0.4,
      worldY + (kind === 'spark' ? 0.65 : 0.18),
      worldZ + (Math.random() - 0.5) * 0.4,
    );
    if (kind === 'spark') {
      p.vel.set(
        (Math.random() - 0.5) * 10,
        2.5 + Math.random() * 6.5,
        (Math.random() - 0.5) * 10,
      );
      p.scale = 0.25 + Math.random() * 0.35;
    } else {
      p.vel.set(
        (Math.random() - 0.5) * 2.4,
        1.3 + Math.random() * 1.8,
        (Math.random() - 0.5) * 2.4,
      );
      p.scale = 0.45 + Math.min(0.9, speedMs / 45);
    }
    p.kind = kind;
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _pDummy.position.set(0, -100, 0);
        _pDummy.scale.setScalar(0.001);
        _pDummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _pDummy.matrix);
        continue;
      }

      p.pos.addScaledVector(p.vel, dt);
      if (p.kind === 'spark') {
        p.vel.y -= 11.5 * dt;
      } else {
        p.vel.multiplyScalar(0.95);
      }

      const norm = p.life / p.maxLife;
      const curScale =
        p.kind === 'spark'
          ? p.scale * (1.0 - norm * 0.7)
          : p.scale * (0.6 + norm * 1.6);

      _pDummy.position.copy(p.pos);
      _pDummy.scale.setScalar(Math.max(0.01, curScale));
      _pDummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _pDummy.matrix);

      if (p.kind === 'spark') {
        _pColor.setHex(norm < 0.45 ? 0xfbbf24 : 0xea580c);
      } else if (this.activeWeather === 'rain') {
        _pColor.setHex(0xcbd5e1);
      } else {
        _pColor.setHex(0xd6d3d1);
      }
      this.particleMesh.setColorAt(i, _pColor);
    }

    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private beginCrashSlowMotion(
    reason: string,
    impactSpeedMs: number,
    clearSide: -1 | 1,
  ): void {
    if (this.raceStatus !== 'racing' || this.crashSlowMoActive) return;
    this.raceStatus = 'accident';
    this.accidentTimer = 0;
    this.accidentNotified = false;
    this.accidentSpeedKmh = Math.round(Math.abs(impactSpeedMs) * 3.6);
    this.accidentReason = reason;

    this.crashSlowMoActive = true;
    this.crashSlowMoElapsed = 0;
    this.timeScale = 0.24;
    this.hitstopTimer = 0;
    this.crashCamAngle = 0;
    this.crashCamSide = clearSide;

    // Seed smoothCamPos/Look from active camera so cockpit/front views glide back smoothly
    this.smoothCamPos.copy(this.camera.position);
    if (this.playerRig) {
      this.smoothCamLook.copy(this.playerRig.root.position);
      this.smoothCamLook.y += this.currentVehicleId === 'bus' ? 1.5 : 1.05;
    }

    this.flushBestRecordIfDirty(true);

    this.wasTouchingDivider = 0;
    this.dividerSparkAccum = 0;
    this.audio.setDividerScrape(0);
    this.audio.playAccidentCrash();

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(70);
      } catch {
        // Ignore vibration denial
      }
    }
  }

  private triggerAccident(tv: TrafficVehicleState): void {
    if (this.raceStatus !== 'racing' || this.crashSlowMoActive) return;

    const dx = tv.lat - this.playerLat;
    const clearSide: -1 | 1 = dx >= 0 ? -1 : 1;
    const reason =
      tv.dir < 0
        ? `Head-on collision with oncoming ${tv.rig.label}`
        : `Collided with ${tv.rig.label}`;

    this.beginCrashSlowMotion(reason, this.playerSpeedMs, clearSide);

    tv.crashed = true;
    tv.braking = true;
    tv.speedMs = Math.max(2.5, Math.abs(tv.speedMs) * 0.35);

    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.playerSpeedMs) / 38, 0.45, 1.0);
    this.shakeIntensity = 0.24 + 0.14 * speedFactor;

    if (this.playerRig) {
      const p = this.playerRig.root.position;
      for (let k = 0; k < 16; k++) {
        this.emitSurfaceParticle(p.x, p.y, p.z, 'spark', 32);
      }
      for (let k = 0; k < 10; k++) {
        this.emitSurfaceParticle(p.x, p.y + 0.35, p.z, 'smoke', 24);
      }
    }

    this.playerHeadingRel = THREE.MathUtils.clamp(
      this.playerHeadingRel + (dx >= 0 ? -0.34 : 0.34) * speedFactor,
      -0.78,
      0.78,
    );
    this.playerDriftAngle = (dx >= 0 ? -0.22 : 0.22) * speedFactor;
    this.suspPitch = 0.08 * speedFactor;
    this.suspRoll = (dx >= 0 ? 0.11 : -0.11) * speedFactor;
    this.suspHeave = 0.03 * speedFactor;
    this.playerSpeedMs =
      Math.sign(this.playerSpeedMs || 1) * Math.max(9.5, Math.abs(this.playerSpeedMs) * 0.56);
  }

  private triggerBarrierAccident(side: -1 | 1, absSpeed: number): void {
    if (this.raceStatus !== 'racing' || this.crashSlowMoActive) return;

    this.beginCrashSlowMotion(
      'High-speed crash into highway guardrail',
      absSpeed,
      (side === -1 ? 1 : -1) as -1 | 1,
    );

    const speedFactor = THREE.MathUtils.clamp(absSpeed / 44, 0.55, 1.0);
    this.shakeIntensity = 0.22 + 0.14 * speedFactor;

    if (this.playerRig) {
      const p = this.playerRig.root.position;
      const sparkX = p.x + _sampleA.right.x * side * (this.playerRig.halfWidth * 0.95);
      const sparkZ = p.z + _sampleA.right.z * side * (this.playerRig.halfWidth * 0.95);
      for (let k = 0; k < 16; k++) {
        this.emitSurfaceParticle(sparkX, p.y + 0.35, sparkZ, 'spark', absSpeed);
      }
      for (let k = 0; k < 10; k++) {
        this.emitSurfaceParticle(p.x, p.y + 0.3, p.z, 'smoke', absSpeed * 0.6);
      }
    }

    this.playerHeadingRel = -side * (0.28 + 0.12 * speedFactor);
    this.playerDriftAngle = -side * 0.22 * speedFactor;
    this.suspPitch = 0.075 * speedFactor;
    this.suspRoll = side * 0.11 * speedFactor;
    this.suspHeave = 0.028 * speedFactor;
    this.playerSpeedMs = Math.sign(this.playerSpeedMs || 1) * Math.max(9.0, absSpeed * 0.52);
  }

  private resetExhaustFlameState(): void {
    this.exhaustBurstTimer = 0;
    this.exhaustBurstDuration = 0.16;
    this.exhaustCooldownTimer = 0.45;
    this.exhaustOverrunCooldown = 0;
    this.prevThrottleForFlame = 0;
    this.prevGearForFlame = 1;
    this.currentExhaustFlame = 0;
  }

  private updateExhaustFlames(dt: number, throttle: number): void {
    const isCombustionFlameVehicle =
      this.currentVehicleId === 'lamborghini' || this.currentVehicleId === 'scorpio';
    if (this.raceStatus !== 'racing' || !isCombustionFlameVehicle) {
      this.exhaustBurstTimer = 0;
      this.currentExhaustFlame = 0;
      this.prevThrottleForFlame = throttle;
      this.prevGearForFlame = this.playerGear;
      return;
    }

    const speedKmh = Math.abs(this.playerSpeedMs) * 3.6;
    const minKmh = this.currentVehicleId === 'lamborghini' ? 152 : 148;

    this.exhaustOverrunCooldown = Math.max(0, this.exhaustOverrunCooldown - dt);
    this.exhaustCooldownTimer = Math.max(0, this.exhaustCooldownTimer - dt);

    if (speedKmh >= minKmh && this.playerSpeedMs > 0) {
      const liftOffOverrun =
        this.prevThrottleForFlame > 0.45 &&
        throttle < 0.12 &&
        this.exhaustOverrunCooldown <= 0;
      const highSpeedUpshift =
        this.playerGear > this.prevGearForFlame && throttle > 0.35;
      const highThrottleBurst =
        throttle > 0.65 &&
        this.exhaustCooldownTimer <= 0 &&
        this.exhaustBurstTimer <= 0;

      if (
        this.exhaustBurstTimer <= 0 &&
        (liftOffOverrun || highSpeedUpshift || highThrottleBurst)
      ) {
        this.exhaustBurstDuration =
          this.currentVehicleId === 'lamborghini'
            ? 0.11 + Math.random() * 0.13
            : 0.1 + Math.random() * 0.09;
        this.exhaustBurstTimer = this.exhaustBurstDuration;
        this.exhaustCooldownTimer = this.playerNitroActive
          ? 0.34 + Math.random() * 0.5
          : 0.65 + Math.random() * 0.95;
        if (liftOffOverrun) {
          this.exhaustOverrunCooldown = 0.72;
        }
        this.audio.playExhaustFlamePop(this.currentVehicleId, liftOffOverrun);
      }
    } else if (this.exhaustBurstTimer > 0 && speedKmh < minKmh - 12) {
      this.exhaustBurstTimer = 0;
    }

    if (this.exhaustBurstTimer > 0) {
      this.exhaustBurstTimer = Math.max(0, this.exhaustBurstTimer - dt);
      const progress =
        1 - this.exhaustBurstTimer / Math.max(0.05, this.exhaustBurstDuration);
      const envelope =
        progress < 0.18
          ? progress / 0.18
          : Math.pow(Math.max(0, 1 - (progress - 0.18) / 0.82), 1.45);
      const speedScale = THREE.MathUtils.clamp((speedKmh - minKmh) / 85, 0.74, 1.0);
      const nitroBoost = this.playerNitroActive ? 1.0 : 0.88;
      this.currentExhaustFlame = THREE.MathUtils.clamp(
        envelope * speedScale * nitroBoost,
        0,
        1,
      );
    } else {
      this.currentExhaustFlame = 0;
    }

    this.prevThrottleForFlame = throttle;
    this.prevGearForFlame = this.playerGear;
  }

  private updatePlayerPhysics(dt: number): void {
    if (!this.world || !this.playerRig) return;

    const spec = VEHICLES[this.currentVehicleId];
    this.world.sampleGroundAt(this.playerS, this.playerLat, _sampleA);
    const isRain = this.activeWeather === 'rain';

    let throttle = this.controlsInput.throttle;
    const reverseHold = this.controlsInput.reverse;
    let brake = Math.max(this.controlsInput.brake, reverseHold);
    let steerRaw = this.controlsInput.steer * this.steeringSensitivity;
    let handbrake = this.controlsInput.handbrake;
    const wantNitro =
      this.controlsInput.nitro &&
      this.raceStatus === 'racing' &&
      throttle > 0.1 &&
      this.playerNitro > 1.5;

    if (wantNitro) {
      this.playerNitro = Math.max(0, this.playerNitro - dt * 26);
      this.playerNitroActive = true;
    } else {
      this.playerNitroActive = false;
      if (this.raceStatus === 'racing') {
        this.playerNitro = Math.min(100, this.playerNitro + dt * 6.5);
      }
    }

    if (this.raceStatus === 'countdown') {
      throttle = 0;
      brake = 1;
      handbrake = false;
      this.playerRpm =
        880 + this.controlsInput.throttle * 2600 + Math.sin(performance.now() * 0.03) * 40;
    } else if (this.raceStatus === 'accident') {
      throttle = 0;
      brake = 1;
      steerRaw = 0;
      handbrake = true;
    }

    steerRaw = THREE.MathUtils.clamp(steerRaw, -1, 1);

    const topSpeedMs = (spec.topSpeedKmh / 3.6) * (this.playerNitroActive ? 1.18 : 1.0);
    const speedRatio = Math.min(1, Math.abs(this.playerSpeedMs) / (spec.topSpeedKmh / 3.6));
    const maxWheelSteer = THREE.MathUtils.lerp(0.48, 0.24, speedRatio * 0.8);
    const targetWheelSteer = -steerRaw * maxWheelSteer;
    this.playerSteerAngle = THREE.MathUtils.damp(
      this.playerSteerAngle,
      targetWheelSteer,
      11,
      dt,
    );

    if (this.raceStatus === 'racing' || this.raceStatus === 'accident') {
      const isFormulaEv = this.currentVehicleId === 'nissan';
      const surfaceGrip = isFormulaEv ? (isRain ? 0.91 : 1.04) : isRain ? 0.84 : 1.0;

      let accel = 0;
      if (throttle > 0.01) {
        const torqueCurve = isFormulaEv
          ? 1.0 - Math.pow(Math.min(1, speedRatio), 2.2) * 0.62
          : 1.0 - Math.pow(Math.min(1, speedRatio), 1.55) * 0.78;
        const nitroBonus = this.playerNitroActive ? 1.52 : 1.0;
        accel += throttle * spec.acceleration * nitroBonus * torqueCurve;
      }

      if (brake > 0.01) {
        if (this.playerSpeedMs > 0.4) {
          accel -= brake * spec.braking * surfaceGrip;
        } else if (this.raceStatus === 'racing' && throttle < 0.05) {
          accel -= brake * 7.2;
        }
      }

      if (handbrake && Math.abs(this.playerSpeedMs) > 0.5) {
        accel -=
          Math.sign(this.playerSpeedMs) *
          (this.raceStatus === 'accident' ? 24 : 16.5) *
          surfaceGrip;
      }

      const drag =
        0.0095 * this.playerSpeedMs * Math.abs(this.playerSpeedMs) +
        0.32 * Math.sign(this.playerSpeedMs);
      const slopeGravity = 9.81 * _sampleA.slope * 0.65;

      this.prevSpeedMs = this.playerSpeedMs;
      this.playerSpeedMs += (accel - drag - slopeGravity) * dt;
      this.playerSpeedMs = THREE.MathUtils.clamp(
        this.playerSpeedMs,
        -12.5,
        topSpeedMs,
      );

      if (
        Math.abs(this.playerSpeedMs) < 0.25 &&
        throttle < 0.02 &&
        (brake < 0.02 || this.raceStatus === 'accident')
      ) {
        this.playerSpeedMs = 0;
      }

      const turnFactor =
        (Math.abs(this.playerSpeedMs) / (3.2 + Math.abs(this.playerSpeedMs) * 0.13)) *
        Math.sign(this.playerSpeedMs || 1);
      const yawInput = this.playerSteerAngle * turnFactor * spec.handling * 1.62;

      const driftTarget =
        handbrake && Math.abs(this.playerSpeedMs) > 9
          ? this.playerSteerAngle * 0.95
          : (1 - surfaceGrip) * this.playerSteerAngle * speedRatio * 0.75;
      this.playerDriftAngle = THREE.MathUtils.damp(
        this.playerDriftAngle,
        driftTarget,
        handbrake ? 5.5 : isFormulaEv ? 5.8 : 4.2,
        dt,
      );

      const roadCurveNextS = this.playerS + this.playerSpeedMs * dt;
      this.world.sampleAtDistance(roadCurveNextS, _sampleB);
      const crossTangentY =
        _sampleA.forward.z * _sampleB.forward.x -
        _sampleA.forward.x * _sampleB.forward.z;

      if (this.raceStatus !== 'accident') {
        this.playerHeadingRel += yawInput * dt - crossTangentY * 0.48;
        this.playerHeadingRel = THREE.MathUtils.clamp(
          this.playerHeadingRel,
          -0.88,
          0.88,
        );
        if (Math.abs(steerRaw) < 0.05 && !handbrake) {
          this.playerHeadingRel = THREE.MathUtils.damp(
            this.playerHeadingRel,
            0,
            isFormulaEv ? 2.6 : 2.2,
            dt,
          );
        }
      }

      const moveHeading = this.playerHeadingRel - this.playerDriftAngle * 0.45;
      const ds = Math.cos(moveHeading) * this.playerSpeedMs * dt;
      const dLat = -Math.sin(moveHeading) * this.playerSpeedMs * dt;

      this.playerS = Math.max(-15, this.playerS + ds);
      this.playerLat += dLat;

      // Stream endless mountain highway chunks smoothly around new position
      this.world.updateAtDistance(this.playerS);

      // Steel Guardrail Shoulder Boundary (left & right divider impact + continuous rail scraping audio)
      if (this.dividerSoundCooldown > 0) {
        this.dividerSoundCooldown = Math.max(0, this.dividerSoundCooldown - dt);
      }
      this.world.sampleGroundAt(this.playerS, this.playerLat, _sampleA);
      const barrierLimit = Math.max(
        2.4,
        this.currentLevel.roadWidth * 0.5 + 0.56 - (this.playerRig?.halfWidth ?? 0.94),
      );
      const hitLeft = this.playerLat < -barrierLimit;
      const hitRight = this.playerLat > barrierLimit;
      if (hitLeft || hitRight) {
        const side: -1 | 1 = hitLeft ? -1 : 1;
        const isNewHit = this.wasTouchingDivider !== side;
        this.playerLat = side * barrierLimit;
        const absSpeed = Math.abs(this.playerSpeedMs);
        const latVel = -Math.sin(moveHeading) * this.playerSpeedMs;
        const intoWallSpeed = side === -1 ? -latVel : latVel;

        if (
          this.raceStatus === 'racing' &&
          isNewHit &&
          absSpeed >= 27.5 &&
          intoWallSpeed >= 9.2 &&
          Math.abs(this.playerHeadingRel) >= 0.27
        ) {
          this.triggerBarrierAccident(side, absSpeed);
        } else {
          if (isNewHit) {
            this.playerHeadingRel =
              -side * Math.min(0.14, Math.abs(this.playerHeadingRel) * 0.35 + 0.04);
            this.suspRoll = side * 0.045;
            if (absSpeed > 2.2) {
              this.playerSpeedMs *= 0.89;
            }
          } else {
            this.playerHeadingRel *= 0.58;
            if (absSpeed > 2.2) {
              this.playerSpeedMs *= Math.max(0.96, 1 - dt * 0.55);
            }
          }

          if (this.raceStatus === 'racing' && absSpeed > 2.2) {
            const carPos = this.playerRig.root.position;
            const sparkX =
              carPos.x + _sampleA.right.x * side * (this.playerRig.halfWidth * 0.95);
            const sparkZ =
              carPos.z + _sampleA.right.z * side * (this.playerRig.halfWidth * 0.95);

          if (isNewHit && this.dividerSoundCooldown <= 0) {
            this.dividerSoundCooldown = 0.42;
            const impactIntensity = THREE.MathUtils.clamp(absSpeed / 36, 0.25, 1.0);
            this.audio.playDividerCollision(impactIntensity);
            this.shakeIntensity = Math.max(
              this.shakeIntensity,
              0.07 + impactIntensity * 0.11,
            );
            for (let sp = 0; sp < 5; sp++) {
              this.emitSurfaceParticle(
                sparkX,
                carPos.y + 0.35,
                sparkZ,
                'spark',
                absSpeed,
              );
            }
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              try {
                navigator.vibrate(32);
              } catch {
                // Ignore vibration denial
              }
            }
          }

          if (absSpeed > 3.5) {
            const scrapeIntensity = THREE.MathUtils.clamp(
              (absSpeed - 3.5) / 42,
              0.18,
              1.0,
            );
            this.audio.setDividerScrape(scrapeIntensity);
            this.shakeIntensity = Math.max(
              this.shakeIntensity,
              0.015 + scrapeIntensity * 0.022,
            );
            this.dividerSparkAccum += dt * (8 + scrapeIntensity * 14);
            while (this.dividerSparkAccum >= 1) {
              this.dividerSparkAccum -= 1;
              this.emitSurfaceParticle(
                sparkX,
                carPos.y + 0.32,
                sparkZ,
                'spark',
                absSpeed,
              );
            }
            } else {
              this.audio.setDividerScrape(0);
            }
          } else {
            this.audio.setDividerScrape(0);
          }
          this.wasTouchingDivider = side;
        }
      } else if (this.wasTouchingDivider !== 0) {
        this.wasTouchingDivider = 0;
        this.dividerSparkAccum = 0;
        this.audio.setDividerScrape(0);
      }

      // Formula E direct-drive EV telemetry vs. 6-Speed Sequential Transmission
      const speedKmh = Math.abs(this.playerSpeedMs) * 3.6;
      if (isFormulaEv) {
        const targetEvGear = this.playerSpeedMs < -0.5 ? -1 : 1;
        if (targetEvGear !== this.playerGear) {
          this.playerGear = targetEvGear;
          this.gearShiftAnim = 0.65;
          if (this.raceStatus === 'racing') {
            this.audio.playGearShift();
          }
        }
        if (this.gearShiftAnim > 0) {
          this.gearShiftAnim = Math.max(0, this.gearShiftAnim - dt * 3.0);
        }
        const targetRpm =
          this.raceStatus === 'accident'
            ? 850
            : 900 + speedRatio * 3400 + throttle * 220;
        this.playerRpm = THREE.MathUtils.damp(this.playerRpm, targetRpm, 10, dt);
      } else {
        let targetGear = 1;
        if (this.playerSpeedMs < -0.5) targetGear = -1;
        else if (speedKmh < 26) targetGear = 1;
        else if (speedKmh < 54) targetGear = 2;
        else if (speedKmh < 86) targetGear = 3;
        else if (speedKmh < 122) targetGear = 4;
        else if (speedKmh < 156) targetGear = 5;
        else targetGear = 6;

        if (targetGear !== this.playerGear) {
          this.playerGear = targetGear;
          this.gearShiftAnim = 1.0;
          if (this.raceStatus === 'racing') {
            this.audio.playGearShift();
          }
        }
        if (this.gearShiftAnim > 0) {
          this.gearShiftAnim = Math.max(0, this.gearShiftAnim - dt * 2.6);
        }

        const gearSpans = [0, 28, 56, 88, 124, 158, 196];
        const gIdx = Math.max(1, this.playerGear);
        const gLow = gearSpans[gIdx - 1] * 0.65;
        const gHigh = gearSpans[gIdx];
        const gearFrac = THREE.MathUtils.clamp(
          (speedKmh - gLow) / Math.max(10, gHigh - gLow),
          0,
          1,
        );
        const targetRpm =
          this.raceStatus === 'accident'
            ? 800
            : 900 + gearFrac * 3100 + throttle * 420;
        this.playerRpm = THREE.MathUtils.damp(this.playerRpm, targetRpm, 9, dt);
      }

      const longG = (this.playerSpeedMs - this.prevSpeedMs) / Math.max(0.008, dt);
      const targetPitch = THREE.MathUtils.clamp(longG * 0.0038, -0.055, 0.055);
      const targetRoll = THREE.MathUtils.clamp(
        (-this.playerSteerAngle * speedRatio * 0.14) / spec.suspensionStiffness,
        -0.065,
        0.065,
      );
      this.suspPitch = THREE.MathUtils.damp(this.suspPitch, targetPitch, 8, dt);
      this.suspRoll = THREE.MathUtils.damp(this.suspRoll, targetRoll, 8, dt);
      this.suspHeave = 0;

      this.playerWheelSpin += (this.playerSpeedMs * dt) / (this.playerRig?.wheelRadius ?? 0.41);

      const isDrifting =
        Math.abs(this.playerDriftAngle) > 0.14 ||
        (handbrake && Math.abs(this.playerSpeedMs) > 8);
      if (isDrifting || (isRain && Math.abs(this.playerSpeedMs) > 16)) {
        this.particleEmitAccum += dt * 22;
        while (this.particleEmitAccum >= 1) {
          this.particleEmitAccum -= 1;
          const carPos = this.playerRig.root.position;
          this.emitSurfaceParticle(
            carPos.x,
            carPos.y,
            carPos.z,
            'smoke',
            Math.abs(this.playerSpeedMs),
          );
        }
      }

      if (
        (isDrifting ||
          (brake > 0.7 && this.playerSpeedMs > 18) ||
          this.raceStatus === 'accident') &&
        Math.abs(this.playerSpeedMs) > 3.2
      ) {
        this.skidEmitAccum += dt * 18;
        if (this.skidEmitAccum >= 1) {
          this.skidEmitAccum = 0;
          this.emitSkidMarks();
        }
      }

      // Live Endless Score, Distance & Instant Best-Record Updates
      if (this.raceStatus === 'racing') {
        if (this.playerS > this.maxDistanceM) {
          this.maxDistanceM = this.playerS;
        }
        if (speedKmh >= 90) {
          this.scoreBonusAccum += dt * (8 + ((speedKmh - 90) / 160) * 32);
        }
        if (isDrifting && speedKmh >= 55) {
          this.scoreBonusAccum += dt * 18;
        }
        this.currentScore = Math.max(0, Math.floor(this.maxDistanceM + this.scoreBonusAccum));

        const roundedDist = Math.max(0, Math.floor(this.maxDistanceM));
        if (this.currentScore > this.bestScore) {
          this.bestScore = this.currentScore;
          this.isNewBestScore = true;
          this.bestRecordDirty = true;
        }
        if (roundedDist > this.bestDistanceM) {
          this.bestDistanceM = roundedDist;
          this.bestRecordDirty = true;
        }
        this.flushBestRecordIfDirty(false);
      }
    }

    const visualHeading = this.playerHeadingRel + this.playerDriftAngle * 0.65;
    this.positionPlayerWithGround(
      this.playerRig,
      this.playerS,
      this.playerLat,
      visualHeading,
    );

    const hideHead =
      this.screen === 'playing' &&
      this.raceStatus !== 'accident' &&
      (this.cameraMode === 'driver' || this.cameraMode === 'steering');
    const atmos = getWeatherAtmosphere(this.activeWeather);
    const playerTunnelAmt = this.world?.getTunnelFactorAt(this.playerS) ?? 0;
    const hazardActive = this.raceStatus === 'accident' || this.playerHazard;
    const blinkOn = Math.floor(performance.now() * 0.004) % 2 === 0;
    const isReversing = this.playerGear === -1 || this.playerSpeedMs < -0.3;
    this.updateExhaustFlames(dt, throttle);

    this.playerRig.updateVisuals({
      steerAngle: this.playerSteerAngle,
      wheelSpinRad: this.playerWheelSpin,
      braking: brake > 0.1 || handbrake || this.raceStatus === 'accident',
      reversing: isReversing,
      headlightsOn: atmos.lightsOn || this.playerHighBeam || playerTunnelAmt > 0.38,
      highBeamOn: this.playerHighBeam,
      leftBlinkOn: this.playerIndicatorDir === -1 && blinkOn,
      rightBlinkOn: this.playerIndicatorDir === 1 && blinkOn,
      hazardActive,
      hazardBlinkOn: hazardActive && blinkOn,
      pitchRad: this.suspPitch,
      rollRad: this.suspRoll,
      heaveY: this.suspHeave,
      gearShiftAnim: this.gearShiftAnim,
      roadBump: 0,
      hideDriverHead: hideHead,
      exhaustFlame: this.currentExhaustFlame,
    });
  }

  private updateTrafficVehicles(dt: number): void {
    if (!this.world || !this.playerRig) return;
    const atmos = getWeatherAtmosphere(this.activeWeather);
    const hazardBlinkOn = Math.floor(this.accidentTimer * 4) % 2 === 0;
    const indicatorBlinkOn = Math.floor(this.raceElapsedTime * 3.6) % 2 === 0;
    const roadW = this.currentLevel.roadWidth;

    // Gradually scale active highway traffic with distance driven
    const { count: targetActiveCount, tier } = this.getTrafficTargetCountAndTier(this.maxDistanceM);
    if (tier > this.activeTrafficTier) {
      this.activeTrafficTier = tier;
      for (let k = 0; k < targetActiveCount && k < this.trafficVehicles.length; k++) {
        const slot = this.trafficVehicles[k];
        if (!slot.active) {
          slot.active = true;
          slot.crashed = false;
          slot.overtaken = false;
          slot.pendingTargetLat = null;
          slot.indicatorDir = 0;
          slot.baseSpeedMs = this.computeDynamicBaseSpeed(slot.kind, slot.dir, this.maxDistanceM);
          slot.speedMs = slot.baseSpeedMs;
          const pos = this.pickSafeSpawnAhead(k, slot, 230, 175);
          slot.s = pos.s;
          slot.lat = pos.lat;
          slot.targetLat = pos.lat;
          if (slot.rig.loaded) {
            slot.rig.root.visible = true;
          }
          this.positionTrafficOnTrack(
            slot.rig,
            slot.s,
            slot.lat,
            slot.dir === -1 ? Math.PI : 0,
          );
        }
      }
    }

    this.world.sampleGroundAt(this.playerS, this.playerLat, _sampleA);
    const playerY = _sampleA.position.y;
    const pHalfL = this.playerRig.halfLength;
    const pHalfW = this.playerRig.halfWidth;
    const playerSpeedKmh = Math.abs(this.playerSpeedMs) * 3.6;

    for (let i = 0; i < this.trafficVehicles.length; i++) {
      const tv = this.trafficVehicles[i];
      if (!tv.active || !tv.rig.loaded) {
        if (!tv.active) tv.rig.root.visible = false;
        continue;
      }
      tv.rig.root.visible = true;

      let hasSample = false;
      if (this.raceStatus === 'racing' && !tv.crashed) {
        let targetSpeed = tv.baseSpeedMs;
        let blockedAhead = false;
        let minAheadGap = Infinity;
        let blockingVehicleSpeed = tv.baseSpeedMs;
        tv.braking = false;

        for (let j = 0; j < this.trafficVehicles.length; j++) {
          if (i === j) continue;
          const other = this.trafficVehicles[j];
          if (!other.active || !other.rig.loaded) continue;
          if (
            other.dir !== tv.dir ||
            Math.abs(other.lat - tv.lat) > tv.rig.halfWidth + other.rig.halfWidth + 0.45
          ) {
            continue;
          }
          const centerDist = (other.s - tv.s) * tv.dir;
          const bumperGap = centerDist - (tv.rig.halfLength + other.rig.halfLength);
          if (centerDist > 0 && bumperGap < 24) {
            targetSpeed = Math.min(targetSpeed, Math.max(0, other.speedMs * 0.92));
            tv.braking = bumperGap < 12;
            blockedAhead = true;
            if (bumperGap < minAheadGap) {
              minAheadGap = bumperGap;
              blockingVehicleSpeed = other.speedMs;
            }
          }
        }

        if (minAheadGap < 2.4) {
          tv.speedMs = Math.min(tv.speedMs, Math.max(0, blockingVehicleSpeed * 0.85));
          tv.braking = true;
        } else if (tv.speedMs < targetSpeed) {
          tv.speedMs = Math.min(targetSpeed, tv.speedMs + 6 * dt);
        } else {
          tv.speedMs = Math.max(targetSpeed, tv.speedMs - 14 * dt);
        }

        const isLaneClear = (candLat: number): boolean => {
          for (let j = 0; j < this.trafficVehicles.length; j++) {
            if (i === j) continue;
            const other = this.trafficVehicles[j];
            if (!other.active || !other.rig.loaded) continue;
            if (Math.abs(other.lat - candLat) < tv.rig.halfWidth + other.rig.halfWidth + 0.7) {
              const gap = Math.abs(other.s - tv.s) - (tv.rig.halfLength + other.rig.halfLength);
              if (gap < 9.5) return false;
            }
          }
          return true;
        };

        // Pre-Signaled Lane Changes (~1.55s blink lead before steering laterally)
        if (tv.pendingTargetLat !== null) {
          tv.indicatorLeadTimer -= dt;
          if (tv.indicatorLeadTimer <= 0) {
            const nearPlayer = Math.abs(tv.s - this.playerS) < pHalfL + tv.rig.halfLength + 7.5;
            if (nearPlayer || !isLaneClear(tv.pendingTargetLat)) {
              tv.indicatorLeadTimer = 0.25;
            } else {
              tv.targetLat = tv.pendingTargetLat;
              tv.pendingTargetLat = null;
            }
          }
        } else if (Math.abs(tv.targetLat - tv.lat) > 0.12) {
          const step = THREE.MathUtils.clamp((tv.targetLat - tv.lat) * 2.2, -1.75, 1.75) * dt;
          tv.lat += step;
        } else {
          tv.lat = tv.targetLat;
          tv.indicatorDir = 0;
          tv.laneChangeTimer -= dt * (blockedAhead ? 2.5 : 1.0);
          if (tv.laneChangeTimer <= 0 && tv.s - this.playerS > 30 && tv.s - this.playerS < 185) {
            tv.laneChangeTimer = 3.8 + Math.random() * 3.6;
            const outerLane = tv.dir === 1 ? -(roadW * 0.32) : roadW * 0.32;
            const innerLane = tv.dir === 1 ? -(roadW * 0.14) : roadW * 0.14;
            const nextLane = Math.abs(tv.lat - outerLane) < 0.7 ? innerLane : outerLane;
            if (isLaneClear(nextLane)) {
              tv.pendingTargetLat = nextLane;
              const worldDelta = nextLane - tv.lat;
              tv.indicatorDir =
                tv.dir === 1
                  ? worldDelta < 0
                    ? -1
                    : 1
                  : worldDelta < 0
                  ? 1
                  : -1;
              tv.indicatorLeadTimer = 1.55;
            }
          }
        }

        tv.s += tv.dir * tv.speedMs * dt;
        tv.wheelSpin += (tv.speedMs * dt) / tv.rig.wheelRadius;

        // Clean Highway Overtakes + Close Near-Miss Scoring
        if (!tv.overtaken && this.playerS > tv.s + pHalfL + 2.2) {
          tv.overtaken = true;
          this.overtakesCount++;
          const lateralGap = Math.abs(this.playerLat - tv.lat);
          const nearMiss = lateralGap < pHalfW + tv.rig.halfWidth + 1.5 && playerSpeedKmh >= 105;
          this.scoreBonusAccum += nearMiss ? 225 : 150;
          this.bestRecordDirty = true;
        }

        // Seamless Endless Recycling Safely Ahead of Player
        if (
          (tv.dir === 1 && tv.s < this.playerS - 85) ||
          (tv.dir === -1 && tv.s < this.playerS - 55)
        ) {
          tv.baseSpeedMs = this.computeDynamicBaseSpeed(tv.kind, tv.dir, this.maxDistanceM);
          tv.speedMs = tv.baseSpeedMs;
          const pos = this.pickSafeSpawnAhead(i, tv, 210, 200);
          tv.s = pos.s;
          tv.lat = pos.lat;
          tv.targetLat = pos.lat;
          tv.overtaken = false;
          tv.pendingTargetLat = null;
          tv.indicatorDir = 0;
        }

        // Instant Accident Detection on Contact
        this.world.sampleAtDistance(tv.s, _sampleB);
        hasSample = true;
        const dz = Math.abs(tv.s - this.playerS);
        const dx = Math.abs(tv.lat - this.playerLat);
        const dy = Math.abs(_sampleB.position.y - playerY);
        const hitLen = pHalfL + tv.rig.halfLength - 0.14;
        const hitWid = pHalfW + tv.rig.halfWidth - 0.12;

        if (dz < hitLen && dx < hitWid && dy < 1.85) {
          this.triggerAccident(tv);
        }
      } else if (this.raceStatus === 'accident') {
        const decel = tv.crashed ? 26 : 14;
        tv.speedMs = Math.max(0, tv.speedMs - decel * dt);
        tv.braking = tv.crashed || tv.speedMs > 1.0;
        tv.s += tv.dir * tv.speedMs * dt;
        tv.wheelSpin += (tv.speedMs * dt) / tv.rig.wheelRadius;
      }

      const isChangingLane =
        tv.pendingTargetLat === null && Math.abs(tv.targetLat - tv.lat) > 0.12;
      const steerTilt = isChangingLane
        ? THREE.MathUtils.clamp((tv.targetLat - tv.lat) * -0.07, -0.1, 0.1)
        : 0;
      const trafficSteerAngle = isChangingLane
        ? THREE.MathUtils.clamp((tv.targetLat - tv.lat) * -0.16 * tv.dir, -0.22, 0.22)
        : 0;
      if (!hasSample) {
        this.world.sampleAtDistance(tv.s, _sampleB);
      }
      this.applyTrafficSampleToRig(
        tv.rig,
        _sampleB,
        tv.lat,
        (tv.dir === -1 ? Math.PI : 0) + steerTilt,
      );
      const tvTunnelAmt = this.world.getTunnelFactorAt(tv.s);
      tv.rig.updateVisuals({
        wheelSpinRad: tv.wheelSpin,
        steerAngle: trafficSteerAngle,
        braking: tv.braking || tv.crashed,
        headlightsOn: atmos.lightsOn || tvTunnelAmt > 0.38,
        leftBlink: tv.indicatorDir === -1 && indicatorBlinkOn,
        rightBlink: tv.indicatorDir === 1 && indicatorBlinkOn,
        hazardBlink: tv.crashed && hazardBlinkOn,
      });
    }
  }

  private updateCamera(dt: number): void {
    if (this.screen === 'garage') {
      if (this.garagePresetPos && this.garagePresetTarget) {
        const k = 1 - Math.exp(-8.5 * dt);
        this.camera.position.lerp(this.garagePresetPos, k);
        this.orbitControls.target.lerp(this.garagePresetTarget, k);
        if (
          this.camera.position.distanceToSquared(this.garagePresetPos) < 0.002 &&
          this.orbitControls.target.distanceToSquared(this.garagePresetTarget) < 0.002
        ) {
          this.camera.position.copy(this.garagePresetPos);
          this.orbitControls.target.copy(this.garagePresetTarget);
          this.garagePresetPos = null;
          this.garagePresetTarget = null;
        }
      }
      this.orbitControls.update();
      return;
    }

    if (!this.playerRig) return;

    if (this.screen === 'title' || this.screen === 'levels' || this.screen === 'settings') {
      // Hero showroom orbit highlighting the latest uploaded racing car prominently above/right of menu controls
      this.titleCamAngle += dt * 0.2;
      const carPos = this.playerRig.root.position;
      const isBus = this.currentVehicleId === 'bus';
      const isSports =
        this.currentVehicleId === 'lamborghini' || this.currentVehicleId === 'nissan';
      const radius = isBus ? 10.6 : isSports ? 4.75 : 5.45;
      const camH = isBus ? 3.1 : isSports ? 1.48 : 1.95;
      const lookY = isBus ? 1.0 : isSports ? 0.38 : 0.56;

      this.camera.position.set(
        carPos.x + Math.sin(this.titleCamAngle) * radius,
        carPos.y + camH,
        carPos.z - Math.cos(this.titleCamAngle) * radius,
      );
      this.camera.lookAt(carPos.x, carPos.y + lookY, carPos.z);
      if (Math.abs(this.camera.fov - 44) > 0.2) {
        this.camera.fov = 44;
        this.camera.updateProjectionMatrix();
      }
      const atmos = getWeatherAtmosphere(this.activeWeather);
      this.sunLight.position.set(
        carPos.x + atmos.sunPos[0],
        carPos.y + atmos.sunPos[1],
        carPos.z + atmos.sunPos[2],
      );
      this.sunLight.target.position.copy(carPos);
      return;
    }

    const speedKmh = Math.abs(this.playerSpeedMs) * 3.6;

    if (this.raceStatus === 'accident') {
      this.crashCamAngle = Math.min(0.42, this.crashCamAngle + dt * 0.16);
      const p = this.playerRig.root.position;
      const isBus = this.currentVehicleId === 'bus';
      const backDist = isBus ? 7.8 : 5.6;
      const camHeight = isBus ? 2.85 : 2.15;
      const lookHeight = isBus ? 1.45 : 0.95;

      if (this.world) {
        this.world.sampleAtDistance(this.playerS, _sampleB);
        const sideOffset =
          this.crashCamSide * (2.35 + Math.sin(this.crashCamAngle) * 1.45);
        const safeCamLat = THREE.MathUtils.clamp(
          this.playerLat + sideOffset,
          -(this.currentLevel.roadWidth * 0.5 - 0.8),
          this.currentLevel.roadWidth * 0.5 - 0.8,
        );
        _camDesiredPos.set(
          _sampleB.position.x +
            _sampleB.right.x * safeCamLat -
            _sampleB.forward.x * backDist,
          _sampleB.position.y + camHeight,
          _sampleB.position.z +
            _sampleB.right.z * safeCamLat -
            _sampleB.forward.z * backDist,
        );
      } else {
        _camDesiredPos.set(
          p.x + this.crashCamSide * 2.6,
          p.y + camHeight,
          p.z + backDist,
        );
      }
      _camDesiredLook.set(p.x, p.y + lookHeight, p.z);

      const camFollowK = 1 - Math.exp(-5.4 * dt);
      this.smoothCamPos.lerp(_camDesiredPos, camFollowK);
      this.smoothCamLook.lerp(_camDesiredLook, 1 - Math.exp(-9.0 * dt));
      this.camera.position.copy(this.smoothCamPos);
      this.camera.lookAt(this.smoothCamLook);

      const slowFocusFov = this.crashSlowMoActive ? 54.5 : 57.0;
      if (Math.abs(this.camera.fov - slowFocusFov) > 0.15) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, slowFocusFov, 4.5, dt);
        this.camera.updateProjectionMatrix();
      }

      if (this.shakeIntensity > 0.002) {
        this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
        this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.85;
        this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.15);
      }

      const atmos = getWeatherAtmosphere(this.activeWeather);
      this.sunLight.position.set(
        p.x + atmos.sunPos[0],
        p.y + atmos.sunPos[1],
        p.z + atmos.sunPos[2],
      );
      this.sunLight.target.position.copy(p);
      return;
    }

    if (this.raceStatus === 'replay') {
      const p = this.playerRig.root.position;

      if (this.replayAngle === 'cinematic') {
        if (this.replayPlaying) {
          this.replayOrbitAngle += dt * 0.38;
        }
        const radius = this.currentVehicleId === 'bus' ? 8.8 : 5.9;
        const heightBase = this.currentVehicleId === 'bus' ? 2.55 : 1.85;
        _localOffset.set(
          Math.sin(this.replayOrbitAngle) * radius,
          heightBase + Math.sin(this.replayOrbitAngle * 0.7) * 0.35,
          Math.cos(this.replayOrbitAngle) * radius,
        );
        _localLook.set(0, this.currentVehicleId === 'bus' ? 1.5 : 1.05, -0.6);
        this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
        this.playerRig.root.localToWorld(_camDesiredLook.copy(_localLook));

        if (this.camSnapNext) {
          this.smoothCamPos.copy(_camDesiredPos);
          this.smoothCamLook.copy(_camDesiredLook);
          this.camSnapNext = false;
        } else {
          const k = 1 - Math.exp(-8.5 * dt);
          this.smoothCamPos.lerp(_camDesiredPos, k);
          this.smoothCamLook.lerp(_camDesiredLook, k);
        }
        this.camera.position.copy(this.smoothCamPos);
        this.camera.lookAt(this.smoothCamLook);
        if (Math.abs(this.camera.fov - 54) > 0.2) {
          this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 54, 6, dt);
          this.camera.updateProjectionMatrix();
        }
      } else if (this.replayAngle === 'trackside' && this.world) {
        const segmentSpan = 90;
        const anchorS =
          Math.floor((this.playerS + 28) / segmentSpan) * segmentSpan + 24;
        if (Math.abs(anchorS - this.replayTracksideAnchorS) > 1) {
          this.replayTracksideAnchorS = anchorS;
          this.world.sampleAtDistance(anchorS, _sampleB);
          const sideSign = Math.floor(anchorS / segmentSpan) % 2 === 0 ? -1 : 1;
          const vergeLat = sideSign * (this.currentLevel.roadWidth * 0.5 + 2.2);
          this.replayTracksidePos.set(
            _sampleB.position.x + _sampleB.right.x * vergeLat,
            _sampleB.position.y + 1.95,
            _sampleB.position.z + _sampleB.right.z * vergeLat,
          );
          this.smoothCamLook.set(p.x, p.y + 1.05, p.z);
        }
        this.camera.position.copy(this.replayTracksidePos);
        _camDesiredLook.set(p.x, p.y + 1.05, p.z);
        this.smoothCamLook.lerp(_camDesiredLook, 1 - Math.exp(-14 * dt));
        this.camera.lookAt(this.smoothCamLook);
        if (Math.abs(this.camera.fov - 46) > 0.2) {
          this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 46, 8, dt);
          this.camera.updateProjectionMatrix();
        }
      } else {
        const [cx, cy, cz] = this.playerRig.chaseCamOffset;
        _localOffset.set(
          cx - this.playerSteerAngle * 1.7 + Math.sin(this.replayPlaybackTime * 0.6) * 0.45,
          cy * 0.94,
          cz * 0.96,
        );
        _localLook.set(-this.playerSteerAngle * 2.1, cy * 0.5, -9.0);
        this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
        this.playerRig.root.localToWorld(_camDesiredLook.copy(_localLook));

        if (this.camSnapNext) {
          this.smoothCamPos.copy(_camDesiredPos);
          this.smoothCamLook.copy(_camDesiredLook);
          this.camSnapNext = false;
        } else {
          const posAlpha = 1 - Math.exp(-9.0 * dt);
          const lookAlpha = 1 - Math.exp(-14.0 * dt);
          this.smoothCamPos.lerp(_camDesiredPos, posAlpha);
          this.smoothCamLook.lerp(_camDesiredLook, lookAlpha);
        }
        this.camera.position.copy(this.smoothCamPos);
        this.camera.lookAt(this.smoothCamLook);
        const targetFov = 56 + Math.min(13, speedKmh * 0.068);
        if (Math.abs(this.camera.fov - targetFov) > 0.2) {
          this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
          this.camera.updateProjectionMatrix();
        }
      }

      const atmos = getWeatherAtmosphere(this.activeWeather);
      this.sunLight.position.set(
        p.x + atmos.sunPos[0],
        p.y + atmos.sunPos[1],
        p.z + atmos.sunPos[2],
      );
      this.sunLight.target.position.copy(p);
      return;
    }

    const nitroFovKick = this.playerNitroActive ? 7.5 : 0;

    if (this.cameraMode === 'driver') {
      const [ex, ey, ez] = this.playerRig.driverEyeOffset;
      _localOffset.set(ex, ey, ez);
      _localLook.set(ex - this.playerSteerAngle * 2.2, ey - 0.09, ez - 14.0);
      this.playerRig.bodyGroup.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.bodyGroup.localToWorld(_camDesiredLook.copy(_localLook));

      this.camera.position.copy(_camDesiredPos);
      this.camera.lookAt(_camDesiredLook);
      const targetFov = 64 + Math.min(8, speedKmh * 0.04) + nitroFovKick * 0.6;
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    } else if (this.cameraMode === 'steering') {
      const [sx, sy, sz] = this.playerRig.steeringEyeOffset;
      _localOffset.set(sx, sy, sz);
      _localLook.set(
        sx - 0.04 - this.playerSteerAngle * 1.4,
        sy - 0.22,
        this.playerRig.steeringLookZ,
      );
      this.playerRig.bodyGroup.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.bodyGroup.localToWorld(_camDesiredLook.copy(_localLook));

      this.camera.position.copy(_camDesiredPos);
      this.camera.lookAt(_camDesiredLook);
      const targetFov = 70 + nitroFovKick * 0.45;
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    } else if (this.cameraMode === 'front') {
      const [fx, fy, fz] = this.playerRig.frontCamOffset;
      _localOffset.set(fx, fy, fz);
      _localLook.set(-this.playerSteerAngle * 3.0, fy - 0.05, fz - 22.0);
      this.playerRig.bodyGroup.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.bodyGroup.localToWorld(_camDesiredLook.copy(_localLook));

      this.camera.position.copy(_camDesiredPos);
      this.camera.lookAt(_camDesiredLook);
      const targetFov = 68 + Math.min(12, speedKmh * 0.06) + nitroFovKick;
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    } else if (this.cameraMode === 'side') {
      const [sx, sy, sz] = this.playerRig.sideCamOffset;
      _localOffset.set(sx, sy, sz);
      _localLook.set(0.0, sy * 0.72, -1.2);
      this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.root.localToWorld(_camDesiredLook.copy(_localLook));

      if (this.camSnapNext) {
        this.smoothCamPos.copy(_camDesiredPos);
        this.smoothCamLook.copy(_camDesiredLook);
        this.camSnapNext = false;
      } else {
        const k = 1 - Math.exp(-10.5 * dt);
        this.smoothCamPos.lerp(_camDesiredPos, k);
        this.smoothCamLook.lerp(_camDesiredLook, k);
      }
      this.camera.position.copy(this.smoothCamPos);
      this.camera.lookAt(this.smoothCamLook);
      const targetFov = 54 + nitroFovKick * 0.5;
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
        this.camera.updateProjectionMatrix();
      }
    } else if (this.cameraMode === 'top') {
      const baseTopY = this.currentVehicleId === 'bus' ? 23.0 : 19.5;
      const topY = THREE.MathUtils.lerp(baseTopY, 8.2, this.currentTunnelFactor);
      const topZ = THREE.MathUtils.lerp(6.8, 9.6, this.currentTunnelFactor);
      _localOffset.set(0.0, topY, topZ);
      _localLook.set(0.0, 0.5, -7.5);
      this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.root.localToWorld(_camDesiredLook.copy(_localLook));

      if (this.camSnapNext) {
        this.smoothCamPos.copy(_camDesiredPos);
        this.smoothCamLook.copy(_camDesiredLook);
        this.camSnapNext = false;
      } else {
        const k = 1 - Math.exp(-8 * dt);
        this.smoothCamPos.lerp(_camDesiredPos, k);
        this.smoothCamLook.lerp(_camDesiredLook, k);
      }
      this.camera.position.copy(this.smoothCamPos);
      this.camera.lookAt(this.smoothCamLook);
      if (Math.abs(this.camera.fov - 56) > 0.2) {
        this.camera.fov = 56;
        this.camera.updateProjectionMatrix();
      }
    } else {
      const isClose = this.cameraMode === 'closeChase';
      const [baseCx, baseCy, baseCz] = this.playerRig.chaseCamOffset;
      const cx = baseCx;
      const cy = isClose ? baseCy * 0.84 : baseCy;
      const cz = isClose ? baseCz * 0.72 : baseCz;

      if (this.raceCamPointerId === null) {
        this.raceCamIdleTimer += dt;
        if (this.raceCamIdleTimer > 2.2) {
          this.raceCamYaw = THREE.MathUtils.damp(this.raceCamYaw, 0, 3.2, dt);
          this.raceCamPitch = THREE.MathUtils.damp(this.raceCamPitch, 0, 3.2, dt);
        }
      }

      const cosYaw = Math.cos(this.raceCamYaw);
      const sinYaw = Math.sin(this.raceCamYaw);
      const baseX = cx - this.playerSteerAngle * (isClose ? 1.1 : 1.4);
      const rotX = baseX * cosYaw + cz * sinYaw;
      const rotZ = -baseX * sinYaw + cz * cosYaw;
      let rotY = Math.max(0.85, cy + this.raceCamPitch * 3.0);
      if (this.currentTunnelFactor > 0.1) {
        rotY = Math.min(rotY, THREE.MathUtils.lerp(rotY, 7.6, this.currentTunnelFactor));
      }

      _localOffset.set(rotX, rotY, rotZ);
      _localLook.set(
        -this.playerSteerAngle * 1.5 - sinYaw * 3.0,
        cy * 0.56,
        cosYaw < 0 ? 4.0 : -10.5,
      );
      this.playerRig.root.localToWorld(_camDesiredPos.copy(_localOffset));
      this.playerRig.root.localToWorld(_camDesiredLook.copy(_localLook));

      if (this.world) {
        this.world.sampleAtDistance(this.playerS, _sampleB);
        _camDesiredPos.y = Math.max(_camDesiredPos.y, _sampleB.position.y + 0.65);
      }

      if (this.camSnapNext) {
        this.smoothCamPos.copy(_camDesiredPos);
        this.smoothCamLook.copy(_camDesiredLook);
        this.camSnapNext = false;
      } else {
        const posAlpha = 1 - Math.exp(-(isClose ? 11.5 : 9.5) * dt);
        const lookAlpha = 1 - Math.exp(-14.0 * dt);
        this.smoothCamPos.lerp(_camDesiredPos, posAlpha);
        this.smoothCamLook.lerp(_camDesiredLook, lookAlpha);
      }

      this.camera.position.copy(this.smoothCamPos);
      this.camera.lookAt(this.smoothCamLook);

      const targetFov = (isClose ? 60 : 58) + Math.min(11, speedKmh * 0.055) + nitroFovKick * 0.8;
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
        this.camera.updateProjectionMatrix();
      }
    }

    const speedVibe =
      this.playerNitroActive
        ? 0.008
        : speedKmh > 145
        ? ((speedKmh - 145) / 120) * 0.005
        : 0;
    const totalShake = this.shakeIntensity + speedVibe;
    if (totalShake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * totalShake;
      this.camera.position.y += (Math.random() - 0.5) * totalShake;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.6);
    }

    const p = this.playerRig.root.position;
    const atmos = getWeatherAtmosphere(this.activeWeather);
    this.sunLight.position.set(
      p.x + atmos.sunPos[0],
      p.y + atmos.sunPos[1],
      p.z + atmos.sunPos[2],
    );
    this.sunLight.target.position.copy(p);
  }

  private pushTelemetryNow(): void {
    if (!this.onTelemetry || !this.world) return;
    this.world.sampleGroundAt(this.playerS, this.playerLat, _sampleA);
    let activeLoadedCount = 0;
    for (let i = 0; i < this.trafficVehicles.length; i++) {
      if (this.trafficVehicles[i].active && this.trafficVehicles[i].rig.loaded) {
        activeLoadedCount++;
      }
    }
    this.onTelemetry({
      speedKmh: Math.round(Math.abs(this.playerSpeedMs) * 3.6),
      rpm: Math.round(this.playerRpm),
      gear: this.playerGear,
      nitro: Math.round(this.playerNitro),
      nitroActive: this.playerNitroActive,
      highBeam: this.playerHighBeam,
      hazardLights: this.playerHazard,
      indicatorDir: this.playerIndicatorDir,
      distanceM: Math.max(0, Math.round(this.maxDistanceM)),
      currentScore: this.currentScore,
      bestScore: this.bestScore,
      bestDistanceM: this.bestDistanceM,
      isNewBestScore: this.isNewBestScore,
      trafficDensityTier: this.activeTrafficTier,
      overtakes: this.overtakesCount,
      trafficCount: activeLoadedCount,
      elapsedTime: this.raceElapsedTime,
      countdownValue: Math.ceil(Math.max(0, this.countdownTimer)),
      surface: _sampleA.surface,
      isDrifting:
        Math.abs(this.playerDriftAngle) > 0.14 ||
        (this.controlsInput.handbrake && Math.abs(this.playerSpeedMs) > 8),
      cameraMode: this.cameraMode,
      weather: this.activeWeather,
      lateralNorm: THREE.MathUtils.clamp(
        this.playerLat / Math.max(1, this.currentLevel.roadWidth * 0.5),
        -1.5,
        1.5,
      ),
    });
  }

  private stepSimulation(dt: number): void {
    if (this.raceStatus === 'countdown') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdownTimer = 0;
        this.raceStatus = 'racing';
        this.recordReplaySnapshot(0);
      }
    } else if (this.raceStatus === 'racing') {
      this.raceElapsedTime += dt;
    } else if (this.raceStatus === 'accident') {
      this.accidentTimer += dt;

      // Short cinematic slow-motion window (~1.9s total, strictly <= 2s) then smooth ramp back to 1.0x
      if (this.crashSlowMoActive) {
        this.crashSlowMoElapsed += dt;
        const holdEnd = 1.15;
        const totalEnd = 1.9;
        if (this.crashSlowMoElapsed < holdEnd) {
          const t = this.crashSlowMoElapsed / holdEnd;
          this.timeScale = THREE.MathUtils.lerp(0.24, 0.34, t * t);
        } else if (this.crashSlowMoElapsed < totalEnd) {
          const r = (this.crashSlowMoElapsed - holdEnd) / (totalEnd - holdEnd);
          const smoothR = r * r * (3 - 2 * r);
          this.timeScale = THREE.MathUtils.lerp(0.34, 1.0, smoothR);
        } else {
          this.timeScale = 1.0;
          this.crashSlowMoActive = false;
        }
      } else {
        this.timeScale = 1.0;
      }

      if (this.accidentTimer >= 2.05 && !this.accidentNotified) {
        this.accidentNotified = true;
        this.timeScale = 1.0;
        this.crashSlowMoActive = false;
        this.playerSpeedMs = 0;
        this.flushBestRecordIfDirty(true);
        this.recordReplaySnapshot(this.raceElapsedTime + this.accidentTimer);
        this.audio.playEngineShutdown();
        this.onAccident?.({
          reason: this.accidentReason,
          speedKmh: this.accidentSpeedKmh,
          distanceM: Math.max(0, Math.round(this.maxDistanceM)),
          timeSec: this.raceElapsedTime,
          overtakes: this.overtakesCount,
          score: this.currentScore,
          bestScore: this.bestScore,
          previousBestScore: this.runStartBestScore,
          bestDistanceM: this.bestDistanceM,
          previousBestDistanceM: this.runStartBestDistanceM,
          isNewBest: this.currentScore > this.runStartBestScore,
          vehicleId: this.currentVehicleId,
          hasReplay: this.hasReplay(),
        });
      }
    }

    if (this.raceStatus !== 'accident') {
      this.timeScale = 1.0;
    }
    const simDt = dt * this.timeScale;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
    } else {
      this.updatePlayerPhysics(simDt);
      this.updateTrafficVehicles(simDt);
      this.updateParticles(simDt);

      if (
        this.raceStatus === 'racing' ||
        (this.raceStatus === 'accident' && !this.accidentNotified)
      ) {
        this.replayRecordAccum += dt;
        if (this.replayRecordAccum >= 0.05) {
          this.replayRecordAccum = 0;
          const tOffset = this.raceStatus === 'accident' ? this.accidentTimer : 0;
          this.recordReplaySnapshot(this.raceElapsedTime + tOffset);
        }
      }
    }
  }

  private tick = (): void => {
    if (this.disposed || this.contextLost) return;
    try {
      const now = performance.now();
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const frameDt = Math.min(Math.max(rawDt, 0.001), 0.16);

      const hornShouldPlay =
        this.raceStatus === 'replay'
          ? this.replayCurHorn
          : this.controlsInput.horn &&
            (this.screen === 'playing' || this.screen === 'garage') &&
            this.raceStatus !== 'paused';
      this.audio.setHorn(hornShouldPlay);

      if (this.screen === 'playing' && this.raceStatus === 'replay') {
        if (this.replayPlaying) {
          this.replayPlaybackTime += frameDt * this.replaySpeed;
          if (this.replayPlaybackTime >= this.replayDuration) {
            this.replayPlaybackTime = this.replayDuration;
            this.replayPlaying = false;
            this.replayCurHorn = false;
          }
        }
        this.applyReplayFrameAt(this.replayPlaybackTime, frameDt);
        this.updateParticles(frameDt);

        this.telemetryAccum += frameDt;
        if (this.telemetryAccum >= 0.065 || !this.replayPlaying) {
          this.telemetryAccum = 0;
          this.pushReplayTelemetryNow();
        }
      } else if (this.screen === 'playing' && this.raceStatus !== 'paused') {
        const subSteps = frameDt > 0.04 ? Math.min(4, Math.ceil(frameDt / 0.04)) : 1;
        const subDt = frameDt / subSteps;
        for (let s = 0; s < subSteps; s++) {
          this.stepSimulation(subDt);
        }

        this.telemetryAccum += frameDt;
        if (this.telemetryAccum >= 0.085) {
          this.telemetryAccum = 0;
          this.pushTelemetryNow();
        }
      }

      this.updateTunnelAtmosphereAndLights();
      this.updateCamera(frameDt);
      this.world?.updateWeatherFrame(this.camera.position, frameDt);

      const isReplay = this.screen === 'playing' && this.raceStatus === 'replay';
      this.audio.updateFrame({
        rpm: this.playerRpm,
        speedKmh: Math.abs(this.playerSpeedMs) * 3.6,
        throttle: isReplay ? this.replayCurThrottle : this.controlsInput.throttle,
        brake: isReplay ? this.replayCurBrake : this.controlsInput.brake,
        gear: this.playerGear,
        nitroActive: !isReplay && this.playerNitroActive,
        isDrifting: isReplay
          ? this.replayCurDrifting
          : Math.abs(this.playerDriftAngle) > 0.14 ||
            (this.controlsInput.handbrake && Math.abs(this.playerSpeedMs) > 8),
        surface: _sampleA.surface,
        cameraMode: isReplay ? 'thirdPerson' : this.cameraMode,
        weather: this.activeWeather,
        tunnelAmount: this.currentTunnelFactor,
        activeRacing:
          this.screen === 'playing' &&
          (this.raceStatus === 'countdown' ||
            this.raceStatus === 'racing' ||
            (this.raceStatus === 'replay' && this.replayPlaying)),
      });

      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      console.error('[RaceEngine tick error]', err);
    } finally {
      if (!this.disposed && !this.contextLost) {
        this.frameId = requestAnimationFrame(this.tick);
      }
    }
  };

  public dispose(): void {
    this.disposed = true;
    this.flushBestRecordIfDirty(true);
    cancelAnimationFrame(this.frameId);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    canvas.removeEventListener('pointermove', this.handleCanvasPointerMove);
    canvas.removeEventListener('pointerup', this.handleCanvasPointerUp);
    canvas.removeEventListener('pointercancel', this.handleCanvasPointerUp);
    this.orbitControls.removeEventListener('start', this.handleGarageOrbitStart);
    window.removeEventListener('resize', this.handleResize);
    this.clearTrafficVehicles();
    if (this.playerRig) {
      this.scene.remove(this.playerRig.root);
      this.playerRig.dispose?.();
      this.playerRig = null;
    }
    this.orbitControls.dispose();
    this.world?.dispose();
    this.textures.dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.skidMesh.geometry.dispose();
    (this.skidMesh.material as THREE.Material).dispose();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
