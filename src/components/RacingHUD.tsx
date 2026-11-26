import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Lightbulb,
  Navigation,
  Pause,
  RotateCcw,
  RotateCw,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  CameraMode,
  LevelConfig,
  TelemetryData,
} from '../types/game';

interface RacingHUDProps {
  level: LevelConfig;
  telemetry: TelemetryData;
  soundEnabled: boolean;
  showTouchControls: boolean;
  onCycleCamera: () => void;
  onToggleSound: () => void;
  onToggleHighBeam: () => void;
  onToggleHazard: () => void;
  onToggleIndicator: (dir: -1 | 1) => void;
  onResetVehicle: () => void;
  onRestart: () => void;
  onPause: () => void;
  onTouchSteer: (steerVal: number) => void;
  onTouchThrottle: (val: number) => void;
  onTouchBrake: (val: number) => void;
  onTouchReverse: (val: number) => void;
  onTouchHandbrake: (active: boolean) => void;
  onTouchNitro: (active: boolean) => void;
  onTouchHorn: (active: boolean) => void;
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  thirdPerson: 'Chase Cam',
  closeChase: 'Close Chase',
  front: 'Front Cam',
  side: 'Side Cam',
  top: 'Top Cam',
  driver: 'Driver Cam',
  steering: 'Wheel Cam',
};

