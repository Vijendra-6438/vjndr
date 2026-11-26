import React, { useState } from 'react';
import { ArrowLeft, X, RotateCcw, Trophy } from 'lucide-react';
import {
  CameraMode,
  GameSettings,
  GraphicsQuality,
  WeatherType,
} from '../types/game';

interface SettingsModalProps {
  settings: GameSettings;
  bestScore: number;
  bestDistanceM: number;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onResetProgress: () => void;
  onClose: () => void;
}

const CAMERA_OPTIONS: { id: CameraMode; label: string }[] = [
  { id: 'thirdPerson', label: 'Chase Cam' },
  { id: 'closeChase', label: 'Close Chase' },
  { id: 'front', label: 'Front Bumper' },
  { id: 'side', label: 'Side Profile' },
  { id: 'top', label: 'Top View' },
  { id: 'driver', label: 'Driver Seat' },
  { id: 'steering', label: 'Steering Wheel' },
];

const WEATHER_OPTIONS: { id: 'auto' | WeatherType; label: string }[] = [
  { id: 'auto', label: 'Route Default' },
  { id: 'sunny', label: 'Sunny' },
  { id: 'morning', label: 'Morning' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'rain', label: 'Monsoon Rain' },
  { id: 'fog', label: 'Mountain Fog' },
  { id: 'evening', label: 'Evening Dusk' },
];

const QUALITY_OPTIONS: { id: GraphicsQuality; label: string }[] = [
  { id: 'low', label: 'Low (Mobile Fast)' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High (Ultra PBR)' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  bestScore,
  bestDistanceM,
  onUpdateSettings,
  onResetProgress,
  onClose,
}) => {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-stone-950/88 p-4">
      <div className="max-w-xl w-full rounded-2xl bg-stone-900 border border-white/15 p-5 sm:p-6 max-h-[90vh] overflow-y-auto flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-3.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-white/12 text-stone-100 text-xs sm:text-sm font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <h2 className="font-display text-lg sm:text-xl font-bold text-stone-50 truncate">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="h-9 w-9 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Sound & Touch Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-stone-950/70 border border-white/10">
            <div>
              <div className="text-sm font-medium text-stone-100">Vehicle &amp; World Sound</div>
              <div className="text-xs text-stone-400">Engine, horn &amp; wind audio</div>
            </div>
            <button
              type="button"
              onClick={() => onUpdateSettings({ soundEnabled: !settings.soundEnabled })}
              className={`h-9 px-4 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                settings.soundEnabled
                  ? 'bg-emerald-500 text-stone-950'
                  : 'bg-stone-800 text-stone-300'
              }`}
            >
              {settings.soundEnabled ? 'Sound On' : 'Muted'}
            </button>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-stone-950/70 border border-white/10">
            <div>
              <div className="text-sm font-medium text-stone-100">Mobile Touch Pedals</div>
              <div className="text-xs text-stone-400">On-screen wheel &amp; pedals</div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ showTouchControls: !settings.showTouchControls })
              }
              className={`h-9 px-4 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                settings.showTouchControls
                  ? 'bg-amber-500 text-stone-950'
                  : 'bg-stone-800 text-stone-300'
              }`}
            >
              {settings.showTouchControls ? 'Visible' : 'Hidden'}
            </button>
          </div>
        </div>

        {/* Graphics Quality */}
        <div>
          <label className="block text-xs font-medium text-stone-300 mb-2">
            Graphics Quality
          </label>
          <div className="grid grid-cols-3 gap-2 bg-stone-950 p-1 rounded-xl">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onUpdateSettings({ graphicsQuality: q.id })}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                  settings.graphicsQuality === q.id
                    ? 'bg-amber-500 text-stone-950 font-semibold'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Default Camera View */}
        <div>
          <label className="block text-xs font-medium text-stone-300 mb-2">
            Preferred Camera Mode
          </label>
          <div className="flex flex-wrap gap-2">
            {CAMERA_OPTIONS.map((cam) => (
              <button
                key={cam.id}
                type="button"
                onClick={() => onUpdateSettings({ defaultCamera: cam.id })}
                className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                  settings.defaultCamera === cam.id
                    ? 'bg-amber-500 border-amber-400 text-stone-950 font-semibold'
                    : 'bg-stone-950 border-white/10 text-stone-300 hover:text-white'
                }`}
              >
                {cam.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Weather & Lighting Override */}
        <div>
          <label className="block text-xs font-medium text-stone-300 mb-2">
            Weather &amp; Time of Day
          </label>
          <div className="flex flex-wrap gap-2">
            {WEATHER_OPTIONS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onUpdateSettings({ weatherOverride: w.id })}
                className={`py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                  settings.weatherOverride === w.id
                    ? 'bg-emerald-500 border-emerald-400 text-stone-950 font-semibold'
                    : 'bg-stone-950 border-white/10 text-stone-300 hover:text-white'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Steering Sensitivity Slider */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-stone-300 font-medium">Steering Sensitivity</span>
            <span className="font-mono-num text-amber-400">
              {settings.steeringSensitivity.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.5"
            step="0.05"
            value={settings.steeringSensitivity}
            onChange={(e) =>
              onUpdateSettings({ steeringSensitivity: parseFloat(e.target.value) })
            }
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>

        {/* High Score Record & Explicit Two-Step Reset Confirmation */}
        <div className="pt-3 border-t border-white/10 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs bg-stone-950/75 border border-white/10 rounded-xl px-3.5 py-2.5 tabular-nums">
            <span className="flex items-center gap-1.5 text-stone-300">
              <Trophy size={14} className="text-amber-400" />
              Saved Career Record
            </span>
            <span className="font-mono-num text-amber-400 font-semibold">
              {bestScore.toLocaleString('en-IN')} pts · {(bestDistanceM / 1000).toFixed(2)} km
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {!confirmingReset ? (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="h-9 px-3.5 rounded-lg bg-stone-950 hover:bg-red-950/60 border border-white/10 text-stone-400 hover:text-red-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw size={14} />
                <span>Reset High Score &amp; Save</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 bg-red-950/50 border border-red-500/40 rounded-lg px-3 py-1.5">
                <span className="text-xs text-red-200 font-medium">
                  Erase Best Score &amp; Distance?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onResetProgress();
                    setConfirmingReset(false);
                  }}
                  className="h-7 px-2.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="h-7 px-2.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="h-10 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-sm cursor-pointer whitespace-nowrap ml-auto"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
