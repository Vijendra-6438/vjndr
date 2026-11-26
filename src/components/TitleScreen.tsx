import React from 'react';
import {
  Car,
  Loader2,
  Map as MapIcon,
  Play,
  Settings,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { LevelConfig, PlayerProgress } from '../types/game';
import { VEHICLES } from '../data/vehicles';

interface TitleScreenProps {
  progress: PlayerProgress;
  currentRoute: LevelConfig;
  modelLoading: boolean;
  onPlay: () => void;
  onOpenGarage: () => void;
  onOpenRoutes: () => void;
  onOpenSettings: () => void;
  onToggleSound: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = React.memo(({
  progress,
  currentRoute,
  modelLoading,
  onPlay,
  onOpenGarage,
  onOpenRoutes,
  onOpenSettings,
  onToggleSound,
}) => {
  const activeVehicle = VEHICLES[progress.selectedVehicle] ?? VEHICLES.scorpio;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 sm:p-7 lg:p-10 bg-gradient-to-t from-stone-950/90 via-stone-950/20 to-stone-950/75">
      {/* Subtle left-side scrim on desktop so menu controls sit cleanly beside the showcase car */}
      <div
        className="hidden lg:block fixed inset-y-0 left-0 w-[440px] bg-gradient-to-r from-stone-950/88 via-stone-950/45 to-transparent pointer-events-none -z-10"
        aria-hidden="true"
      />

      {/* Top Perimeter: Brand Title & Compact Record / Audio */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="pointer-events-auto flex items-center gap-3.5 max-w-2xl">
          <svg
            width="44"
            height="50"
            viewBox="0 0 46 52"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0"
            aria-hidden="true"
          >
            <path
              d="M4 8L23 2L42 8V25C42 37.5 33.8 46.2 23 50C12.2 46.2 4 37.5 4 25V8Z"
              fill="#1E293B"
              stroke="#F59E0B"
              strokeWidth="2.5"
            />
            <path d="M6 15H40V8.8L23 3.5L6 8.8V15Z" fill="#F59E0B" />
            <text
              x="23"
              y="12.5"
              textAnchor="middle"
              fill="#0C0A09"
              fontSize="7.5"
              fontWeight="700"
              fontFamily="Chakra Petch, sans-serif"
            >
              NH INDIA
            </text>
            <path d="M7 36L15 21L21 31L28 19L39 36H7Z" fill="#475569" />
            <path d="M13 40L20.5 23H25.5L33 40H13Z" fill="#1C1917" />
            <path
              d="M22.2 25H23.8V29H22.2V25ZM22.2 32H23.8V37H22.2V32Z"
              fill="#F8FAFC"
            />
          </svg>

          <div>
            <h1 className="font-display text-xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-stone-50 leading-tight text-balance">
              SCORPIO LAMBORGHINI RACING GAME
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-stone-300 tracking-wide">
              Mountain Highway Series · {activeVehicle.name} · {currentRoute.name}
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5 ml-auto">
          {modelLoading && (
            <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-stone-950/90 border border-amber-400/25 px-3 py-2 rounded-xl">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <span className="whitespace-nowrap">Loading 3D Showcase...</span>
            </div>
          )}

          <div className="flex items-center gap-2.5 text-xs text-stone-200 tabular-nums bg-stone-950/90 border border-white/12 px-3.5 py-2.5 rounded-xl">
            <Trophy size={15} className="text-amber-400 shrink-0" />
            <span className="text-amber-400 font-bold font-mono-num whitespace-nowrap">
              {progress.bestScore.toLocaleString('en-IN')}
            </span>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <span className="text-stone-300 font-mono-num whitespace-nowrap">
              {(progress.bestDistanceM / 1000).toFixed(2)} km
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={progress.settings.soundEnabled ? 'Mute sound' : 'Enable sound'}
            className="h-11 w-11 flex items-center justify-center rounded-xl bg-stone-950/90 border border-white/15 text-stone-200 hover:bg-stone-900 hover:text-amber-400 transition-colors cursor-pointer shrink-0"
          >
            {progress.settings.soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
        </div>
      </header>

      {/* Open Center Negative Space (Unobstructed Hero 3D Car Showcase) */}
      <div className="flex-1" />

      {/* Clean Lower-Left / Mobile-Bottom Menu Actions (No vehicle list or paint clutter) */}
      <div className="pointer-events-auto w-full lg:max-w-sm flex flex-col gap-3">
        <button
          type="button"
          onClick={onPlay}
          className="w-full h-14 px-7 rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-[0.985] text-stone-950 font-display font-bold text-lg tracking-wider flex items-center justify-center gap-3 transition-[background-color,transform] duration-150 cursor-pointer whitespace-nowrap shadow-xl"
        >
          <Play size={22} fill="currentColor" />
          <span>PLAY</span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onOpenGarage}
            className="h-12 px-4 rounded-xl bg-stone-950/92 hover:bg-stone-900 active:scale-[0.985] border border-white/18 text-stone-100 font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-[background-color,border-color,transform] duration-150 cursor-pointer whitespace-nowrap"
          >
            <Car size={18} className="text-amber-400 shrink-0" />
            <span>VEHICLES</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="h-12 px-4 rounded-xl bg-stone-950/92 hover:bg-stone-900 active:scale-[0.985] border border-white/18 text-stone-100 font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-[background-color,border-color,transform] duration-150 cursor-pointer whitespace-nowrap"
          >
            <Settings size={18} className="text-stone-300 shrink-0" />
            <span>SETTINGS</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenRoutes}
          className="h-10 px-3.5 rounded-xl bg-stone-950/88 hover:bg-stone-900 border border-white/10 text-xs text-stone-300 hover:text-stone-100 flex items-center justify-between gap-2 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            <MapIcon size={14} className="text-emerald-400 shrink-0" />
            <span className="truncate">
              Highway: <strong className="text-stone-100 font-medium">{currentRoute.name}</strong>
            </span>
          </span>
          <span className="text-amber-400 font-semibold whitespace-nowrap shrink-0">
            Routes (6)
          </span>
        </button>
      </div>
    </div>
  );
});
