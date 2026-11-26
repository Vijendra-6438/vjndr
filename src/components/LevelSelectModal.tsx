import React from 'react';
import { ArrowLeft, CheckCircle2, Play, Trophy } from 'lucide-react';
import { MOUNTAIN_ROUTES } from '../data/levels';
import { LevelConfig, PlayerProgress, WeatherType } from '../types/game';

interface LevelSelectModalProps {
  progress: PlayerProgress;
  onSelectRoute: (routeId: number) => void;
  onStartRoute: (routeId: number) => void;
  onClose: () => void;
}

const WEATHER_LABELS: Record<WeatherType, string> = {
  sunny: 'Sunny Alpine',
  morning: 'Dawn Sunrise',
  cloudy: 'Cloudy Ghat',
  fog: 'Mountain Fog',
  rain: 'Monsoon Rain',
  evening: 'Evening Dusk',
};

const WEATHER_PALETTES: Record<
  WeatherType,
  { skyTop: string; skyBottom: string; sun: string; ridgeFar: string; ridgeNear: string }
> = {
  sunny: {
    skyTop: '#0369a1',
    skyBottom: '#7dd3fc',
    sun: '#fde047',
    ridgeFar: '#334155',
    ridgeNear: '#1e293b',
  },
  morning: {
    skyTop: '#1e3a8a',
    skyBottom: '#fdba74',
    sun: '#fb923c',
    ridgeFar: '#475569',
    ridgeNear: '#1c1917',
  },
  cloudy: {
    skyTop: '#334155',
    skyBottom: '#94a3b8',
    sun: '#cbd5e1',
    ridgeFar: '#3f3f46',
    ridgeNear: '#18181b',
  },
  fog: {
    skyTop: '#475569',
    skyBottom: '#cbd5e1',
    sun: '#e2e8f0',
    ridgeFar: '#64748b',
    ridgeNear: '#334155',
  },
  rain: {
    skyTop: '#1e293b',
    skyBottom: '#475569',
    sun: '#94a3b8',
    ridgeFar: '#1e293b',
    ridgeNear: '#0f172a',
  },
  evening: {
    skyTop: '#311042',
    skyBottom: '#f97316',
    sun: '#fbbf24',
    ridgeFar: '#3b1d36',
    ridgeNear: '#18181b',
  },
};

function getRoadStyleLabel(route: LevelConfig): string {
  if (route.curviness >= 42) return 'Winding Cliff Highway';
  if (route.curviness >= 35) return 'Curved Ghat Blacktop';
  return 'Wide 4-Lane Asphalt';
}

const RoutePreviewGraphic: React.FC<{ route: LevelConfig }> = ({ route }) => {
  const pal = WEATHER_PALETTES[route.weather];
  const gradId = `sky-grad-${route.id}`;
  // Curve offset proportional to route.curviness
  const curveOffset = Math.round((route.curviness - 24) * 1.15);
  const roadTopX = 160 + curveOffset * 0.45;
  const peakBoost = Math.min(22, Math.round((route.elevationAmp - 14) * 1.4));

  return (
    <svg
      viewBox="0 0 320 124"
      className="w-full h-28 rounded-lg overflow-hidden block bg-stone-950"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.skyTop} />
          <stop offset="100%" stopColor={pal.skyBottom} />
        </linearGradient>
      </defs>

      {/* Sky Backdrop */}
      <rect width="320" height="82" fill={`url(#${gradId})`} />

      {/* Sun / Horizon Glow */}
      <circle
        cx={route.weather === 'evening' ? 240 : 88}
        cy={route.weather === 'evening' ? 46 : 30}
        r={route.weather === 'fog' ? 10 : 14}
        fill={pal.sun}
        opacity={route.weather === 'rain' || route.weather === 'cloudy' ? 0.35 : 0.85}
      />

      {/* Far Mountain Ridge */}
      <path
        d={`M0 68 L48 ${42 - peakBoost * 0.4} L98 58 L156 ${30 - peakBoost * 0.6} L218 54 L276 ${36 - peakBoost * 0.5} L320 58 L320 82 L0 82 Z`}
        fill={pal.ridgeFar}
      />

      {/* Near Mountain Escarpment & Pine Silhouettes */}
      <path
        d={`M0 78 L36 ${52 - peakBoost * 0.3} L86 72 L134 62 L192 70 L248 ${48 - peakBoost * 0.4} L320 68 L320 86 L0 86 Z`}
        fill={pal.ridgeNear}
      />

      {/* Terrain Shoulder */}
      <rect y="74" width="320" height="50" fill="#1c2a1e" />

      {/* Curving 4-Lane Asphalt Road Surface */}
      <path
        d={`M 68 124 Q ${128 - curveOffset * 0.5} 96 ${roadTopX - 24} 74 L ${roadTopX + 24} 74 Q ${192 - curveOffset * 0.5} 96 252 124 Z`}
        fill="#1c1917"
      />

      {/* Steel Left & Right Guardrail Edges */}
      <path
        d={`M 66 124 Q ${126 - curveOffset * 0.5} 96 ${roadTopX - 24} 74`}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="2.5"
      />
      <path
        d={`M 254 124 Q ${194 - curveOffset * 0.5} 96 ${roadTopX + 24} 74`}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="2.5"
      />

      {/* Double Amber Center Line */}
      <path
        d={`M 160 124 Q ${160 - curveOffset * 0.5} 96 ${roadTopX} 74`}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeDasharray="6 5"
      />

      {/* Weather Overlay: Rain Streaks or Mist Layer */}
      {route.weather === 'rain' && (
        <g stroke="#bae6fd" strokeWidth="1.2" opacity="0.5">
          <line x1="35" y1="14" x2="26" y2="38" />
          <line x1="90" y1="8" x2="80" y2="34" />
          <line x1="150" y1="18" x2="140" y2="44" />
          <line x1="215" y1="10" x2="205" y2="36" />
          <line x1="275" y1="16" x2="265" y2="42" />
          <line x1="65" y1="52" x2="55" y2="76" />
          <line x1="245" y1="54" x2="235" y2="78" />
        </g>
      )}

      {route.weather === 'fog' && (
        <rect y="52" width="320" height="32" fill="#e2e8f0" opacity="0.28" />
      )}
    </svg>
  );
};

