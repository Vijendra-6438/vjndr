import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Home,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  LevelConfig,
  ReplayCameraAngle,
  ReplayTelemetryData,
  VehicleId,
} from '../types/game';
import { VEHICLES } from '../data/vehicles';

interface ReplayHUDProps {
  level: LevelConfig;
  vehicleId: VehicleId;
  replay: ReplayTelemetryData;
  soundEnabled: boolean;
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onSetSpeed: (mult: number) => void;
  onCycleAngle: () => void;
  onSetAngle: (angle: ReplayCameraAngle) => void;
  onToggleSound: () => void;
  onRestartReplay: () => void;
  onExitReplay: () => void;
  onMainMenu: () => void;
}

const ANGLE_OPTIONS: { id: ReplayCameraAngle; label: string }[] = [
  { id: 'chase', label: '3P Chase' },
  { id: 'cinematic', label: '3P Orbit' },
  { id: 'trackside', label: '3P Trackside' },
];

const SPEED_OPTIONS = [0.5, 1, 2];

function formatReplayClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export const ReplayHUD: React.FC<ReplayHUDProps> = ({
  level,
  vehicleId,
  replay,
  soundEnabled,
  onTogglePlay,
  onSeek,
  onSetSpeed,
  onSetAngle,
  onToggleSound,
  onRestartReplay,
  onExitReplay,
  onMainMenu,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const vehicleName = VEHICLES[vehicleId].name;
  const gearLabel =
    replay.gear < 0 ? 'R' : replay.gear === 0 ? 'N' : `D${replay.gear}`;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 select-none">
      {/* Top Perimeter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-stone-950/90 border border-white/15 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
          <span className="font-display font-bold text-amber-400 tracking-wide">
            SCORPIO LAMBORGHINI RACING GAME · REPLAY
          </span>
          <span aria-hidden="true" className="text-stone-600">
            ·
          </span>
          <span className="text-stone-100 font-medium">{vehicleName}</span>
          <span aria-hidden="true" className="hidden sm:inline text-stone-600">
            ·
          </span>
          <span className="hidden sm:inline text-stone-300">
            {level.name} ({level.highwayCode})
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {/* Live Replay Speed & Gear Readout */}
          <div className="hidden md:flex items-center gap-2.5 bg-stone-950/90 border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono-num tabular-nums">
            <span className="text-stone-100 font-bold text-sm">
              {replay.speedKmh} KM/H
            </span>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <span className="text-amber-400 font-bold">{gearLabel}</span>
            <span aria-hidden="true" className="text-stone-600">
              ·
            </span>
            <span className="text-stone-400">
              {(replay.distanceM / 1000).toFixed(2)} km
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Mute replay audio' : 'Unmute replay audio'}
            className="h-11 w-11 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-stone-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

          <button
            type="button"
            onClick={onExitReplay}
            className="h-11 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <X size={16} />
            <span>Results</span>
          </button>

          <button
            type="button"
            onClick={onMainMenu}
            aria-label="Return to Main Menu"
            className="h-11 px-3.5 rounded-xl bg-stone-950/90 hover:bg-stone-900 border border-white/15 text-stone-100 font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Home size={15} />
            <span className="hidden sm:inline">Main Menu</span>
          </button>
        </div>
      </div>

      {/* Central Viewport stays 100% open for Cinematic Third-Person Viewing */}
      <div className="flex-1" />

      {/* Collapsible Unified Bottom Replay Transport Dock */}
      <div className="pointer-events-auto max-w-4xl w-full mx-auto flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          className="h-8 px-4 rounded-t-lg bg-stone-950/92 border border-b-0 border-white/15 text-xs font-medium text-stone-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>{dockCollapsed ? 'Show Replay Controls' : 'Cinema Mode'}</span>
        </button>

        {!dockCollapsed && (
          <div className="w-full rounded-2xl bg-stone-950/92 border border-white/15 p-4 flex flex-col gap-3.5">
            {/* Continuous Endless Timeline Scrubber */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono-num tabular-nums text-stone-200 w-12 text-right shrink-0">
                {formatReplayClock(replay.currentTime)}
              </span>

              <div className="relative flex-1 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, replay.duration)}
                  step={0.05}
                  value={Math.min(replay.currentTime, replay.duration)}
                  onChange={(e) => onSeek(parseFloat(e.target.value))}
                  aria-label="Replay timeline scrubber"
                  className="w-full accent-amber-500 cursor-pointer relative z-10"
                />
              </div>

              <span className="text-xs font-mono-num tabular-nums text-stone-400 w-12 shrink-0">
                {formatReplayClock(replay.duration)}
              </span>
            </div>

            {/* Transport Controls, Playback Speed & Third-Person Camera Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Play/Pause & Restart */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {replay.playing ? (
                    <>
                      <Pause size={15} fill="currentColor" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play size={15} fill="currentColor" />
                      <span>
                        {replay.currentTime >= replay.duration - 0.08
                          ? 'Replay Again'
                          : 'Play'}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onRestartReplay}
                  title="Restart Replay"
                  aria-label="Restart replay from beginning"
                  className="h-10 w-10 rounded-xl bg-stone-900 hover:bg-stone-800 border border-white/12 text-stone-200 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <RotateCcw size={16} />
                </button>

                {/* Playback Speed Segmented Buttons */}
                <div className="flex items-center gap-1 bg-stone-900 p-1 rounded-xl border border-white/10">
                  {SPEED_OPTIONS.map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => onSetSpeed(sp)}
                      className={`h-8 px-2.5 rounded-lg text-xs font-mono-num font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        replay.speedMultiplier === sp
                          ? 'bg-stone-700 text-amber-400'
                          : 'text-stone-400 hover:text-stone-100'
                      }`}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Third-Person Camera Angle Switcher */}
              <div className="flex items-center gap-1.5 bg-stone-900 p-1 rounded-xl border border-white/10">
                <Camera size={14} className="text-amber-400 ml-2 shrink-0" />
                {ANGLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSetAngle(opt.id)}
                    className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      replay.angle === opt.id
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
