export type VehicleId = 'scorpio' | 'bus' | 'lamborghini' | 'nissan';

export type CameraMode =
  | 'thirdPerson'
  | 'closeChase'
  | 'front'
  | 'side'
  | 'top'
  | 'driver'
  | 'steering';

export type ReplayCameraAngle = 'chase' | 'cinematic' | 'trackside';

export type WeatherType = 'sunny' | 'cloudy' | 'rain' | 'fog' | 'morning' | 'evening';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export type GameScreen = 'title' | 'garage' | 'levels' | 'settings' | 'playing';

export type RaceStatus =
  | 'countdown'
  | 'racing'
  | 'paused'
  | 'accident'
  | 'replay';

export type RoadSurface = 'asphalt';

export interface LevelConfig {
  id: number;
  name: string;
  region: string;
  highwayCode: string;
  roadWidth: number; // meters
  curviness: number; // lateral curve amplitude
  turnFrequency: number;
  elevationAmp: number; // mountain hill amplitude
  aiSpeedFactor: number; // highway traffic base speed multiplier
  weather: WeatherType;
  description: string;
}

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  subtitle: string;
  engineLabel: string;
  powerLabel: string;
  torqueLabel: string;
  drivetrain: string;
  topSpeedKmh: number;
  acceleration: number; // m/s^2 base
  braking: number;
  handling: number;
  mudGrip: number; // 0..1 wet/high-speed stability grip
  suspensionStiffness: number;
  hornBaseFreq: [number, number];
  dieselBaseHz: number;
  plateNumber: string;
  colors: { name: string; hex: string }[];
}

export interface GameSettings {
  soundEnabled: boolean;
  graphicsQuality: GraphicsQuality;
  defaultCamera: CameraMode;
  weatherOverride: 'auto' | WeatherType;
  steeringSensitivity: number;
  showTouchControls: boolean;
}

export interface PlayerProgress {
  selectedRoute: number;
  selectedVehicle: VehicleId;
  vehicleColorIndex: Record<VehicleId, number>;
  bestScore: number;
  bestDistanceM: number;
  settings: GameSettings;
}

export interface TelemetryData {
  speedKmh: number;
  rpm: number;
  gear: number; // 0 = N, -1 = R, 1..6 = D1..D6
  nitro: number; // 0..100
  nitroActive: boolean;
  highBeam: boolean;
  hazardLights: boolean;
  indicatorDir: -1 | 0 | 1;
  lateralNorm: number; // -1..1 road width position
  distanceM: number;
  currentScore: number;
  bestScore: number;
  bestDistanceM: number;
  isNewBestScore: boolean;
  trafficDensityTier: number;
  overtakes: number;
  trafficCount: number;
  elapsedTime: number;
  countdownValue: number;
  surface: RoadSurface;
  isDrifting: boolean;
  cameraMode: CameraMode;
  weather: WeatherType;
}

export interface ReplayTelemetryData {
  currentTime: number;
  duration: number;
  playing: boolean;
  speedMultiplier: number;
  angle: ReplayCameraAngle;
  speedKmh: number;
  gear: number;
  distanceM: number;
}

export interface ControlInputState {
  steer: number; // -1 (left) to +1 (right)
  throttle: number; // 0 to 1
  brake: number; // 0 to 1
  reverse: number; // 0 to 1 explicit reverse hold
  handbrake: boolean;
  nitro: boolean;
  horn: boolean;
}