export const LevelSelectModal: React.FC<LevelSelectModalProps> = ({
  progress,
  onSelectRoute,
  onStartRoute,
  onClose,
}) => {
  const activeRoute: LevelConfig =
    MOUNTAIN_ROUTES[progress.selectedRoute - 1] ?? MOUNTAIN_ROUTES[0];

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-stone-950/94 p-4 sm:p-7 overflow-hidden">
      {/* Header */}
      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/12">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 border border-white/15 text-stone-200 text-sm flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-stone-50">
              Select Mountain Highway Route
            </h2>
            <p className="text-xs text-stone-400">
              6 endless mountain asphalt corridors · Choose weather, terrain climb &amp; road curves
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-stone-900 border border-amber-400/25 rounded-xl px-4 py-2 text-xs tabular-nums">
          <Trophy size={15} className="text-amber-400 shrink-0" />
          <div>
            <span className="text-stone-400">High Score: </span>
            <span className="text-amber-400 font-bold font-mono-num">
              {progress.bestScore.toLocaleString('en-IN')}
            </span>
          </div>
          <span aria-hidden="true" className="text-stone-600">
            ·
          </span>
          <div>
            <span className="text-stone-400">Best Dist: </span>
            <span className="text-emerald-400 font-bold font-mono-num">
              {(progress.bestDistanceM / 1000).toFixed(2)} km
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable 6 Route Cards with Visual Road & Environment Previews */}
      <div className="max-w-6xl w-full mx-auto flex-1 overflow-y-auto py-4 pr-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
        {MOUNTAIN_ROUTES.map((route) => {
          const isSelected = route.id === progress.selectedRoute;

          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onSelectRoute(route.id)}
              className={`text-left rounded-2xl p-3.5 border transition-colors flex flex-col justify-between gap-3 cursor-pointer ${
                isSelected
                  ? 'bg-stone-900 border-amber-400'
                  : 'bg-stone-900/80 border-white/12 hover:border-white/30'
              }`}
            >
              <div className="flex flex-col gap-2.5">
                <RoutePreviewGraphic route={route} />

                <div className="flex items-center justify-between gap-2 text-xs text-stone-400 tabular-nums">
                  <span>
                    Route {String(route.id).padStart(2, '0')} · {route.highwayCode} ·{' '}
                    <span className="text-stone-200 font-medium">
                      {WEATHER_LABELS[route.weather]}
                    </span>
                  </span>
                  {isSelected && (
                    <span className="flex items-center gap-1 text-amber-400 font-semibold shrink-0">
                      <CheckCircle2 size={14} />
                      Selected
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="font-display text-base font-bold text-stone-100 leading-snug">
                    {route.name}
                  </h3>
                  <p className="text-xs text-stone-400 mt-0.5">{route.region}</p>
                </div>

                <p className="text-xs text-stone-300 leading-relaxed">
                  {route.description}
                </p>
              </div>

              <div className="pt-2.5 border-t border-white/10 flex items-center justify-between text-xs tabular-nums">
                <div className="text-stone-300">
                  <span>{getRoadStyleLabel(route)}</span>
                  <span aria-hidden="true" className="mx-1.5 text-stone-600">
                    ·
                  </span>
                  <span className="text-stone-400">{route.roadWidth.toFixed(1)}m</span>
                </div>

                <span className="text-amber-400 font-mono-num font-semibold shrink-0">
                  Climb {route.elevationAmp}m
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Selected Route Launch Bar */}
      <div className="max-w-6xl w-full mx-auto pt-4 border-t border-white/12 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs sm:text-sm text-stone-200">
          <span className="font-semibold text-amber-400">
            Selected Route {activeRoute.id}: {activeRoute.name}
          </span>
          <span aria-hidden="true" className="mx-2 text-stone-500">
            ·
          </span>
          <span className="text-stone-400">
            {WEATHER_LABELS[activeRoute.weather]} · {getRoadStyleLabel(activeRoute)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onStartRoute(activeRoute.id)}
          className="h-12 px-7 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-display font-bold text-sm tracking-wide flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Play size={16} fill="currentColor" />
          <span>PLAY ROUTE</span>
        </button>
      </div>
    </div>
  );
};
