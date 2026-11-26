import { useCallback, useEffect, useRef, useState } from 'react';
import { MOUNTAIN_ROUTES } from './data/levels';
import { VEHICLES } from './data/vehicles';
import { ForestHighwayRaceEngine } from './engine/raceEngine';
import {
  GameScreen,
  GameSettings,
  PlayerProgress,
  ReplayTelemetryData,
  TelemetryData,
  VehicleId,
} from './types/game';
import { DEFAULT_PROGRESS, loadProgress, saveProgress } from './utils/storage';
import { TitleScreen } from './components/TitleScreen';
import { GarageOverlay } from './components/GarageOverlay';
import { LevelSelectModal } from './components/LevelSelectModal';
import { SettingsModal } from './components/SettingsModal';
import { RacingHUD } from './components/RacingHUD';
import { ReplayHUD } from './components/ReplayHUD';
import { AccidentModal, PauseModal } from './components/PauseAndVictoryModals';

// Latest uploaded racing car GLB showcased heroically on the Home Screen background
const HOME_SHOWCASE_VEHICLE: VehicleId = 'nissan';

interface AccidentResult {
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
}

const INITIAL_TELEMETRY: TelemetryData = {
  speedKmh: 0,
  rpm: 850,
  gear: 1,
  nitro: 100,
  nitroActive: false,
  highBeam: false,
  hazardLights: false,
  indicatorDir: 0,
  lateralNorm: -0.46,
  distanceM: 0,
  currentScore: 0,
  bestScore: 0,
  bestDistanceM: 0,
  isNewBestScore: false,
  trafficDensityTier: 1,
  overtakes: 0,
  trafficCount: 6,
  elapsedTime: 0,
  countdownValue: 3,
  surface: 'asphalt',
  isDrifting: false,
  cameraMode: 'thirdPerson',
  weather: 'sunny',
};