function formatTime(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${rem}`;
}

export const RacingHUD: React.FC<RacingHUDProps> = React.memo(({
  level,
  telemetry,
  soundEnabled,
  showTouchControls,
  onCycleCamera,
  onToggleSound,
  onToggleHighBeam,
  onToggleHazard,
  onToggleIndicator,
  onResetVehicle,
  onRestart,
  onPause,
  onTouchSteer,
  onTouchThrottle,
  onTouchBrake,
  onTouchReverse,
  onTouchHandbrake,
  onTouchNitro,
  onTouchHorn,
}) => {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const startXRef = useRef<number>(0);
  const [steerMode, setSteerMode] = useState<'buttons' | 'wheel'>('buttons');
  const [wheelVisualDeg, setWheelVisualDeg] = useState(0);
  const [leftPressed, setLeftPressed] = useState(false);
  const [rightPressed, setRightPressed] = useState(false);
  const [throttlePressed, setThrottlePressed] = useState(false);
  const [brakePressed, setBrakePressed] = useState(false);
  const [reversePressed, setReversePressed] = useState(false);
  const [handbrakePressed, setHandbrakePressed] = useState(false);
  const [nitroPressed, setNitroPressed] = useState(false);
  const [hornPressed, setHornPressed] = useState(false);

  const computeSteerFromPointer = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const dx = clientX - cx;
    const dy = clientY - (rect.top + rect.height * 0.5);

    const dragDelta = (clientX - startXRef.current) / (rect.width * 0.42);
    const rimDelta = dx / (rect.width * 0.44);
    const raw = Math.abs(dy) > 6 ? rimDelta * 0.65 + dragDelta * 0.55 : rimDelta;
    const clamped = Math.max(-1, Math.min(1, raw));
    setWheelVisualDeg(clamped * 108);
    onTouchSteer(clamped);
  };

  const handleWheelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    startXRef.current = e.clientX;
    computeSteerFromPointer(e.clientX, e.clientY);
  };

  const handleWheelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    computeSteerFromPointer(e.clientX, e.clientY);
  };

  const handleWheelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    setWheelVisualDeg(0);
    onTouchSteer(0);
  };

  const rpmPct = Math.min(100, Math.max(8, ((telemetry.rpm - 700) / 3800) * 100));
  const nitroPct = Math.min(100, Math.max(0, telemetry.nitro));
  const gearText =
    telemetry.gear < 0 ? 'R' : telemetry.gear === 0 ? 'N' : `D${telemetry.gear}`;
  const laneMarkerPct = Math.min(96, Math.max(4, ((telemetry.lateralNorm + 1.2) / 2.4) * 100));

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5 select-none">
      {/* TOP PERIMETER STATUS & ACTION BAR */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        {/* Left: Endless Highway Info, Overtakes & Traffic Density */}
        <div className="bg-stone-950/90 border border-white/15 rounded-xl px-3.5 py-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs text-stone-300 tabular-nums">
            <span className="font-display font-bold text-amber-400">
              ENDLESS · {level.highwayCode}
            </span>
            <span aria-hidden="true" className="text-stone-600">·</span>
            <span className="hidden sm:inline truncate max-w-[180px] font-medium text-stone-100">
              {level.name}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-stone-400 font-mono-num">
            <span className="text-stone-100 font-semibold">
              Overtakes: {telemetry.overtakes}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatTime(telemetry.elapsedTime)}</span>
            <span aria-hidden="true" className="hidden md:inline">·</span>
            <span className="hidden md:inline capitalize text-stone-300">
              Asphalt · {telemetry.weather}
            </span>
          </div>
        </div>

        {/* Top-Center: Compact Endless Score, Best Score & Distance Card */}
        <div
          className={`hidden md:flex flex-col gap-1.5 bg-stone-950/92 border rounded-xl px-4 py-2 min-w-[300px] max-w-md flex-1 ${
            telemetry.isNewBestScore ? 'border-emerald-400/60' : 'border-white/15'
          }`}
        >
          <div className="flex items-center justify-between gap-4 tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold tracking-wider text-stone-400">
                SCORE
              </span>
              <span className="font-mono-num text-base font-bold text-stone-50">
                {telemetry.currentScore.toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Trophy
                size={13}
                className={telemetry.isNewBestScore ? 'text-emerald-400' : 'text-amber-400'}
              />
              <span className="text-[10px] font-semibold tracking-wider text-stone-400">
                BEST
              </span>
              <span
                className={`font-mono-num text-sm font-bold ${
                  telemetry.isNewBestScore ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {telemetry.bestScore.toLocaleString('en-IN')}
              </span>
              {telemetry.isNewBestScore && (
                <span className="text-[10px] font-bold tracking-wider text-emerald-300">
                  · NEW
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono-num tabular-nums">
            <span>
              Dist:{' '}
              <strong className="text-stone-100">
                {(telemetry.distanceM / 1000).toFixed(2)} km
              </strong>{' '}
              <span className="text-stone-500">
                (Best {(telemetry.bestDistanceM / 1000).toFixed(2)} km)
              </span>
            </span>
            <span className="text-amber-300/90">
              Traffic T{telemetry.trafficDensityTier} · {telemetry.trafficCount}
            </span>
          </div>

          {/* Subtle Highway Lane Position Bar */}
          <div className="relative h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-1/2 w-0.5 bg-amber-400/75 -translate-x-1/2" />
            <div
              className="absolute top-0 bottom-0 w-2.5 -translate-x-1/2 rounded-full bg-emerald-400"
              style={{ left: `${laneMarkerPct}%` }}
            />
          </div>
        </div>

        {/* Right: Lights/Signals, Camera, Reset Vehicle, Sound, Restart & Pause Controls */}
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          {/* Quick Lights & Indicator Cluster */}
          <div className="hidden sm:flex items-center gap-1 bg-stone-950/90 border border-white/15 rounded-xl p-1 h-11">
            <button
              type="button"
              onClick={() => onToggleIndicator(-1)}
              title="Left Indicator (Q)"
              aria-label="Left indicator"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                telemetry.indicatorDir === -1
                  ? 'bg-amber-500 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              <ArrowLeft size={14} />
            </button>

            <button
              type="button"
              onClick={onToggleHazard}
              title="Hazard Lights (X)"
              aria-label="Hazard lights"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                telemetry.hazardLights
                  ? 'bg-red-600 text-white'
                  : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              <AlertTriangle size={14} />
            </button>

            <button
              type="button"
              onClick={() => onToggleIndicator(1)}
              title="Right Indicator (E)"
              aria-label="Right indicator"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                telemetry.indicatorDir === 1
                  ? 'bg-amber-500 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              <ArrowRight size={14} />
            </button>

            <button
              type="button"
              onClick={onToggleHighBeam}
              title="High Beam Headlights (L)"
              aria-label="High beam headlights"
              className={`h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                telemetry.highBeam
                  ? 'bg-sky-400 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              <Lightbulb size={13} />
            </button>
          </div>

          <button
            type="button"
            onClick={onCycleCamera}
            aria-label="Switch camera view"
            className="h-11 px-3 rounded-xl bg-stone-950/90 hover:bg-stone-900 active:bg-amber-500 active:text-stone-950 border border-white/15 text-stone-100 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Camera size={16} className="text-amber-400 shrink-0" />
            <span>{CAMERA_LABELS[telemetry.cameraMode]}</span>
          </button>

          <button
            type="button"
            onClick={onResetVehicle}
            aria-label="Reset vehicle to road"
            title="Reset Vehicle to Highway Lane (R)"
            className="h-11 w-11 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-emerald-300 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Navigation size={16} />
          </button>

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Mute audio' : 'Unmute audio'}
            className="h-11 w-11 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-stone-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

          <button
            type="button"
            onClick={onRestart}
            aria-label="Restart race"
            title="Restart Endless Run"
            className="hidden sm:flex h-11 w-11 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-stone-200 items-center justify-center transition-colors cursor-pointer"
          >
            <RotateCcw size={17} />
          </button>

          <button
            type="button"
            onClick={onPause}
            aria-label="Pause race"
            title="Pause (Esc)"
            className="h-11 w-11 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-amber-400 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Pause size={18} />
          </button>
        </div>
      </div>

      {/* Mobile Compact Score & Best Strip */}
      <div
        className={`md:hidden mt-1.5 self-center bg-stone-950/90 border rounded-lg px-3 py-1 flex items-center gap-3 text-xs font-mono-num tabular-nums ${
          telemetry.isNewBestScore ? 'border-emerald-400/60' : 'border-white/15'
        }`}
      >
        <span className="text-stone-100 font-bold">
          SCORE {telemetry.currentScore.toLocaleString('en-IN')}
        </span>
        <span aria-hidden="true" className="text-stone-600">·</span>
        <span className={telemetry.isNewBestScore ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
          BEST {telemetry.bestScore.toLocaleString('en-IN')}
        </span>
        <span aria-hidden="true" className="text-stone-600">·</span>
        <span className="text-stone-300">
          {(telemetry.distanceM / 1000).toFixed(2)} km
        </span>
      </div>

      {/* CENTER PRE-RACE COUNTDOWN ONLY (Center road & traffic stay 100% unobstructed while driving) */}
      <div className="flex-1 flex flex-col items-center justify-center pointer-events-none">
        {telemetry.countdownValue > 0 && (
          <div className="bg-stone-950/90 border border-amber-400/50 rounded-2xl px-8 py-4 text-center">
            <div className="text-xs text-stone-300 tracking-wide">
              SCORPIO LAMBORGHINI RACING GAME · Mountain Highway
            </div>
            <div className="font-display text-5xl sm:text-6xl font-bold text-amber-400 tabular-nums mt-1">
              {telemetry.countdownValue}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM CONTROLS & DIGITAL SPEEDOMETER CLUSTER */}
      <div className="flex items-end justify-between gap-2 sm:gap-3">
        {/* LEFT SIDE: Holdable Left / Right Steer Buttons OR Touch Wheel */}
        {showTouchControls ? (
          <div className="pointer-events-auto flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={() => {
                setLeftPressed(false);
                setRightPressed(false);
                onTouchSteer(0);
                setSteerMode((m) => (m === 'buttons' ? 'wheel' : 'buttons'));
              }}
              className="h-7 px-2.5 rounded-lg bg-stone-950/90 border border-white/15 text-[11px] font-medium text-stone-300 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RotateCw size={11} className="text-amber-400" />
              <span>{steerMode === 'buttons' ? 'Use Wheel' : 'Use ◀ ▶ Keys'}</span>
            </button>

            {steerMode === 'buttons' ? (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setLeftPressed(true);
                    setRightPressed(false);
                    onTouchSteer(-1);
                  }}
                  onPointerUp={() => {
                    setLeftPressed(false);
                    onTouchSteer(rightPressed ? 1 : 0);
                  }}
                  onPointerCancel={() => {
                    setLeftPressed(false);
                    onTouchSteer(0);
                  }}
                  aria-label="Steer Left"
                  className={`w-18 h-20 sm:w-20 sm:h-22 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-transform touch-none cursor-pointer ${
                    leftPressed
                      ? 'bg-amber-500 border-amber-300 text-stone-950 scale-95'
                      : 'bg-stone-900/95 border-white/20 text-stone-100'
                  }`}
                >
                  <ArrowLeft size={26} />
                  <span className="text-[10px] font-display font-bold">LEFT</span>
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setRightPressed(true);
                    setLeftPressed(false);
                    onTouchSteer(1);
                  }}
                  onPointerUp={() => {
                    setRightPressed(false);
                    onTouchSteer(leftPressed ? -1 : 0);
                  }}
                  onPointerCancel={() => {
                    setRightPressed(false);
                    onTouchSteer(0);
                  }}
                  aria-label="Steer Right"
                  className={`w-18 h-20 sm:w-20 sm:h-22 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-transform touch-none cursor-pointer ${
                    rightPressed
                      ? 'bg-amber-500 border-amber-300 text-stone-950 scale-95'
                      : 'bg-stone-900/95 border-white/20 text-stone-100'
                  }`}
                >
                  <ArrowRight size={26} />
                  <span className="text-[10px] font-display font-bold">RIGHT</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <div
                  ref={wheelRef}
                  onPointerDown={handleWheelDown}
                  onPointerMove={handleWheelMove}
                  onPointerUp={handleWheelUp}
                  onPointerCancel={handleWheelUp}
                  className="w-34 h-34 sm:w-38 sm:h-38 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                  aria-label="Steering wheel touch control"
                >
                  <svg
                    viewBox="0 0 160 160"
                    className="w-full h-full drop-shadow-lg transition-transform duration-75"
                    style={{ transform: `rotate(${wheelVisualDeg}deg)` }}
                  >
                    <circle
                      cx="80"
                      cy="80"
                      r="68"
                      fill="rgba(12, 10, 9, 0.45)"
                      stroke="#1c1917"
                      strokeWidth="16"
                    />
                    <circle
                      cx="80"
                      cy="80"
                      r="68"
                      fill="none"
                      stroke="#57534e"
                      strokeWidth="2"
                    />
                    <rect x="76" y="4" width="8" height="16" rx="2" fill="#f59e0b" />
                    <path
                      d="M20 76 H60 L66 88 H22 Z"
                      fill="#292524"
                      stroke="#78716c"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M140 76 H100 L94 88 H138 Z"
                      fill="#292524"
                      stroke="#78716c"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M73 96 H87 L85 142 H75 Z"
                      fill="#44403c"
                      stroke="#a8a29e"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx="80"
                      cy="82"
                      r="22"
                      fill="#1c1917"
                      stroke="#78716c"
                      strokeWidth="2"
                    />
                    <circle
                      cx="80"
                      cy="82"
                      r="9"
                      fill="none"
                      stroke="#e7e5e4"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-24" />
        )}

        {/* CENTER-BOTTOM: Digital Speedometer, Gear, RPM & Nitro Meter */}
        <div className="bg-stone-950/90 border border-white/15 rounded-2xl px-4 sm:px-6 py-2.5 min-w-[164px] sm:min-w-[235px] flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-3xl sm:text-4xl font-bold text-stone-50 tabular-nums leading-none">
                {telemetry.speedKmh}
              </span>
              <span className="text-xs font-semibold text-stone-400">KM/H</span>
            </div>

            <div className="flex items-center gap-1.5">
              {telemetry.nitroActive && (
                <span className="text-[11px] font-bold text-sky-400">
                  NITRO
                </span>
              )}
              {telemetry.isDrifting && !telemetry.nitroActive && (
                <span className="text-[11px] font-semibold text-amber-400">
                  DRIFT
                </span>
              )}
              <span className="px-2 py-0.5 rounded bg-stone-800 border border-white/15 font-mono-num text-sm font-bold text-amber-400">
                {gearText}
              </span>
            </div>
          </div>

          {/* RPM Bar */}
          <div className="flex flex-col gap-1">
            <div className="h-2 w-full bg-stone-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-[width] duration-75 ${
                  rpmPct > 82 ? 'bg-red-500' : 'bg-amber-400'
                }`}
                style={{ width: `${rpmPct}%` }}
              />
            </div>

            {/* Nitro Boost Bar */}
            <div className="h-1.5 w-full bg-stone-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-[width] duration-75 ${
                  telemetry.nitroActive ? 'bg-sky-300' : 'bg-sky-500'
                }`}
                style={{ width: `${nitroPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-stone-400 font-mono-num">
              <span>{telemetry.rpm} RPM</span>
              <span>NOS {nitroPct}%</span>
              <span>{(telemetry.distanceM / 1000).toFixed(2)} km</span>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE: Horn, Nitro, Handbrake, Reverse, Brake & Accelerator Pedals */}
        {showTouchControls ? (
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {/* Upper Utility Row: Horn, Nitro & Handbrake */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setHornPressed(true);
                  onTouchHorn(true);
                }}
                onPointerUp={() => {
                  setHornPressed(false);
                  onTouchHorn(false);
                }}
                onPointerCancel={() => {
                  setHornPressed(false);
                  onTouchHorn(false);
                }}
                aria-label="Vehicle Horn"
                className={`h-10 px-3 rounded-xl border text-xs font-display font-bold flex items-center gap-1 transition-transform touch-none cursor-pointer ${
                  hornPressed
                    ? 'bg-amber-500 border-amber-300 text-stone-950 scale-95'
                    : 'bg-stone-950/92 border-white/20 text-stone-100'
                }`}
              >
                <Volume2 size={14} />
                <span className="hidden sm:inline">HORN</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setNitroPressed(true);
                  onTouchNitro(true);
                }}
                onPointerUp={() => {
                  setNitroPressed(false);
                  onTouchNitro(false);
                }}
                onPointerCancel={() => {
                  setNitroPressed(false);
                  onTouchNitro(false);
                }}
                aria-label="Nitro Boost"
                className={`h-10 px-3 rounded-xl border text-xs font-display font-bold flex items-center gap-1 transition-transform touch-none cursor-pointer ${
                  nitroPressed || telemetry.nitroActive
                    ? 'bg-sky-400 border-sky-200 text-stone-950 scale-95'
                    : 'bg-stone-950/92 border-sky-400/40 text-sky-300'
                }`}
              >
                <Zap size={14} />
                <span>NITRO</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setHandbrakePressed(true);
                  onTouchHandbrake(true);
                }}
                onPointerUp={() => {
                  setHandbrakePressed(false);
                  onTouchHandbrake(false);
                }}
                onPointerCancel={() => {
                  setHandbrakePressed(false);
                  onTouchHandbrake(false);
                }}
                aria-label="Handbrake"
                className={`h-10 px-3 rounded-xl border text-xs font-display font-bold transition-transform touch-none cursor-pointer ${
                  handbrakePressed
                    ? 'bg-red-600 border-red-300 text-white scale-95'
                    : 'bg-stone-950/92 border-white/20 text-red-300'
                }`}
              >
                P · DRIFT
              </button>
            </div>

            {/* Lower Pedal Cluster: Reverse, Brake & Accelerator Pedals */}
            <div className="flex items-end gap-2">
              {/* Dedicated Reverse Pedal */}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setReversePressed(true);
                  onTouchReverse(1);
                }}
                onPointerUp={() => {
                  setReversePressed(false);
                  onTouchReverse(0);
                }}
                onPointerCancel={() => {
                  setReversePressed(false);
                  onTouchReverse(0);
                }}
                aria-label="Reverse gear pedal"
                className={`w-13 sm:w-14 h-18 sm:h-20 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-transform touch-none cursor-pointer ${
                  reversePressed
                    ? 'bg-amber-500 border-amber-300 text-stone-950 scale-95'
                    : 'bg-stone-900/95 border-stone-600 text-amber-300'
                }`}
              >
                <span className="text-xs font-display font-bold">REV</span>
                <span className="text-[9px] opacity-80">R</span>
              </button>

              {/* Brake Pedal */}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setBrakePressed(true);
                  onTouchBrake(1);
                }}
                onPointerUp={() => {
                  setBrakePressed(false);
                  onTouchBrake(0);
                }}
                onPointerCancel={() => {
                  setBrakePressed(false);
                  onTouchBrake(0);
                }}
                aria-label="Brake pedal"
                className={`w-14 sm:w-16 h-22 sm:h-24 rounded-xl border-2 flex flex-col items-center justify-between py-2.5 transition-transform touch-none cursor-pointer ${
                  brakePressed
                    ? 'bg-red-700 border-red-400 text-white scale-95'
                    : 'bg-stone-900/95 border-stone-600 text-stone-200'
                }`}
              >
                <span className="text-[10px] font-display font-bold tracking-wider">
                  BRAKE
                </span>
                <div className="w-8 flex flex-col gap-1.5">
                  <span className="h-1 bg-stone-500/70 rounded" />
                  <span className="h-1 bg-stone-500/70 rounded" />
                  <span className="h-1 bg-stone-500/70 rounded" />
                </div>
                <span className="text-[9px] text-stone-400">STOP</span>
              </button>

              {/* Accelerator Pedal */}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setThrottlePressed(true);
                  onTouchThrottle(1);
                }}
                onPointerUp={() => {
                  setThrottlePressed(false);
                  onTouchThrottle(0);
                }}
                onPointerCancel={() => {
                  setThrottlePressed(false);
                  onTouchThrottle(0);
                }}
                aria-label="Accelerator pedal"
                className={`w-15 sm:w-18 h-26 sm:h-30 rounded-xl border-2 flex flex-col items-center justify-between py-3 transition-transform touch-none cursor-pointer ${
                  throttlePressed
                    ? 'bg-emerald-500 border-emerald-300 text-stone-950 scale-95'
                    : 'bg-stone-800/95 border-stone-500 text-stone-100'
                }`}
              >
                <span className="text-[10px] font-display font-bold tracking-wider">
                  GAS
                </span>
                <div className="w-7 flex-1 my-2 grid grid-cols-2 gap-1">
                  <span className="bg-stone-950/45 rounded-sm" />
                  <span className="bg-stone-950/45 rounded-sm" />
                  <span className="bg-stone-950/45 rounded-sm" />
                  <span className="bg-stone-950/45 rounded-sm" />
                </div>
                <span className="text-[9px] opacity-80">DRIVE</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-24" />
        )}
      </div>
    </div>
  );
});
