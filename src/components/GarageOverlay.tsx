import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Play,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { MOUNTAIN_ROUTES } from '../data/levels';
import { VEHICLE_LIST, VEHICLES } from '../data/vehicles';
import {
  CameraMode,
  GameSettings,
  LevelConfig,
  PlayerProgress,
  VehicleId,
} from '../types/game';

type GaragePreset = 'hero' | 'front' | 'side' | 'rear' | 'top' | 'interior';

interface GarageOverlayProps {
  progress: PlayerProgress;
  currentRoute: LevelConfig;
  failedVehicles: VehicleId[];
  onSelectVehicle: (id: VehicleId) => void;
  onSelectColor: (vehicleId: VehicleId, colorIndex: number) => void;
  onSelectRoute: (routeId: number) => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onCameraPreset: (preset: GaragePreset) => void;
  onHornHold: (active: boolean) => void;
  onBack: () => void;
  onStartRace: () => void;
}

const GARAGE_PRESETS: { id: GaragePreset; label: string }[] = [
  { id: 'hero', label: '3/4 Hero' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'rear', label: 'Rear' },
  { id: 'top', label: 'Top' },
  { id: 'interior', label: 'Cabin' },
];

const CHASE_OPTIONS: { id: CameraMode; label: string }[] = [
  { id: 'thirdPerson', label: 'Chase' },
  { id: 'closeChase', label: 'Close' },
  { id: 'driver', label: 'Cabin' },
  { id: 'front', label: 'Bumper' },
];

