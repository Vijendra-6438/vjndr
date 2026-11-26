import React from 'react';
import {
  Play,
  RotateCcw,
  Settings,
  Home,
  Trophy,
  Film,
  AlertTriangle,
} from 'lucide-react';
import { LevelConfig, VehicleId } from '../types/game';
import { VEHICLES } from '../data/vehicles';

interface PauseModalProps {
  level: LevelConfig;
  currentScore: number;
  bestScore: number;
  distanceM: number;
  bestDistanceM: number;
  elapsedSec: number;
  onResume: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onMainMenu: () => void;
}

function formatRaceTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  level,
  currentScore,
  bestScore,
  distanceM,
  bestDistanceM,
  elapsedSec,
  onResume,
  onRestart,
  onOpenSettings,
  onMainMenu,
}) => {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-stone-950/88 p-4">
      <div className="max-w-md w-full rounded-2xl bg-stone-900 border border-white/15 p-6 flex flex-col gap-5">
        <div className="text-center">
          <p className="text-xs text-amber-400 font-semibold">
            SCORPIO LAMBORGHINI RACING GAME · {level.highwayCode}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-stone-50">
            Race Paused
          </h2>
          <p className="mt-1 text-xs text-stone-400 tabular-nums">
            {level.name} · {formatRaceTime(elapsedSec)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 py-3 border-y border-white/10 text-center tabular-nums">
          <div>
            <div className="text-[11px] text-stone-400">Current Score</div>
            <div className="mt-0.5 font-mono-num text-base font-bold text-stone-100">
              {currentScore.toLocaleString('en-IN')}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-stone-400">Best Score</div>
            <div className="mt-0.5 font-mono-num text-base font-bold text-amber-400">
              {bestScore.toLocaleString('en-IN')}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-stone-400">Distance</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-stone-200">
              {(distanceM / 1000).toFixed(2)} km
            </div>
          </div>
          <div>
            <div className="text-[11px] text-stone-400">Best Distance</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-emerald-400">
              {(bestDistanceM / 1000).toFixed(2)} km
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="h-12 w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Play size={18} fill="currentColor" />
            <span>Resume Race</span>
          </button>

          <button
            type="button"
            onClick={onRestart}
            className="h-11 w-full rounded-xl bg-stone-800 hover:bg-stone-700 border border-white/10 text-stone-100 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw size={16} />
            <span>Restart Run</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="h-11 w-full rounded-xl bg-stone-800 hover:bg-stone-700 border border-white/10 text-stone-100 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onClick={onMainMenu}
            className="h-11 w-full rounded-xl bg-stone-950 hover:bg-stone-800 border border-white/10 text-stone-300 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Home size={16} />
            <span>Main Menu</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface AccidentModalProps {
  level: LevelConfig;
  vehicleId: VehicleId;
  reason: string;
  speedKmh: number;
  distanceM: number;
  overtakes: number;
  score: number;
  bestScore: number;
  previousBestScore: number;
  bestDistanceM: number;
  previousBestDistanceM: number;
  isNewBest: boolean;
  hasReplay: boolean;
  onRestart: () => void;
  onWatchReplay: () => void;
  onMainMenu: () => void;
}

export const AccidentModal: React.FC<AccidentModalProps> = ({
  level,
  vehicleId,
  reason,
  speedKmh,
  distanceM,
  overtakes,
  score,
  bestScore,
  previousBestScore,
  bestDistanceM,
  isNewBest,
  hasReplay,
  onRestart,
  onWatchReplay,
  onMainMenu,
}) => {
  const vehicleName = VEHICLES[vehicleId]?.name ?? 'Mahindra Scorpio';

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-stone-950/90 p-4">
      <div
        className={`max-w-lg w-full rounded-2xl bg-stone-900 border p-6 sm:p-7 flex flex-col gap-5 ${
          isNewBest ? 'border-emerald-400/60' : 'border-red-500/50'
        }`}
      >
        <div className="text-center flex flex-col items-center">
          <div
            className={`h-12 w-12 rounded-full border flex items-center justify-center mb-2 ${
              isNewBest
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-400'
                : 'bg-red-500/20 border-red-400/60 text-red-400'
            }`}
          >
            {isNewBest ? <Trophy size={24} /> : <AlertTriangle size={24} />}
          </div>

          <h2 className="font-display text-2xl sm:text-3xl font-bold text-red-400 tracking-wide">
            GAME OVER · ACCIDENT
          </h2>
          <p className="mt-1 text-base font-semibold text-stone-100">{reason}</p>
          <p className="mt-1 text-xs text-stone-300">
            {vehicleName} · Route {level.id}: {level.name} ({level.highwayCode})
          </p>

          {isNewBest && (
            <div className="mt-3 w-full rounded-xl bg-emerald-950/75 border border-emerald-400/50 px-4 py-2.5 text-center">
              <div className="font-display text-sm sm:text-base font-bold text-emerald-300 tracking-wide">
                CONGRATULATIONS! NEW HIGH SCORE!
              </div>
              <div className="text-xs text-emerald-200/90 font-mono-num tabular-nums mt-0.5">
                {score.toLocaleString('en-IN')} pts (Previous Best:{' '}
                {previousBestScore.toLocaleString('en-IN')})
              </div>
            </div>
          )}
        </div>

        {/* Score, Previous Best, Distance & Speed Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-y border-white/10 text-center tabular-nums">
          <div>
            <div className="text-xs text-stone-400">Current Score</div>
            <div className="mt-0.5 font-mono-num text-base font-bold text-stone-50">
              {score.toLocaleString('en-IN')}
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-400">
              {isNewBest ? 'Previous Best' : 'Best Score'}
            </div>
            <div className="mt-0.5 font-mono-num text-base font-bold text-amber-400">
              {(isNewBest ? previousBestScore : bestScore).toLocaleString('en-IN')}
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-400">Distance / Best</div>
            <div className="mt-0.5 font-mono-num text-sm font-bold text-stone-100">
              {(distanceM / 1000).toFixed(2)} km
            </div>
            <div className="text-[10px] font-mono-num text-emerald-400">
              Best {(bestDistanceM / 1000).toFixed(2)} km
            </div>
          </div>

          <div>
            <div className="text-xs text-stone-400">Impact / Dodged</div>
            <div className="mt-0.5 font-mono-num text-sm font-bold text-red-400">
              {speedKmh} km/h
            </div>
            <div className="text-[10px] font-mono-num text-stone-300">
              {overtakes} overtakes
            </div>
          </div>
        </div>

        {/* Actions: PLAY AGAIN, WATCH REPLAY, MAIN MENU */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onRestart}
            className="sm:col-span-2 h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-base tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw size={18} />
            <span>PLAY AGAIN</span>
          </button>

          <button
            type="button"
            onClick={onWatchReplay}
            disabled={!hasReplay}
            className={`h-11 rounded-xl border font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
              hasReplay
                ? 'bg-stone-800 hover:bg-stone-700 border-white/15 text-emerald-300 cursor-pointer'
                : 'bg-stone-900/60 border-white/5 text-stone-500 cursor-not-allowed'
            }`}
          >
            <Film size={16} />
            <span>WATCH REPLAY</span>
          </button>

          <button
            type="button"
            onClick={onMainMenu}
            className="h-11 rounded-xl bg-stone-950 hover:bg-stone-800 border border-white/15 text-stone-200 font-display font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Home size={16} />
            <span>MAIN MENU</span>
          </button>
        </div>
      </div>
    </div>
  );
};