const INITIAL_REPLAY_TELEMETRY: ReplayTelemetryData = {
  currentTime: 0,
  duration: 0,
  playing: true,
  speedMultiplier: 1,
  angle: 'chase',
  speedKmh: 0,
  gear: 1,
  distanceM: 0,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ForestHighwayRaceEngine | null>(null);

  const [progress, setProgress] = useState<PlayerProgress>(() => loadProgress());
  const progressRef = useRef<PlayerProgress>(progress);
  progressRef.current = progress;

  const [screen, setScreen] = useState<GameScreen>('title');
  const screenRef = useRef<GameScreen>(screen);
  screenRef.current = screen;

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  const [accidentResult, setAccidentResult] = useState<AccidentResult | null>(null);
  const accidentRef = useRef(accidentResult);
  accidentRef.current = accidentResult;

  const [isReplaying, setIsReplaying] = useState(false);
  const isReplayingRef = useRef(isReplaying);
  isReplayingRef.current = isReplaying;

  const [telemetry, setTelemetry] = useState<TelemetryData>(() => ({
    ...INITIAL_TELEMETRY,
    bestScore: progress.bestScore,
    bestDistanceM: progress.bestDistanceM,
  }));
  const [replayTelemetry, setReplayTelemetry] = useState<ReplayTelemetryData>(
    INITIAL_REPLAY_TELEMETRY,
  );
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState<boolean>(true);
  const [failedVehicles, setFailedVehicles] = useState<VehicleId[]>([]);

  // Separate continuous held input sources (keyboard vs touch)
  const heldKeysRef = useRef<Set<string>>(new Set());
  const touchStateRef = useRef({
    steer: 0,
    throttle: 0,
    brake: 0,
    reverse: 0,
    handbrake: false,
    nitro: false,
    horn: false,
  });

  const syncCombinedInputs = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const keys = heldKeysRef.current;
    const touch = touchStateRef.current;

    const keyLeft = keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0;
    const keyRight = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
    const keySteer = keyLeft + keyRight;

    const keyThrottle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
    const keyBrake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
    const keyHandbrake = keys.has('Space');
    const keyNitro = keys.has('KeyN') || keys.has('ShiftLeft') || keys.has('ShiftRight');
    const keyHorn = keys.has('KeyH');

    engine.controlsInput.steer =
      Math.abs(touch.steer) > 0.01 ? touch.steer : keySteer;
    engine.controlsInput.throttle = Math.max(touch.throttle, keyThrottle);
    engine.controlsInput.brake = Math.max(touch.brake, keyBrake);
    engine.controlsInput.reverse = touch.reverse;
    engine.controlsInput.handbrake = touch.handbrake || keyHandbrake;
    engine.controlsInput.nitro = touch.nitro || keyNitro;
    engine.controlsInput.horn = touch.horn || keyHorn;
  }, []);

  const updateAndSaveProgress = useCallback(
    (updater: (prev: PlayerProgress) => PlayerProgress) => {
      setProgress((prev) => {
        const next = updater(prev);
        saveProgress(next);
        return next;
      });
    },
    [],
  );

  const launchRoute = useCallback(
    (routeId: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const p = progressRef.current;
      const route = MOUNTAIN_ROUTES[routeId - 1] ?? MOUNTAIN_ROUTES[0];
      const vSpec = VEHICLES[p.selectedVehicle];
      const colorIdx = p.vehicleColorIndex[p.selectedVehicle] ?? 0;
      const paintHex = vSpec.colors[colorIdx]?.hex ?? vSpec.colors[0].hex;

      engine.audio.unlock();
      setIsReplaying(false);
      setAccidentResult(null);
      setIsPaused(false);
      setSettingsOpen(false);
      setScreen('playing');

      updateAndSaveProgress((prev) => ({
        ...prev,
        selectedRoute: route.id,
      }));

      engine.startRace(
        route,
        p.selectedVehicle,
        paintHex,
        p.settings.defaultCamera,
        p.bestScore,
        p.bestDistanceM,
      );
    },
    [updateAndSaveProgress],
  );

  // Initialize Three.js Engine Once Inside Isolated Ref Container
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const initialProg = progressRef.current;
    const initialRoute =
      MOUNTAIN_ROUTES[initialProg.selectedRoute - 1] ?? MOUNTAIN_ROUTES[0];
    const showcaseSpec = VEHICLES[HOME_SHOWCASE_VEHICLE];
    const showcaseHex =
      showcaseSpec.colors[initialProg.vehicleColorIndex[HOME_SHOWCASE_VEHICLE] ?? 0]
        ?.hex ?? showcaseSpec.colors[0].hex;

    const engine = new ForestHighwayRaceEngine(container, {
      onTelemetry: (data) => {
        setTelemetry(data);
      },
      onReplayTelemetry: (data) => {
        setReplayTelemetry(data);
      },
      onHighScoreUpdate: (bestScore, bestDistanceM) => {
        updateAndSaveProgress((prev) => {
          const nextBestScore = Math.max(prev.bestScore, bestScore);
          const nextBestDist = Math.max(prev.bestDistanceM, bestDistanceM);
          if (
            nextBestScore === prev.bestScore &&
            nextBestDist === prev.bestDistanceM
          ) {
            return prev;
          }
          return {
            ...prev,
            bestScore: nextBestScore,
            bestDistanceM: nextBestDist,
          };
        });
      },
      onAccident: (result) => {
        setIsReplaying(false);
        setIsPaused(false);
        setAccidentResult(result);
        updateAndSaveProgress((prev) => ({
          ...prev,
          bestScore: Math.max(prev.bestScore, result.bestScore),
          bestDistanceM: Math.max(prev.bestDistanceM, result.bestDistanceM),
        }));
      },
      onModelError: (message) => {
        setModelError(message);
        if (message) {
          const lower = message.toLowerCase();
          const flagged: VehicleId[] = [];
          if (lower.includes('bus')) flagged.push('bus');
          if (lower.includes('lamborghini')) flagged.push('lamborghini');
          if (lower.includes('scorpio')) flagged.push('scorpio');
          if (lower.includes('nissan')) flagged.push('nissan');
          if (flagged.length > 0) {
            setFailedVehicles((prev) =>
              Array.from(new Set([...prev, ...flagged])),
            );
          }
        }
      },
      onModelLoadState: (loaded, vehicleId) => {
        setModelLoading(!loaded);
        if (loaded) {
          setFailedVehicles((prev) => prev.filter((id) => id !== vehicleId));
        }
      },
    });

    engine.setHighScoreBaseline(initialProg.bestScore, initialProg.bestDistanceM);
    engine.applySettings(initialProg.settings);
    engine.loadStage(initialRoute, HOME_SHOWCASE_VEHICLE, showcaseHex);
    engine.setScreenMode('title');
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [updateAndSaveProgress]);

  // Keyboard & Window Blur Listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      engineRef.current?.audio.unlock();

      // Title screen quick-start via Enter or Space (only when not activating a focused button)
      if (
        screenRef.current === 'title' &&
        !settingsOpenRef.current &&
        (e.code === 'Enter' || e.code === 'Space')
      ) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'BUTTON' && tag !== 'INPUT') {
          e.preventDefault();
          launchRoute(progressRef.current.selectedRoute);
          return;
        }
      }

      // Edge-triggered actions (ignore key repeat)
      if (!e.repeat) {
        // Replay mode keyboard controls
        if (screenRef.current === 'playing' && isReplayingRef.current) {
          if (e.code === 'Escape') {
            engineRef.current?.exitReplay();
            setIsReplaying(false);
            return;
          }
          if (e.code === 'Space') {
            e.preventDefault();
            engineRef.current?.toggleReplayPlaying();
            return;
          }
          if (e.code === 'KeyC') {
            engineRef.current?.cycleReplayCameraAngle();
            return;
          }
          if (e.code === 'KeyR') {
            engineRef.current?.seekReplay(0);
            engineRef.current?.setReplayPlaying(true);
            return;
          }
        }

        if (e.code === 'Escape' || e.code === 'KeyP') {
          if (settingsOpenRef.current) {
            setSettingsOpen(false);
            return;
          }
          if (
            e.code === 'Escape' &&
            (screenRef.current === 'garage' || screenRef.current === 'levels')
          ) {
            setScreen('title');
            const p = progressRef.current;
            const showcaseSpec = VEHICLES[HOME_SHOWCASE_VEHICLE];
            const showcaseHex =
              showcaseSpec.colors[p.vehicleColorIndex[HOME_SHOWCASE_VEHICLE] ?? 0]
                ?.hex ?? showcaseSpec.colors[0].hex;
            engineRef.current?.setVehicleAndColor(HOME_SHOWCASE_VEHICLE, showcaseHex);
            engineRef.current?.setScreenMode('title');
            return;
          }
          if (screenRef.current === 'playing' && !accidentRef.current) {
            const nextPaused = !isPausedRef.current;
            setIsPaused(nextPaused);
            engineRef.current?.setPaused(nextPaused);
            return;
          }
        }

        if (
          e.code === 'KeyC' &&
          screenRef.current === 'playing' &&
          !isPausedRef.current &&
          !accidentRef.current
        ) {
          const nextCam = engineRef.current?.cycleCameraMode();
          if (nextCam) {
            setTelemetry((t) => ({ ...t, cameraMode: nextCam }));
          }
          return;
        }

        if (
          e.code === 'KeyL' &&
          screenRef.current === 'playing' &&
          !isPausedRef.current &&
          !accidentRef.current
        ) {
          const hb = engineRef.current?.toggleHighBeam();
          if (hb !== undefined) setTelemetry((t) => ({ ...t, highBeam: hb }));
          return;
        }

        if (
          e.code === 'KeyX' &&
          screenRef.current === 'playing' &&
          !isPausedRef.current &&
          !accidentRef.current
        ) {
          const hz = engineRef.current?.toggleHazardLights();
          if (hz !== undefined) {
            setTelemetry((t) => ({ ...t, hazardLights: hz, indicatorDir: hz ? 0 : t.indicatorDir }));
          }
          return;
        }

        if (
          (e.code === 'KeyQ' || e.code === 'KeyE') &&
          screenRef.current === 'playing' &&
          !isPausedRef.current &&
          !accidentRef.current
        ) {
          const ind = engineRef.current?.toggleIndicator(e.code === 'KeyQ' ? -1 : 1);
          if (ind !== undefined) {
            setTelemetry((t) => ({ ...t, indicatorDir: ind, hazardLights: false }));
          }
          return;
        }

        if (
          e.code === 'KeyR' &&
          screenRef.current === 'playing' &&
          !settingsOpenRef.current
        ) {
          if (!accidentRef.current && !isPausedRef.current) {
            engineRef.current?.resetVehicleToRoad();
          } else {
            setIsReplaying(false);
            setAccidentResult(null);
            setIsPaused(false);
            engineRef.current?.restartRace();
          }
          return;
        }
      }

      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
          'KeyH',
          'KeyN',
          'ShiftLeft',
          'ShiftRight',
        ].includes(e.code)
      ) {
        if (screenRef.current === 'playing') {
          e.preventDefault();
        }
        heldKeysRef.current.add(e.code);
        syncCombinedInputs();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (heldKeysRef.current.has(e.code)) {
        heldKeysRef.current.delete(e.code);
        syncCombinedInputs();
      }
    };

    const clearAllInputs = () => {
      heldKeysRef.current.clear();
      touchStateRef.current = {
        steer: 0,
        throttle: 0,
        brake: 0,
        reverse: 0,
        handbrake: false,
        nitro: false,
        horn: false,
      };
      syncCombinedInputs();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAllInputs);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAllInputs);
    };
  }, [launchRoute, syncCombinedInputs]);

  // Handlers
  const handleSelectVehicle = (vId: VehicleId) => {
    const colorIdx = progress.vehicleColorIndex[vId] ?? 0;
    const hex = VEHICLES[vId].colors[colorIdx]?.hex ?? VEHICLES[vId].colors[0].hex;
    updateAndSaveProgress((prev) => ({
      ...prev,
      selectedVehicle: vId,
    }));
    engineRef.current?.setVehicleAndColor(vId, hex);
    if (screen === 'garage') {
      engineRef.current?.setScreenMode('garage');
    }
  };

  const handleSelectColor = (vId: VehicleId, colorIndex: number) => {
    const hex = VEHICLES[vId].colors[colorIndex]?.hex ?? VEHICLES[vId].colors[0].hex;
    updateAndSaveProgress((prev) => ({
      ...prev,
      vehicleColorIndex: {
        ...prev.vehicleColorIndex,
        [vId]: colorIndex,
      },
    }));
    if (progress.selectedVehicle === vId) {
      engineRef.current?.setVehicleAndColor(vId, hex);
    }
  };

  const handleUpdateSettings = (partial: Partial<GameSettings>) => {
    updateAndSaveProgress((prev) => {
      const merged = { ...prev.settings, ...partial };
      engineRef.current?.applySettings(merged);
      if (partial.defaultCamera && screenRef.current === 'playing') {
        engineRef.current?.setCameraMode(partial.defaultCamera);
      }
      return {
        ...prev,
        settings: merged,
      };
    });
  };

  const handleToggleSound = () => {
    engineRef.current?.audio.unlock();
    handleUpdateSettings({ soundEnabled: !progress.settings.soundEnabled });
  };

  const handleOpenScreen = (target: GameScreen) => {
    engineRef.current?.audio.unlock();
    setIsReplaying(false);
    setAccidentResult(null);
    setIsPaused(false);
    setScreen(target);

    const p = progressRef.current;
    if (target === 'title') {
      const showcaseSpec = VEHICLES[HOME_SHOWCASE_VEHICLE];
      const showcaseHex =
        showcaseSpec.colors[p.vehicleColorIndex[HOME_SHOWCASE_VEHICLE] ?? 0]?.hex ??
        showcaseSpec.colors[0].hex;
      engineRef.current?.setVehicleAndColor(HOME_SHOWCASE_VEHICLE, showcaseHex);
    } else if (target === 'garage') {
      const vSpec = VEHICLES[p.selectedVehicle];
      const hex =
        vSpec.colors[p.vehicleColorIndex[p.selectedVehicle] ?? 0]?.hex ??
        vSpec.colors[0].hex;
      engineRef.current?.setVehicleAndColor(p.selectedVehicle, hex);
    }
    engineRef.current?.setScreenMode(target);
  };

  const handleReturnToMainMenu = () => {
    setIsReplaying(false);
    setAccidentResult(null);
    setIsPaused(false);
    setSettingsOpen(false);
    setScreen('title');
    const p = progressRef.current;
    const route = MOUNTAIN_ROUTES[p.selectedRoute - 1] ?? MOUNTAIN_ROUTES[0];
    const showcaseSpec = VEHICLES[HOME_SHOWCASE_VEHICLE];
    const showcaseHex =
      showcaseSpec.colors[p.vehicleColorIndex[HOME_SHOWCASE_VEHICLE] ?? 0]?.hex ??
      showcaseSpec.colors[0].hex;
    engineRef.current?.loadStage(route, HOME_SHOWCASE_VEHICLE, showcaseHex);
    engineRef.current?.setScreenMode('title');
  };

  const currentRoute = MOUNTAIN_ROUTES[progress.selectedRoute - 1] ?? MOUNTAIN_ROUTES[0];

  return (
    <div className="relative w-full h-full overflow-hidden bg-stone-950">
      {/* Isolated Full-Bleed Three.js WebGL Viewport */}
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full" />

      {/* Explicit GLB Load Error Notice */}
      {modelError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[92%] rounded-xl bg-red-950/95 border border-red-400/60 px-4 py-3 text-xs sm:text-sm text-red-100 shadow-xl flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="font-display font-bold text-red-300">
              3D Model Asset Notice
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {progress.selectedVehicle !== 'scorpio' && (
                <button
                  type="button"
                  onClick={() => {
                    handleSelectVehicle('scorpio');
                    setModelError(null);
                  }}
                  className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-xs cursor-pointer whitespace-nowrap"
                >
                  Use Scorpio GLB
                </button>
              )}
              <button
                type="button"
                onClick={() => setModelError(null)}
                className="px-2 py-1 rounded-md bg-red-900/80 hover:bg-red-800 text-red-100 text-xs cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
          <p className="break-words text-red-100/95">{modelError}</p>
        </div>
      )}

      {/* Title Screen (Clean Home Screen with Latest Uploaded Racing Car Showcase) */}
      {screen === 'title' && !settingsOpen && (
        <TitleScreen
          progress={progress}
          currentRoute={currentRoute}
          modelLoading={modelLoading}
          onPlay={() => launchRoute(progress.selectedRoute)}
          onOpenGarage={() => handleOpenScreen('garage')}
          onOpenRoutes={() => handleOpenScreen('levels')}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSound={handleToggleSound}
        />
      )}

      {/* Interactive Full-Screen 3D Vehicle Selection & Customization Garage */}
      {screen === 'garage' && !settingsOpen && (
        <GarageOverlay
          progress={progress}
          currentRoute={currentRoute}
          failedVehicles={failedVehicles}
          onSelectVehicle={handleSelectVehicle}
          onSelectColor={handleSelectColor}
          onSelectRoute={(routeId) => {
            updateAndSaveProgress((prev) => ({ ...prev, selectedRoute: routeId }));
            const route = MOUNTAIN_ROUTES[routeId - 1] ?? MOUNTAIN_ROUTES[0];
            const vSpec = VEHICLES[progress.selectedVehicle];
            const hex =
              vSpec.colors[progress.vehicleColorIndex[progress.selectedVehicle] ?? 0]
                ?.hex ?? vSpec.colors[0].hex;
            engineRef.current?.loadStage(route, progress.selectedVehicle, hex);
            engineRef.current?.setScreenMode('garage');
          }}
          onUpdateSettings={handleUpdateSettings}
          onCameraPreset={(preset) => {
            engineRef.current?.setGarageCameraPreset(preset);
          }}
          onHornHold={(active) => {
            touchStateRef.current.horn = active;
            syncCombinedInputs();
          }}
          onBack={() => handleOpenScreen('title')}
          onStartRace={() => launchRoute(progress.selectedRoute)}
        />
      )}

      {/* Mountain Highway Corridors Selector */}
      {screen === 'levels' && !settingsOpen && (
        <LevelSelectModal
          progress={progress}
          onSelectRoute={(routeId) => {
            updateAndSaveProgress((prev) => ({ ...prev, selectedRoute: routeId }));
            const route = MOUNTAIN_ROUTES[routeId - 1] ?? MOUNTAIN_ROUTES[0];
            const showcaseSpec = VEHICLES[HOME_SHOWCASE_VEHICLE];
            const showcaseHex =
              showcaseSpec.colors[progress.vehicleColorIndex[HOME_SHOWCASE_VEHICLE] ?? 0]
                ?.hex ?? showcaseSpec.colors[0].hex;
            engineRef.current?.loadStage(route, HOME_SHOWCASE_VEHICLE, showcaseHex);
            engineRef.current?.setScreenMode('levels');
          }}
          onStartRoute={(routeId) => launchRoute(routeId)}
          onClose={() => handleOpenScreen('title')}
        />
      )}

      {/* Active Endless Mountain Highway Racing HUD & Mobile Controls */}
      {screen === 'playing' && !isPaused && !accidentResult && (
        <RacingHUD
          level={currentRoute}
          telemetry={telemetry}
          soundEnabled={progress.settings.soundEnabled}
          showTouchControls={progress.settings.showTouchControls}
          onCycleCamera={() => {
            const nextCam = engineRef.current?.cycleCameraMode();
            if (nextCam) {
              setTelemetry((t) => ({ ...t, cameraMode: nextCam }));
            }
          }}
          onToggleSound={handleToggleSound}
          onToggleHighBeam={() => {
            const hb = engineRef.current?.toggleHighBeam();
            if (hb !== undefined) setTelemetry((t) => ({ ...t, highBeam: hb }));
          }}
          onToggleHazard={() => {
            const hz = engineRef.current?.toggleHazardLights();
            if (hz !== undefined) {
              setTelemetry((t) => ({ ...t, hazardLights: hz, indicatorDir: hz ? 0 : t.indicatorDir }));
            }
          }}
          onToggleIndicator={(dir) => {
            const ind = engineRef.current?.toggleIndicator(dir);
            if (ind !== undefined) {
              setTelemetry((t) => ({ ...t, indicatorDir: ind, hazardLights: false }));
            }
          }}
          onResetVehicle={() => {
            engineRef.current?.resetVehicleToRoad();
          }}
          onRestart={() => {
            setAccidentResult(null);
            setIsPaused(false);
            engineRef.current?.restartRace();
          }}
          onPause={() => {
            setIsPaused(true);
            engineRef.current?.setPaused(true);
          }}
          onTouchSteer={(val) => {
            touchStateRef.current.steer = val;
            syncCombinedInputs();
          }}
          onTouchThrottle={(val) => {
            touchStateRef.current.throttle = val;
            syncCombinedInputs();
          }}
          onTouchBrake={(val) => {
            touchStateRef.current.brake = val;
            syncCombinedInputs();
          }}
          onTouchReverse={(val) => {
            touchStateRef.current.reverse = val;
            syncCombinedInputs();
          }}
          onTouchHandbrake={(active) => {
            touchStateRef.current.handbrake = active;
            syncCombinedInputs();
          }}
          onTouchNitro={(active) => {
            touchStateRef.current.nitro = active;
            syncCombinedInputs();
          }}
          onTouchHorn={(active) => {
            touchStateRef.current.horn = active;
            syncCombinedInputs();
          }}
        />
      )}

      {/* Pause Modal */}
      {screen === 'playing' && isPaused && !settingsOpen && !accidentResult && (
        <PauseModal
          level={currentRoute}
          currentScore={telemetry.currentScore}
          bestScore={telemetry.bestScore}
          distanceM={telemetry.distanceM}
          bestDistanceM={telemetry.bestDistanceM}
          elapsedSec={telemetry.elapsedTime}
          onResume={() => {
            setIsPaused(false);
            engineRef.current?.setPaused(false);
          }}
          onRestart={() => {
            setIsPaused(false);
            setAccidentResult(null);
            engineRef.current?.restartRace();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onMainMenu={handleReturnToMainMenu}
        />
      )}

      {/* Accident Screen (Triggered on collision with any mountain highway traffic vehicle) */}
      {screen === 'playing' && accidentResult && !isReplaying && (
        <AccidentModal
          level={currentRoute}
          vehicleId={accidentResult.vehicleId}
          reason={accidentResult.reason}
          speedKmh={accidentResult.speedKmh}
          distanceM={accidentResult.distanceM}
          overtakes={accidentResult.overtakes}
          score={accidentResult.score}
          bestScore={accidentResult.bestScore}
          previousBestScore={accidentResult.previousBestScore}
          bestDistanceM={accidentResult.bestDistanceM}
          previousBestDistanceM={accidentResult.previousBestDistanceM}
          isNewBest={accidentResult.isNewBest}
          hasReplay={accidentResult.hasReplay}
          onRestart={() => {
            setIsReplaying(false);
            setAccidentResult(null);
            engineRef.current?.restartRace();
          }}
          onWatchReplay={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.startReplay();
            setIsReplaying(true);
          }}
          onMainMenu={handleReturnToMainMenu}
        />
      )}

      {/* Cinematic Third-Person Post-Run Replay HUD */}
      {screen === 'playing' && accidentResult && isReplaying && (
        <ReplayHUD
          level={currentRoute}
          vehicleId={accidentResult.vehicleId}
          replay={replayTelemetry}
          soundEnabled={progress.settings.soundEnabled}
          onTogglePlay={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.toggleReplayPlaying();
          }}
          onSeek={(timeSec) => {
            engineRef.current?.seekReplay(timeSec);
          }}
          onSetSpeed={(mult) => {
            engineRef.current?.setReplaySpeed(mult);
          }}
          onCycleAngle={() => {
            engineRef.current?.cycleReplayCameraAngle();
          }}
          onSetAngle={(angle) => {
            engineRef.current?.setReplayCameraAngle(angle);
          }}
          onToggleSound={handleToggleSound}
          onRestartReplay={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.seekReplay(0);
            engineRef.current?.setReplayPlaying(true);
          }}
          onExitReplay={() => {
            engineRef.current?.exitReplay();
            setIsReplaying(false);
          }}
          onMainMenu={() => {
            engineRef.current?.exitReplay();
            handleReturnToMainMenu();
          }}
        />
      )}

      {/* Settings Modal (Accessible from Main Menu and Pause Menu) */}
      {settingsOpen && (
        <SettingsModal
          settings={progress.settings}
          bestScore={progress.bestScore}
          bestDistanceM={progress.bestDistanceM}
          onUpdateSettings={handleUpdateSettings}
          onResetProgress={() => {
            const fresh = structuredClone(DEFAULT_PROGRESS);
            saveProgress(fresh);
            setProgress(fresh);
            engineRef.current?.applySettings(fresh.settings);
            engineRef.current?.setHighScoreBaseline(0, 0);
            setTelemetry((prev) => ({
              ...prev,
              bestScore: prev.currentScore,
              bestDistanceM: prev.distanceM,
              isNewBestScore: prev.currentScore > 0,
            }));
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