export const GarageOverlay: React.FC<GarageOverlayProps> = React.memo(({
  progress,
  currentRoute,
  failedVehicles,
  onSelectVehicle,
  onSelectColor,
  onSelectRoute,
  onUpdateSettings,
  onCameraPreset,
  onHornHold,
  onBack,
  onStartRace,
}) => {
  const [customizeOpen, setCustomizeOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  const [activePreset, setActivePreset] = useState<GaragePreset>('hero');
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeCardRef = useRef<HTMLButtonElement | null>(null);

  const availableVehicles = VEHICLE_LIST.filter(
    (v) => !failedVehicles.includes(v.id),
  );
  const displayVehicles =
    availableVehicles.length > 0 ? availableVehicles : VEHICLE_LIST;

  const activeSpec = VEHICLES[progress.selectedVehicle] ?? displayVehicles[0];
  const activeColorIdx = progress.vehicleColorIndex[activeSpec.id] ?? 0;
  const activeColor =
    activeSpec.colors[activeColorIdx] ?? activeSpec.colors[0];

  useEffect(() => {
    activeCardRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [progress.selectedVehicle]);

  const cycleRoute = (delta: -1 | 1) => {
    const idx = MOUNTAIN_ROUTES.findIndex((r) => r.id === currentRoute.id);
    const nextIdx =
      (idx + delta + MOUNTAIN_ROUTES.length) % MOUNTAIN_ROUTES.length;
    onSelectRoute(MOUNTAIN_ROUTES[nextIdx].id);
  };

  const statBars = [
    {
      label: 'Top Speed',
      valueText: `${activeSpec.topSpeedKmh} km/h`,
      pct: Math.min(100, Math.round((activeSpec.topSpeedKmh / 290) * 100)),
    },
    {
      label: 'Acceleration',
      valueText: activeSpec.powerLabel,
      pct: Math.min(100, Math.round((activeSpec.acceleration / 26) * 100)),
    },
    {
      label: 'Handling',
      valueText: `${Math.round(activeSpec.handling * 100)}%`,
      pct: Math.min(100, Math.round(activeSpec.handling * 100)),
    },
    {
      label: 'Braking',
      valueText: `${Math.min(100, Math.round((activeSpec.braking / 36) * 100))}%`,
      pct: Math.min(100, Math.round((activeSpec.braking / 36) * 100)),
    },
    {
      label: 'Highway Grip',
      valueText: `${Math.round(activeSpec.mudGrip * 100)}%`,
      pct: Math.min(100, Math.round(activeSpec.mudGrip * 100)),
    },
  ];

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5 lg:p-6">
      {/* Top Bar: Back Button + Active Vehicle Info + Actions */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="h-11 px-4 rounded-xl bg-stone-950/92 hover:bg-stone-900 border border-white/15 text-stone-100 text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft size={17} />
            <span>Back</span>
          </button>

          <div className="min-w-0 bg-stone-950/90 border border-white/10 rounded-xl px-3.5 py-2">
            <h2 className="font-display text-sm sm:text-lg font-bold text-stone-50 truncate leading-tight">
              {activeSpec.name}
            </h2>
            <p className="text-[11px] sm:text-xs text-stone-300 truncate">
              {activeSpec.subtitle} · {activeColor.name} · {activeSpec.plateNumber}
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 ml-auto">
          <button
            type="button"
            onPointerDown={() => onHornHold(true)}
            onPointerUp={() => onHornHold(false)}
            onPointerLeave={() => onHornHold(false)}
            onPointerCancel={() => onHornHold(false)}
            className="h-11 px-3.5 rounded-xl bg-stone-950/92 hover:bg-stone-900 active:bg-amber-500 active:text-stone-950 border border-white/15 text-stone-100 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Volume2 size={16} />
            <span className="hidden sm:inline">Horn</span>
          </button>

          <button
            type="button"
            onClick={() => setCustomizeOpen((o) => !o)}
            aria-expanded={customizeOpen}
            className={`h-11 px-3.5 rounded-xl border text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              customizeOpen
                ? 'bg-stone-800/95 border-amber-400/50 text-amber-300'
                : 'bg-stone-950/92 border-white/15 text-stone-100 hover:bg-stone-900'
            }`}
          >
            <SlidersHorizontal size={16} />
            <span>Customize</span>
          </button>

          <button
            type="button"
            onClick={onStartRace}
            className="h-11 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.985] text-stone-950 font-display font-bold text-sm tracking-wide flex items-center gap-2 transition-[background-color,transform] cursor-pointer whitespace-nowrap shadow-lg"
          >
            <Play size={16} fill="currentColor" />
            <span>PLAY</span>
          </button>
        </div>
      </header>

      {/* Middle Area: Full-Screen 3D Viewport + Compact Non-Obstructive Side Panel */}
      <div className="flex-1 min-h-0 flex items-center justify-end py-3 relative">
        {/* Subtle orbit instruction anchored top-left under header on desktop */}
        <p className="hidden lg:block absolute top-2 left-1 text-xs text-stone-300/85 tracking-wide bg-stone-950/85 px-3 py-1.5 rounded-lg border border-white/8">
          Drag anywhere to inspect 360° · Scroll to zoom
        </p>

        {/* Compact Side Customization & Settings Panel */}
        {customizeOpen && (
          <aside className="pointer-events-auto w-full max-w-[330px] max-h-full overflow-y-auto rounded-2xl bg-stone-950/94 border border-white/14 p-4 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <div>
                <h3 className="font-display text-sm font-bold text-stone-50 tracking-wide">
                  GARAGE CUSTOMIZATION
                </h3>
                <p className="text-[11px] text-stone-400">
                  Saved per vehicle automatically
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomizeOpen(false)}
                aria-label="Close customization panel"
                className="h-8 w-8 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 flex items-center justify-center cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* 5-Color Paint Swatches */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-300 font-medium">Exterior Paint</span>
                <span className="font-display font-bold text-amber-400">
                  {activeColor.name}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2 bg-stone-900/90 p-2 rounded-xl border border-white/10">
                {activeSpec.colors.map((c, idx) => {
                  const active = idx === activeColorIdx;
                  const isLight = c.name === 'White' || c.name === 'Yellow';
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => onSelectColor(activeSpec.id, idx)}
                      aria-label={`Select ${c.name} paint`}
                      aria-pressed={active}
                      title={c.name}
                      className={`relative h-10 rounded-lg border-2 transition-transform cursor-pointer flex items-center justify-center ${
                        active
                          ? 'border-amber-400 scale-105 ring-2 ring-amber-400/30'
                          : 'border-white/20 hover:border-white/55'
                      }`}
                    >
                      <span
                        className={`h-6 w-6 rounded-full block border ${
                          isLight ? 'border-stone-400/60' : 'border-white/15'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 360° Camera Presets */}
            <div className="flex flex-col gap-2">
              <span className="text-xs text-stone-300 font-medium flex items-center gap-1.5">
                <Camera size={13} className="text-amber-400" />
                <span>Showroom Angle</span>
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {GARAGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setActivePreset(p.id);
                      onCameraPreset(p.id);
                    }}
                    className={`h-8 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      activePreset === p.id
                        ? 'bg-amber-500 border-amber-400 text-stone-950 font-semibold'
                        : 'bg-stone-900 border-white/10 text-stone-300 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vehicle Performance Telemetry */}
            <div className="flex flex-col gap-2 pt-1 border-t border-white/10">
              <span className="text-xs text-stone-300 font-medium">
                Vehicle Specifications
              </span>
              <div className="flex flex-col gap-2 text-[11px]">
                {statBars.map((s) => (
                  <div key={s.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-stone-400">{s.label}</span>
                      <span className="text-stone-100 font-mono-num font-semibold truncate">
                        {s.valueText}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-stone-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-200"
                        style={{ width: `${s.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real Highway & Driving Controls inside Garage */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-300 font-medium flex items-center gap-1.5">
                  <MapIcon size={13} className="text-emerald-400" />
                  <span>Highway Route</span>
                </span>
                <span className="text-emerald-400 font-mono-num font-semibold">
                  {currentRoute.id} / {MOUNTAIN_ROUTES.length}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-stone-900/90 border border-white/10 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => cycleRoute(-1)}
                  aria-label="Previous highway route"
                  className="h-8 w-8 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <ChevronLeft size={15} />
                </button>
                <div className="flex-1 min-w-0 text-center px-1">
                  <div className="text-xs font-medium text-stone-100 truncate">
                    {currentRoute.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cycleRoute(1)}
                  aria-label="Next highway route"
                  className="h-8 w-8 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Preferred Race Camera & Sound */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-stone-300 font-medium">Race Cam</span>
                <div className="flex items-center gap-1">
                  {CHASE_OPTIONS.map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ defaultCamera: cam.id })
                      }
                      className={`h-7 px-2 rounded-md text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                        progress.settings.defaultCamera === cam.id
                          ? 'bg-amber-500 text-stone-950 font-semibold'
                          : 'bg-stone-900 text-stone-300 hover:text-white'
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-stone-300 font-medium whitespace-nowrap">
                  Steering ({progress.settings.steeringSensitivity.toFixed(2)}x)
                </span>
                <input
                  type="range"
                  min="0.6"
                  max="1.5"
                  step="0.05"
                  value={progress.settings.steeringSensitivity}
                  onChange={(e) =>
                    onUpdateSettings({
                      steeringSensitivity: parseFloat(e.target.value),
                    })
                  }
                  className="w-28 accent-amber-500 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      soundEnabled: !progress.settings.soundEnabled,
                    })
                  }
                  aria-label={
                    progress.settings.soundEnabled
                      ? 'Mute audio'
                      : 'Unmute audio'
                  }
                  className={`h-7 w-8 rounded-md flex items-center justify-center cursor-pointer shrink-0 ${
                    progress.settings.soundEnabled
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/40'
                      : 'bg-stone-900 text-stone-400 border border-white/10'
                  }`}
                >
                  {progress.settings.soundEnabled ? (
                    <Volume2 size={14} />
                  ) : (
                    <VolumeX size={14} />
                  )}
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Horizontal Scrollable Vehicle Selection Strip */}
      <div className="pointer-events-auto w-full max-w-4xl mx-auto">
        <div
          ref={stripRef}
          className="flex flex-nowrap items-stretch gap-2.5 overflow-x-auto pb-1 pt-1 px-1 snap-x scroll-smooth"
        >
          {displayVehicles.map((v) => {
            const isSelected = v.id === activeSpec.id;
            const savedIdx = progress.vehicleColorIndex[v.id] ?? 0;
            const savedPaint = v.colors[savedIdx] ?? v.colors[0];

            return (
              <button
                key={v.id}
                ref={isSelected ? activeCardRef : null}
                type="button"
                onClick={() => {
                  onSelectVehicle(v.id);
                  setActivePreset('hero');
                }}
                className={`snap-center shrink-0 min-w-[180px] sm:min-w-[205px] rounded-2xl px-4 py-3 border text-left transition-[background-color,border-color,transform] duration-150 cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'bg-stone-900/95 border-amber-400 shadow-lg'
                    : 'bg-stone-950/90 border-white/12 hover:border-white/35 hover:bg-stone-900/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-display font-bold text-sm whitespace-nowrap ${
                      isSelected ? 'text-amber-400' : 'text-stone-100'
                    }`}
                  >
                    {v.name}
                  </span>
                  <span
                    className="h-3 w-3 rounded-full border border-white/40 shrink-0"
                    style={{ backgroundColor: savedPaint.hex }}
                    title={`${savedPaint.name} paint`}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400 font-mono-num">
                  <span>{v.topSpeedKmh} km/h</span>
                  <span className="truncate">{savedPaint.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
