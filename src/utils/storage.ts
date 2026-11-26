import { PlayerProgress } from '../types/game';
import { MOUNTAIN_ROUTES } from '../data/levels';

const STORAGE_KEY = 'indian_forest_highway_racing_v1';

export const DEFAULT_PROGRESS: PlayerProgress = {
  selectedRoute: 1,
  selectedVehicle: 'scorpio',
  vehicleColorIndex: {
    scorpio: 0,
    bus: 4,
    lamborghini: 3,
    nissan: 4,
  },
  bestScore: 0,
  bestDistanceM: 0,
  settings: {
    soundEnabled: true,
    graphicsQuality: 'high',
    defaultCamera: 'thirdPerson',
    weatherOverride: 'auto',
    steeringSensitivity: 1.0,
    showTouchControls: true,
  },
};

const clampColorIdx = (val: unknown, fallback: number): number => {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(0, Math.floor(n)));
};

export function loadProgress(): PlayerProgress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PROGRESS);
    const parsed = JSON.parse(raw) as Partial<PlayerProgress> & {
      selectedLevel?: number;
      vehicleColorIndex?: Partial<Record<string, number>>;
    };

    const validVehicle =
      parsed.selectedVehicle === 'scorpio' ||
      parsed.selectedVehicle === 'bus' ||
      parsed.selectedVehicle === 'lamborghini' ||
      parsed.selectedVehicle === 'nissan'
        ? parsed.selectedVehicle
        : 'scorpio';

    const routeCandidate = parsed.selectedRoute ?? parsed.selectedLevel ?? 1;
    const validRoute = Math.min(
      MOUNTAIN_ROUTES.length,
      Math.max(1, Math.floor(Number(routeCandidate) || 1)),
    );

    const safeBestScore = Math.max(0, Math.floor(Number(parsed.bestScore) || 0));
    const safeBestDist = Math.max(0, Math.floor(Number(parsed.bestDistanceM) || 0));

    return {
      selectedRoute: validRoute,
      selectedVehicle: validVehicle,
      vehicleColorIndex: {
        scorpio: clampColorIdx(parsed.vehicleColorIndex?.scorpio, 0),
        bus: clampColorIdx(parsed.vehicleColorIndex?.bus, 4),
        lamborghini: clampColorIdx(parsed.vehicleColorIndex?.lamborghini, 3),
        nissan: clampColorIdx(parsed.vehicleColorIndex?.nissan, 4),
      },
      bestScore: safeBestScore,
      bestDistanceM: safeBestDist,
      settings: {
        ...DEFAULT_PROGRESS.settings,
        ...(parsed.settings ?? {}),
      },
    };
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
  }
}

export function saveProgress(progress: PlayerProgress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota errors in restricted frames
  }
}
