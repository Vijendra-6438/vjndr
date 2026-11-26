import * as THREE from 'three';
import { GraphicsQuality, LevelConfig, RoadSurface, WeatherType } from '../types/game';
import { ProceduralTextureSet } from './textures';
import {
  getTunnelKitTemplates,
  TUNNEL_BASE_ROAD_WIDTH,
  TUNNEL_SEGMENT_LEN,
  TUNNEL_SUBSEG_LEN,
  TunnelKitTemplates,
  TunnelStyle,
} from './tunnelGlbLoader';

export interface TrackSample {
  position: THREE.Vector3;
  forward: THREE.Vector3; // unit tangent pointing forward along race direction
  right: THREE.Vector3; // unit horizontal right vector (forward x worldUp)
  surface: RoadSurface;
  mudIntensity: number;
  slope: number;
  bankAngle: number;
  minLat: number;
  maxLat: number;
}

export interface TunnelLightingState {
  insideFactor: number;
  approachFactor: number;
  activeLampCount: number;
  lampPositions: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

export interface BuiltWorld {
  group: THREE.Group;
  sampleAtDistance: (raceDistM: number, out: TrackSample) => void;
  sampleGroundAt: (raceDistM: number, lat: number, out: TrackSample) => void;
  getCurvatureAt: (raceDistM: number) => number;
  getTunnelFactorAt: (raceDistM: number) => number;
  getTunnelLightingState: (raceDistM: number, out: TunnelLightingState) => void;
  updateAtDistance: (playerDistM: number) => void;
  rainPoints: THREE.Points | null;
  updateWeatherFrame: (camPos: THREE.Vector3, dt: number) => void;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function mergeSimpleGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;

  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      positions[(vOffset + i) * 3] = pos.getX(i);
      positions[(vOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[(vOffset + i) * 3] = norm.getX(i);
        normals[(vOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vOffset + i) * 3 + 2] = norm.getZ(i);
      }
      if (uv) {
        uvs[(vOffset + i) * 2] = uv.getX(i);
        uvs[(vOffset + i) * 2 + 1] = uv.getY(i);
      }
    }

    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[iOffset + i] = g.index.getX(i) + vOffset;
      }
      iOffset += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += pos.count;
    }

    vOffset += pos.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function createCurvedFoliageCard(
  width: number,
  height: number,
  archDepth: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 2, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (width * 0.5);
    const y = pos.getY(i) / (height * 0.5);
    pos.setZ(i, -(x * x + y * y) * archDepth);
  }
  geo.computeVertexNormals();
  return geo;
}

export function getWeatherAtmosphere(weather: WeatherType): {
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  lightsOn: boolean;
} {
  switch (weather) {
    case 'sunny':
      return {
        skyTop: 0x1d4ed8,
        skyHorizon: 0x93c5fd,
        fogColor: 0xa5bed6,
        fogDensity: 0.00095,
        sunColor: 0xfff8ed,
        sunIntensity: 1.82,
        sunPos: [70, 115, 45],
        hemiSky: 0x93c5fd,
        hemiGround: 0x263d1f,
        hemiIntensity: 0.72,
        lightsOn: false,
      };
    case 'morning':
      return {
        skyTop: 0x335c88,
        skyHorizon: 0xf5c488,
        fogColor: 0xdab692,
        fogDensity: 0.0014,
        sunColor: 0xfdba74,
        sunIntensity: 1.68,
        sunPos: [95, 48, -35],
        hemiSky: 0xfed7aa,
        hemiGround: 0x263820,
        hemiIntensity: 0.68,
        lightsOn: false,
      };
    case 'evening':
      return {
        skyTop: 0x1e293b,
        skyHorizon: 0xd97742,
        fogColor: 0x8a5846,
        fogDensity: 0.0017,
        sunColor: 0xf97316,
        sunIntensity: 1.52,
        sunPos: [-95, 34, -50],
        hemiSky: 0xfb923c,
        hemiGround: 0x1e291c,
        hemiIntensity: 0.64,
        lightsOn: false,
      };
    case 'cloudy':
      return {
        skyTop: 0x475569,
        skyHorizon: 0x94a3b8,
        fogColor: 0x8b9bb0,
        fogDensity: 0.0016,
        sunColor: 0xe2e8f0,
        sunIntensity: 1.4,
        sunPos: [40, 90, 20],
        hemiSky: 0xcbd5e1,
        hemiGround: 0x293b23,
        hemiIntensity: 0.78,
        lightsOn: false,
      };
    case 'rain':
      return {
        skyTop: 0x1e293b,
        skyHorizon: 0x475569,
        fogColor: 0x4b596b,
        fogDensity: 0.0026,
        sunColor: 0x94a3b8,
        sunIntensity: 1.12,
        sunPos: [30, 85, 20],
        hemiSky: 0x64748b,
        hemiGround: 0x21301e,
        hemiIntensity: 0.74,
        lightsOn: false,
      };
    case 'fog':
      return {
        skyTop: 0x64748b,
        skyHorizon: 0xcbd5e1,
        fogColor: 0xbbc7d4,
        fogDensity: 0.0038,
        sunColor: 0xe2e8f0,
        sunIntensity: 1.18,
        sunPos: [45, 75, 20],
        hemiSky: 0xdbeafe,
        hemiGround: 0x2c3d28,
        hemiIntensity: 0.78,
        lightsOn: false,
      };
  }
}

const CHUNK_LEN = 120; // meters per seamless streamed chunk
const STEP_M = 4; // 30 longitudinal quads per chunk (4m resolution)
const CHUNKS_BEHIND = 2; // 240m retained behind for mirrors/reverse/replay scrub
const CHUNKS_AHEAD = 6; // 720m streamed ahead beyond fog horizon

interface SignSlot {
  group: THREE.Group;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

interface StreamedChunk {
  index: number;
  group: THREE.Group;
  posArr: Float32Array;
  rightArr: Float32Array;
  roadVerts: Float32Array;
  roadUvs: Float32Array;
  roadGeo: THREE.BufferGeometry;
  curbVerts: Float32Array;
  curbGeo: THREE.BufferGeometry;
  tVerts: Float32Array;
  tColors: Float32Array;
  tUvs: Float32Array;
  terrainGeo: THREE.BufferGeometry;
  railsIM: THREE.InstancedMesh;
  postsIM: THREE.InstancedMesh;
  rocksIM: THREE.InstancedMesh;
  pineTrunksIM: THREE.InstancedMesh;
  pineCrownsIM: THREE.InstancedMesh;
  broadTrunksIM: THREE.InstancedMesh;
  broadCrownsIM: THREE.InstancedMesh;
  shrubsIM: THREE.InstancedMesh;
  grassIM: THREE.InstancedMesh;
  polesIM: THREE.InstancedMesh;
  lampsIM: THREE.InstancedMesh;
  signSlot: SignSlot | null;
  disposables: { dispose: () => void }[];
}

function redrawHighwaySignCanvas(
  ctx: CanvasRenderingContext2D,
  code: string,
  line1: string,
  line2: string,
): void {
  ctx.fillStyle = '#0c4a6e';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 172);

  ctx.fillStyle = '#facc15';
  ctx.fillRect(28, 34, 96, 54);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(code, 76, 69);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = 'bold 29px sans-serif';
  ctx.fillText(line1, 144, 72);
  ctx.fillStyle = '#bae6fd';
  ctx.font = 'bold 21px sans-serif';
  ctx.fillText(line2, 144, 132);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('↑', 60, 142);
}

/**
 * Builds an unlimited, C1-smooth streaming Mountain Highway world with pure paved dark asphalt,
 * steel roadside guardrails, lush green mountain slopes, varied conifers & broadleaf trees,
 * natural roadside bushes/grass tufts, and pooled zero-allocation chunk streaming.
 */
export function buildLevelWorld(
  level: LevelConfig,
  weather: WeatherType,
  quality: GraphicsQuality,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
  runSeed?: number,
  onTunnelError?: (message: string) => void,
  onTunnelTemplatesReady?: (tunnelSlotGroups: THREE.Group[]) => void,
): BuiltWorld {
  const group = new THREE.Group();
  const globalDisposables: { dispose: () => void }[] = [];
  const atmos = getWeatherAtmosphere(weather);
  let worldDisposed = false;

  // 1. Procedural Sky Gradient Dome
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 32;
  skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d')!;
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + new THREE.Color(atmos.skyTop).getHexString());
  grad.addColorStop(0.58, '#' + new THREE.Color(atmos.skyHorizon).getHexString());
  grad.addColorStop(1, '#' + new THREE.Color(atmos.fogColor).getHexString());
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 32, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  globalDisposables.push(skyTex);

  const skyGeo = new THREE.SphereGeometry(950, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  globalDisposables.push(skyGeo, skyMat);
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  group.add(skyDome);

  // 2. Continuous Analytical Mountain Highway Centerline (Zero finite bounds, C-infinity smooth!)
  const phaseA = (level.id * 1.37) % (Math.PI * 2);
  const phaseB = (level.id * 2.91) % (Math.PI * 2);
  const phaseC = (level.id * 4.19) % (Math.PI * 2);
  const freqScale = level.turnFrequency;
  const curveAmp = level.curviness;
  const elevAmp = level.elevationAmp;
  const halfRoad = level.roadWidth * 0.5;

  const smoothstep01 = (edge0: number, edge1: number, x: number): number => {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // 2a. Endless Deterministic-Per-Run Mountain Tunnel Schedule (Spaced Far Apart, Subtle Curves)
  interface TunnelSpan {
    id: number;
    startS: number;
    endS: number;
    segmentCount: number;
    style: TunnelStyle;
    curveDir: -1 | 1;
    curveStyle: 'arc' | 'winding';
    curveAmp: number;
    lampAnchors: THREE.Vector3[];
  }

  const MAX_TUNNEL_SEGMENTS = 13;
  const tunnels: TunnelSpan[] = [];
  const tunnelRand = seededRand((runSeed ?? level.id * 10007) ^ 0x9e3779b9);
  const tunnelStyles: TunnelStyle[] = ['B', 'A', 'C'];
  const styleOffset = Math.floor(tunnelRand() * 3);
  const dirOffset = tunnelRand() > 0.5 ? 0 : 1;
  // Keep start grid & first 780m+ completely open mountain highway
  let nextTunnelStartS = 780 + Math.floor(tunnelRand() * 220);

  const ensureTunnelsUpTo = (targetS: number): void => {
    while (nextTunnelStartS <= targetS) {
      const segs = 10 + Math.floor(tunnelRand() * 4); // 10..13 x 14m = 140m..182m
      const startS = nextTunnelStartS;
      const endS = startS + segs * TUNNEL_SEGMENT_LEN;
      const id = tunnels.length;
      const style = tunnelStyles[(id + styleOffset) % tunnelStyles.length];
      const curveDir: -1 | 1 = (id + dirOffset) % 2 === 0 ? -1 : 1;
      const curveStyle: 'arc' | 'winding' = id % 3 === 2 ? 'winding' : 'arc';
      const curveAmp =
        curveStyle === 'winding'
          ? 10.5 + tunnelRand() * 2.8
          : 15.0 + tunnelRand() * 4.5;
      tunnels.push({
        id,
        startS,
        endS,
        segmentCount: segs,
        style,
        curveDir,
        curveStyle,
        curveAmp,
        lampAnchors: [],
      });
      // Far-spaced open alpine highway stretches (1,450m..2,130m) between tunnels
      nextTunnelStartS = endS + 1450 + Math.floor(tunnelRand() * 680);
    }
  };
  ensureTunnelsUpTo(1800);

  // Evaluate highway spine position at any race distance s (mostly level with slight gradual up/down grades
  // and subtle smooth left/right/winding tunnel curves aligned cleanly with outside highway)
  const zeroEnv = 0.65 + 0.35 * Math.sin(phaseC);
  const zeroCornerOffset =
    Math.sin(phaseA) * (curveAmp * 1.25) +
    Math.sin(phaseB) * (curveAmp * 0.62) +
    Math.sin(phaseC) * (curveAmp * 0.24 * zeroEnv) +
    Math.cos(phaseC) * (curveAmp * 0.65);
  const zeroElevOffset =
    (Math.sin(phaseB) * 0.56 + Math.sin(phaseA) * 0.24 + Math.cos(phaseC) * 0.38) *
    elevAmp;

  const findFirstTunnelByEndS = (minEndS: number): number => {
    let lo = 0;
    let hi = tunnels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tunnels[mid].endS < minEndS) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const evalSpinePos = (distM: number, out: THREE.Vector3): THREE.Vector3 => {
    const curveBlend = smoothstep01(55, 195, Math.abs(distM)) * (distM >= 0 ? 1 : 0.25);
    const s = distM;
    if (s > 500) {
      ensureTunnelsUpTo(s + 320);
    }
    const cornerEnvelope = 0.65 + 0.35 * Math.sin(s * 0.0018 + phaseC);

    let tunnelDamp = 0;
    let tunnelArcOffset = 0;
    const startIdx = findFirstTunnelByEndS(s - 340);
    for (let i = startIdx; i < tunnels.length; i++) {
      const t = tunnels[i];
      const halfSpan = (t.endS - t.startS) * 1.35;
      const mid = (t.startS + t.endS) * 0.5;
      if (s < mid - halfSpan) break;
      if (s > mid + halfSpan) continue;

      const u = (s - mid) / halfSpan;
      const bell = 0.5 * (1 + Math.cos(Math.PI * u));
      const bellSq = bell * bell; // C2-continuous bell curve across tunnel + valley transitions
      tunnelDamp = Math.max(tunnelDamp, smoothstep01(0, 0.38, 1 - Math.abs(u)));
      if (t.curveStyle === 'winding') {
        tunnelArcOffset += t.curveDir * t.curveAmp * Math.sin(Math.PI * u * 1.15) * bellSq;
      } else {
        tunnelArcOffset += t.curveDir * t.curveAmp * bellSq;
      }
    }

    const x =
      (Math.sin(s * 0.0034 * freqScale + phaseA) * (curveAmp * 1.25) +
        Math.sin(s * 0.0088 * freqScale + phaseB) *
          (curveAmp * 0.62 * (1 - 0.74 * tunnelDamp)) +
        Math.sin(s * 0.0168 * freqScale + phaseC) *
          (curveAmp * 0.24 * cornerEnvelope * (1 - 0.9 * tunnelDamp)) +
        Math.cos(s * 0.0022 * freqScale + phaseC) * (curveAmp * 0.65) +
        tunnelArcOffset -
        zeroCornerOffset) *
      curveBlend;

    const elevRaw =
      (Math.sin(s * 0.00145 + phaseB) * 0.56 +
        Math.sin(s * 0.00295 + phaseA) * 0.24 +
        Math.cos(s * 0.00078 + phaseC) * 0.38) *
        elevAmp -
      zeroElevOffset;
    const y = elevRaw * smoothstep01(40, 220, Math.max(0, distM));

    return out.set(x, y, -s);
  };

  const _spPrev = new THREE.Vector3();
  const _spNext = new THREE.Vector3();
  const _worldUp = new THREE.Vector3(0, 1, 0);

  const sampleAtDistance = (raceDistM: number, out: TrackSample): void => {
    evalSpinePos(raceDistM, out.position);
    evalSpinePos(raceDistM - 0.35, _spPrev);
    evalSpinePos(raceDistM + 0.35, _spNext);

    out.forward.subVectors(_spNext, _spPrev).normalize();
    out.right.crossVectors(out.forward, _worldUp).normalize();
    out.surface = 'asphalt';
    out.mudIntensity = 0;
    out.slope = out.forward.y;
    out.bankAngle = 0;
    out.minLat = -halfRoad + 0.85;
    out.maxLat = halfRoad - 0.85;
  };

  const sampleGroundAt = (raceDistM: number, _lat: number, out: TrackSample): void => {
    sampleAtDistance(raceDistM, out);
  };

  const _curvSampleA = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    surface: 'asphalt' as RoadSurface,
    mudIntensity: 0,
    slope: 0,
    bankAngle: 0,
    minLat: -halfRoad,
    maxLat: halfRoad,
  };
  const _curvSampleB = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    surface: 'asphalt' as RoadSurface,
    mudIntensity: 0,
    slope: 0,
    bankAngle: 0,
    minLat: -halfRoad,
    maxLat: halfRoad,
  };

  const getCurvatureAt = (raceDistM: number): number => {
    sampleAtDistance(raceDistM, _curvSampleA);
    sampleAtDistance(raceDistM + 16, _curvSampleB);
    const dx = _curvSampleB.forward.x - _curvSampleA.forward.x;
    const dz = _curvSampleB.forward.z - _curvSampleA.forward.z;
    return Math.hypot(dx, dz);
  };

  // 2b. Tunnel Span Helpers

  const getTunnelAt = (sDist: number, pad = 0): TunnelSpan | null => {
    const idx = findFirstTunnelByEndS(sDist - Math.max(0, pad));
    for (let i = idx; i < tunnels.length; i++) {
      const t = tunnels[i];
      if (sDist >= t.startS - pad && sDist <= t.endS + pad) {
        return t;
      }
      if (t.startS - pad > sDist) break;
    }
    return null;
  };

  const getTunnelFactorAt = (sDist: number): number => {
    const t = getTunnelAt(sDist, 12);
    if (!t) return 0;
    if (sDist < t.startS + 20) {
      return smoothstep01(t.startS - 10, t.startS + 20, sDist);
    }
    if (sDist > t.endS - 20) {
      return 1 - smoothstep01(t.endS - 20, t.endS + 10, sDist);
    }
    return 1;
  };

  // Continuous Tall Mountain Peak & Valley Height Function (tall mountains even over mostly-level road!)
  const getMountainHeight = (sDist: number, lat: number): number => {
    const absLat = Math.abs(lat);
    if (absLat <= halfRoad + 1.02) {
      return -0.05;
    }
    const distOut = absLat - (halfRoad + 1.02);
    const hillFactor = Math.min(1.58, distOut / 145);

    // Multi-octave craggy mountain ridge & layered distant mountain backdrop
    const ridge1 = 1 - Math.abs(Math.sin(sDist * 0.0074 + lat * 0.0145 + phaseA));
    const ridge2 = 1 - Math.abs(Math.cos(sDist * 0.0165 - lat * 0.02 + phaseB));
    const ridge3 = 0.5 + 0.5 * Math.sin(sDist * 0.0032 - lat * 0.0065 + phaseC);
    const valleyWave = Math.sin(sDist * 0.004 + lat * 0.008 + phaseC) * 0.4 + 0.78;
    const peakAmp = 104 + elevAmp * 6.5;
    const mountainH = (ridge1 * 0.52 + ridge2 * 0.3 + ridge3 * 0.18) * valleyWave * peakAmp;

    // Gentle green hillside rise & grassy meadow embankments along highway verges
    const sideWave = Math.sin(sDist * 0.0052 + (lat > 0 ? 1.3 : -1.3));
    const slopeCut =
      sideWave > -0.35
        ? Math.min(1, distOut / 18) * (2.2 + ridge1 * 4.2)
        : -Math.min(1, distOut / 20) * 2.2;

    const baseH = slopeCut + Math.pow(hillFactor, 1.4) * mountainH - 0.08;

    // Raise flanking hillside slopes around tunnels so portals embed naturally into mountain rock ridges
    const tSpan = getTunnelAt(sDist, 36);
    if (!tSpan) return baseH;

    let edgeBlend = 1;
    if (sDist < tSpan.startS + 6) {
      edgeBlend = smoothstep01(tSpan.startS - 36, tSpan.startS + 6, sDist);
    } else if (sDist > tSpan.endS - 6) {
      edgeBlend = 1 - smoothstep01(tSpan.endS - 6, tSpan.endS + 36, sDist);
    }

    // Keep immediate +-11.35m bore clearance low so green terrain never intrudes inside walls,
    // while rising steeply past +-11.35m into solid rocky mountain shoulders flanking the portal
    const outerDist = Math.max(0, absLat - 11.35);
    const tunnelFlankH =
      0.16 + Math.min(1, outerDist / 6.2) * 14.8 + Math.min(1, outerDist / 20) * 10.5;
    return THREE.MathUtils.lerp(baseH, Math.max(baseH, tunnelFlankH), edgeBlend);
  };

  // 3. Shared Materials & Base Geometries (Calibrated envMapIntensity prevents studio washout/glare)
  const isWet = weather === 'rain';
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: textures.asphaltMap,
    roughnessMap: textures.asphaltRoughMap,
    bumpMap: textures.asphaltBumpMap,
    bumpScale: 0.016,
    roughness: isWet ? 0.54 : 0.92,
    metalness: isWet ? 0.05 : 0.01,
    envMapIntensity: isWet ? 0.34 : 0.14,
  });

  const shoulderCurbMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c21,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.14,
  });

  const terrainMat = new THREE.MeshStandardMaterial({
    map: textures.mountainTerrainMap,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.16,
  });

  const guardrailMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.42,
    metalness: 0.72,
  });

  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.2,
  });

  const barkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    roughness: 0.93,
    envMapIntensity: 0.2,
  });

  const pineFoliageMat = new THREE.MeshStandardMaterial({
    map: textures.pineNeedleMap,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.88,
    envMapIntensity: 0.18,
  });

  const broadleafMat = new THREE.MeshStandardMaterial({
    map: textures.broadleafMap,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.87,
    envMapIntensity: 0.18,
  });

  const shrubMat = new THREE.MeshStandardMaterial({
    map: textures.shrubMap,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.89,
    envMapIntensity: 0.18,
  });

  const grassTuftMat = new THREE.MeshStandardMaterial({
    map: textures.grassTuftMap,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.9,
    envMapIntensity: 0.18,
  });

  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0xfde68a),
    emissiveIntensity: atmos.lightsOn ? 1.05 : 0.04,
  });

  // Shared Geometries for Mountain Scenery Instancing per Chunk
  const rockGeo = new THREE.DodecahedronGeometry(1.45, 1);

  // Archetype 1: Tall Mountain Conifer / Pine Tree
  const pTrunk = new THREE.CylinderGeometry(0.09, 0.32, 9.6, 7);
  pTrunk.translate(0, 4.75, 0);
  const pRoot = new THREE.CylinderGeometry(0.28, 0.48, 0.75, 7);
  pRoot.translate(0, 0.35, 0);
  const pineTrunkGeo = mergeSimpleGeometries([pTrunk, pRoot]);

  const pineCards: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 6; tier++) {
    const tNorm = tier / 5;
    const y = 2.6 + tNorm * 6.5;
    const w = 4.35 * (1 - tNorm * 0.68) + 0.9;
    const h = 2.5 * (1 - tNorm * 0.54) + 0.7;
    const fronds = tier < 4 ? 3 : 2;
    for (let f = 0; f < fronds; f++) {
      const card = createCurvedFoliageCard(w, h, 0.24);
      card.rotateX(0.32 + tNorm * 0.14);
      card.rotateY((f / fronds) * Math.PI + tier * 0.75);
      card.translate(0, y, 0);
      pineCards.push(card);
    }
  }
  const pineCrownGeo = mergeSimpleGeometries(pineCards);

  // Archetype 2: Lush Mountain Broadleaf / Oak Hill Tree (distinct forked trunk + billowing canopy)
  const bTrunk = new THREE.CylinderGeometry(0.16, 0.38, 4.6, 7);
  bTrunk.translate(0, 2.3, 0);
  const bBranchL = new THREE.CylinderGeometry(0.08, 0.15, 2.6, 6);
  bBranchL.rotateZ(0.45);
  bBranchL.translate(-0.55, 4.2, 0.15);
  const bBranchR = new THREE.CylinderGeometry(0.08, 0.15, 2.4, 6);
  bBranchR.rotateZ(-0.42);
  bBranchR.translate(0.5, 4.1, -0.15);
  const broadTrunkGeo = mergeSimpleGeometries([bTrunk, bBranchL, bBranchR]);

  const broadCards: THREE.BufferGeometry[] = [];
  const lobeSpecs: [number, number, number, number, number][] = [
    [0, 5.8, 0, 4.4, 3.6],
    [-1.4, 4.9, 0.7, 3.3, 2.8],
    [1.4, 5.0, -0.6, 3.2, 2.7],
    [0.2, 6.7, 0.4, 2.9, 2.5],
  ];
  for (let li = 0; li < lobeSpecs.length; li++) {
    const [lx, ly, lz, lw, lh] = lobeSpecs[li];
    for (let c = 0; c < 3; c++) {
      const card = createCurvedFoliageCard(lw, lh, 0.28);
      card.rotateX(0.14);
      card.rotateY((c / 3) * Math.PI + li * 0.55);
      card.translate(lx, ly, lz);
      broadCards.push(card);
    }
  }
  const broadCrownGeo = mergeSimpleGeometries(broadCards);

  // Bush / Fern Shrub Cluster
  const shrubCards: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 3; f++) {
    const fc = createCurvedFoliageCard(1.75, 1.28, 0.18);
    fc.translate(0, 0.58, 0);
    fc.rotateY((f / 3) * Math.PI);
    shrubCards.push(fc);
  }
  const shrubGeo = mergeSimpleGeometries(shrubCards);

  // Roadside Tall Grass Tuft Clump
  const grassCards: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 2; f++) {
    const gc = createCurvedFoliageCard(1.35, 0.92, 0.1);
    gc.translate(0, 0.4, 0);
    gc.rotateY(f * (Math.PI * 0.5) + 0.3);
    grassCards.push(gc);
  }
  const grassClusterGeo = mergeSimpleGeometries(grassCards);

  const guardrailSegGeo = new THREE.BoxGeometry(0.14, 0.32, 1.0);
  guardrailSegGeo.translate(0, 0.64, 0);
  const guardrailPostGeo = new THREE.BoxGeometry(0.11, 0.76, 0.11);
  guardrailPostGeo.translate(0, 0.38, 0);

  const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 7.2, 7);
  poleGeo.translate(0, 3.6, 0);
  const lampHeadGeo = new THREE.BoxGeometry(0.95, 0.14, 0.32);

  const signBoardGeo = new THREE.BoxGeometry(3.8, 1.45, 0.08);
  const signPostGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);

  globalDisposables.push(
    asphaltMat,
    shoulderCurbMat,
    terrainMat,
    guardrailMat,
    rockMat,
    barkMat,
    pineFoliageMat,
    broadleafMat,
    shrubMat,
    grassTuftMat,
    lampHeadMat,
    rockGeo,
    pineTrunkGeo,
    pineCrownGeo,
    broadTrunkGeo,
    broadCrownGeo,
    shrubGeo,
    grassClusterGeo,
    guardrailSegGeo,
    guardrailPostGeo,
    poleGeo,
    lampHeadGeo,
    signBoardGeo,
    signPostGeo,
  );

  // 4. Static Precomputed Topology + Object Pool for Zero-Churn Chunk Streaming
  const chunks = new Map<number, StreamedChunk>();
  const chunkPool: StreamedChunk[] = [];
  const signPool: SignSlot[] = [];

  const rows = Math.round(CHUNK_LEN / STEP_M) + 1;
  const densityMult = quality === 'low' ? 0.52 : quality === 'medium' ? 0.76 : 1.0;

  const crossOffsets = [
    -440, -310, -210, -140, -88, -52, -30, -18, -11.5,
    -(halfRoad + 0.9),
    halfRoad + 0.9,
    11.5, 18, 30, 52, 88, 140, 210, 310, 440,
  ];
  const tCols = crossOffsets.length;

  const terrainRowIndices: number[] = [];
  for (let i = 0; i < rows; i += 2) terrainRowIndices.push(i);
  if (terrainRowIndices[terrainRowIndices.length - 1] !== rows - 1) {
    terrainRowIndices.push(rows - 1);
  }
  const tRows = terrainRowIndices.length;

  // Shared static index buffers reused across every pooled chunk
  const roadIdxArr: number[] = [];
  const curbIdxArr: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    roadIdxArr.push(a, b, c, b, d, c);

    for (const offset of [0, 2]) {
      const ca = i * 4 + offset;
      const cb = ca + 1;
      const cc = (i + 1) * 4 + offset;
      const cd = cc + 1;
      curbIdxArr.push(ca, cb, cc, cb, cd, cc);
    }
  }
  const sharedRoadIndex = new THREE.Uint16BufferAttribute(roadIdxArr, 1);
  const sharedCurbIndex = new THREE.Uint16BufferAttribute(curbIdxArr, 1);

  const terrainIdxArr: number[] = [];
  for (let r = 0; r < tRows - 1; r++) {
    for (let c = 0; c < tCols - 1; c++) {
      const a = r * tCols + c;
      const b = r * tCols + c + 1;
      const d = (r + 1) * tCols + c;
      const e = (r + 1) * tCols + c + 1;
      terrainIdxArr.push(a, b, d, b, e, d);
    }
  }
  const sharedTerrainIndex = new THREE.Uint16BufferAttribute(terrainIdxArr, 1);

  const rockCount = Math.max(4, Math.floor(12 * densityMult));
  const pineCount = Math.max(6, Math.floor(20 * densityMult));
  const broadCount = Math.max(5, Math.floor(14 * densityMult));
  const shrubCount = Math.max(7, Math.floor(22 * densityMult));
  const grassCount = Math.max(10, Math.floor(34 * densityMult));
  const railCount = (rows - 1) * 2;
  const poleCount = 2;

  const _tmpSample: TrackSample = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    surface: 'asphalt',
    mudIntensity: 0,
    slope: 0,
    bankAngle: 0,
    minLat: -halfRoad,
    maxLat: halfRoad,
  };
  const _dummy = new THREE.Object3D();
  const _rotMat = new THREE.Matrix4();
  const _negForward = new THREE.Vector3();
  const _tint = new THREE.Color();
  const _railRight = new THREE.Vector3();
  const _railUp = new THREE.Vector3();
  const _railSegDir = new THREE.Vector3();

  const acquireSignSlot = (
    code: string,
    line1: string,
    line2: string,
  ): SignSlot => {
    let slot = signPool.pop();
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 192;
      const ctx = canvas.getContext('2d')!;
      redrawHighwaySignCanvas(ctx, code, line1, line2);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 });
      globalDisposables.push(tex, mat);

      const sGroup = new THREE.Group();
      const board = new THREE.Mesh(signBoardGeo, mat);
      board.position.set(0, 3.3, 0);
      sGroup.add(board);
      for (const px of [-1.4, 1.4]) {
        const post = new THREE.Mesh(signPostGeo, guardrailMat);
        post.position.set(px, 1.6, -0.05);
        sGroup.add(post);
      }
      slot = { group: sGroup, canvas, ctx, tex };
    } else {
      redrawHighwaySignCanvas(slot.ctx, code, line1, line2);
      slot.tex.needsUpdate = true;
    }
    return slot;
  };

  const createEmptyChunk = (): StreamedChunk => {
    const chunkGroup = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];

    const posArr = new Float32Array(rows * 3);
    const rightArr = new Float32Array(rows * 3);

    const roadVerts = new Float32Array(rows * 2 * 3);
    const roadUvs = new Float32Array(rows * 2 * 2);
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(roadVerts, 3));
    roadGeo.setAttribute('uv', new THREE.BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(sharedRoadIndex);
    disposables.push(roadGeo);

    const roadMesh = new THREE.Mesh(roadGeo, asphaltMat);
    roadMesh.receiveShadow = true;
    chunkGroup.add(roadMesh);

    const curbVerts = new Float32Array(rows * 4 * 3);
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.BufferAttribute(curbVerts, 3));
    curbGeo.setIndex(sharedCurbIndex);
    disposables.push(curbGeo);

    const curbMesh = new THREE.Mesh(curbGeo, shoulderCurbMat);
    curbMesh.receiveShadow = true;
    chunkGroup.add(curbMesh);

    const tVerts = new Float32Array(tRows * tCols * 3);
    const tColors = new Float32Array(tRows * tCols * 3);
    const tUvs = new Float32Array(tRows * tCols * 2);
    const terrainGeo = new THREE.BufferGeometry();
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(tVerts, 3));
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
    terrainGeo.setAttribute('uv', new THREE.BufferAttribute(tUvs, 2));
    terrainGeo.setIndex(sharedTerrainIndex);
    disposables.push(terrainGeo);

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    chunkGroup.add(terrainMesh);

    const railsIM = new THREE.InstancedMesh(guardrailSegGeo, guardrailMat, railCount);
    const postsIM = new THREE.InstancedMesh(guardrailPostGeo, guardrailMat, railCount);
    const rocksIM = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const pineTrunksIM = new THREE.InstancedMesh(pineTrunkGeo, barkMat, pineCount);
    const pineCrownsIM = new THREE.InstancedMesh(pineCrownGeo, pineFoliageMat, pineCount);
    const broadTrunksIM = new THREE.InstancedMesh(broadTrunkGeo, barkMat, broadCount);
    const broadCrownsIM = new THREE.InstancedMesh(broadCrownGeo, broadleafMat, broadCount);
    const shrubsIM = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubCount);
    const grassIM = new THREE.InstancedMesh(grassClusterGeo, grassTuftMat, grassCount);
    const polesIM = new THREE.InstancedMesh(poleGeo, guardrailMat, poleCount);
    const lampsIM = new THREE.InstancedMesh(lampHeadGeo, lampHeadMat, poleCount);

    // Pre-allocate instanceColor attributes so pooled chunks never allocate mid-drive
    pineCrownsIM.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(pineCount * 3),
      3,
    );
    broadCrownsIM.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(broadCount * 3),
      3,
    );
    shrubsIM.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(shrubCount * 3),
      3,
    );
    grassIM.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(grassCount * 3),
      3,
    );

    // Traffic & player vehicles cast/display crisp ground shadows; skip per-frame instanced trunk shadow pass
    // (20+ trees * 9 chunks would add 18+ extra instanced shadow draws on every moving shadow frame).

    chunkGroup.add(
      railsIM,
      postsIM,
      rocksIM,
      pineTrunksIM,
      pineCrownsIM,
      broadTrunksIM,
      broadCrownsIM,
      shrubsIM,
      grassIM,
      polesIM,
      lampsIM,
    );

    return {
      index: 0,
      group: chunkGroup,
      posArr,
      rightArr,
      roadVerts,
      roadUvs,
      roadGeo,
      curbVerts,
      curbGeo,
      tVerts,
      tColors,
      tUvs,
      terrainGeo,
      railsIM,
      postsIM,
      rocksIM,
      pineTrunksIM,
      pineCrownsIM,
      broadTrunksIM,
      broadCrownsIM,
      shrubsIM,
      grassIM,
      polesIM,
      lampsIM,
      signSlot: null,
      disposables,
    };
  };

  const populateChunk = (chunk: StreamedChunk, chunkIdx: number): void => {
    chunk.index = chunkIdx;
    if (chunk.signSlot) {
      chunk.group.remove(chunk.signSlot.group);
      signPool.push(chunk.signSlot);
      chunk.signSlot = null;
    }

    const rand = seededRand((level.id * 919 + chunkIdx * 9973) ^ 0x5bd1e995);
    const sStart = chunkIdx * CHUNK_LEN;
    ensureTunnelsUpTo(sStart + CHUNK_LEN + 240);
    const { posArr, rightArr, roadVerts, roadUvs, curbVerts, tVerts, tColors, tUvs } = chunk;

    // 1. Sample chunk spine rows once per chunk
    for (let i = 0; i < rows; i++) {
      const s = sStart + i * STEP_M;
      sampleAtDistance(s, _tmpSample);
      posArr[i * 3] = _tmpSample.position.x;
      posArr[i * 3 + 1] = _tmpSample.position.y;
      posArr[i * 3 + 2] = _tmpSample.position.z;
      rightArr[i * 3] = _tmpSample.right.x;
      rightArr[i * 3 + 1] = _tmpSample.right.y;
      rightArr[i * 3 + 2] = _tmpSample.right.z;
    }

    // 2. Road ribbon & shoulder curbs
    const shoulderOut = halfRoad + 0.95;
    for (let i = 0; i < rows; i++) {
      const px = posArr[i * 3];
      const py = posArr[i * 3 + 1] + 0.025;
      const pz = posArr[i * 3 + 2];
      const rx = rightArr[i * 3];
      const rz = rightArr[i * 3 + 2];

      const vL = i * 2;
      const vR = i * 2 + 1;
      roadVerts[vL * 3] = px - rx * halfRoad;
      roadVerts[vL * 3 + 1] = py;
      roadVerts[vL * 3 + 2] = pz - rz * halfRoad;
      roadVerts[vR * 3] = px + rx * halfRoad;
      roadVerts[vR * 3 + 1] = py;
      roadVerts[vR * 3 + 2] = pz + rz * halfRoad;

      const vCoord = (sStart + i * STEP_M) / 14.0;
      roadUvs[vL * 2] = 0;
      roadUvs[vL * 2 + 1] = vCoord;
      roadUvs[vR * 2] = 1;
      roadUvs[vR * 2 + 1] = vCoord;

      const curbBase = i * 4;
      const cCoords = [-shoulderOut, -halfRoad, halfRoad, shoulderOut];
      for (let k = 0; k < 4; k++) {
        curbVerts[(curbBase + k) * 3] = px + rx * cCoords[k];
        curbVerts[(curbBase + k) * 3 + 1] = py - (k === 0 || k === 3 ? 0.05 : 0.005);
        curbVerts[(curbBase + k) * 3 + 2] = pz + rz * cCoords[k];
      }
    }
    chunk.roadGeo.attributes.position.needsUpdate = true;
    chunk.roadGeo.attributes.uv.needsUpdate = true;
    chunk.roadGeo.computeVertexNormals();
    chunk.roadGeo.computeBoundingSphere();

    chunk.curbGeo.attributes.position.needsUpdate = true;
    chunk.curbGeo.computeVertexNormals();
    chunk.curbGeo.computeBoundingSphere();

    // 3. Lush Green Mountain Slope & Distant Rocky Ridge Terrain
    for (let r = 0; r < tRows; r++) {
      const i = terrainRowIndices[r];
      const sDist = sStart + i * STEP_M;
      const px = posArr[i * 3];
      const py = posArr[i * 3 + 1];
      const pz = posArr[i * 3 + 2];
      const rx = rightArr[i * 3];
      const rz = rightArr[i * 3 + 2];

      for (let c = 0; c < tCols; c++) {
        const lat = crossOffsets[c];
        const hillH = getMountainHeight(sDist, lat);
        const hillHNext = getMountainHeight(sDist, lat + Math.sign(lat || 1) * 4);
        const slopeSteep = Math.abs(hillHNext - hillH) / 4;

        const vIdx = r * tCols + c;
        tVerts[vIdx * 3] = px + rx * lat;
        tVerts[vIdx * 3 + 1] = py + hillH;
        tVerts[vIdx * 3 + 2] = pz + rz * lat;

        tUvs[vIdx * 2] = (lat + 440) / 14;
        tUvs[vIdx * 2 + 1] = sDist / 14;

        // Subtle organic meadow variation (prevents uniform flat green or muddy brown)
        const patchVar = 0.5 + 0.5 * Math.sin(sDist * 0.038 + lat * 0.11 + phaseA);
        const absLat = Math.abs(lat);
        const nearPortalWall = !!getTunnelAt(sDist, 24) && absLat >= 11.4 && absLat <= 22;

        if (nearPortalWall || slopeSteep > 0.58 || (hillH > 54 && slopeSteep > 0.36)) {
          // Natural rocky granite cliffs & mountain rock around tunnel cuts & high ridges
          const rockShade = 0.48 + patchVar * 0.14;
          tColors[vIdx * 3] = rockShade;
          tColors[vIdx * 3 + 1] = rockShade + 0.04;
          tColors[vIdx * 3 + 2] = rockShade + 0.03;
        } else if (absLat < halfRoad + 18) {
          // Fresh natural green roadside grass verges & embankments
          tColors[vIdx * 3] = 0.56 + patchVar * 0.12;
          tColors[vIdx * 3 + 1] = 0.88 + patchVar * 0.12;
          tColors[vIdx * 3 + 2] = 0.48 + patchVar * 0.08;
        } else {
          // Natural alpine grassy mountain slopes & distant layered hills
          const depthCool = Math.min(0.14, Math.max(0, (absLat - 120) / 1600));
          const altGreen = 0.84 + Math.min(0.2, Math.max(0, hillH) / 110);
          tColors[vIdx * 3] = (0.52 + patchVar * 0.12) * altGreen;
          tColors[vIdx * 3 + 1] = (0.82 + patchVar * 0.14) * altGreen;
          tColors[vIdx * 3 + 2] = (0.45 + patchVar * 0.1) * altGreen + depthCool;
        }
      }
    }
    chunk.terrainGeo.attributes.position.needsUpdate = true;
    chunk.terrainGeo.attributes.color.needsUpdate = true;
    chunk.terrainGeo.attributes.uv.needsUpdate = true;
    chunk.terrainGeo.computeVertexNormals();
    chunk.terrainGeo.computeBoundingSphere();

    // 4. Steel Roadside Guardrails & Posts (suppressed inside tunnel bore where tunnel curbs take over)
    let rIdx = 0;
    for (let i = 0; i < rows - 1; i++) {
      const segMidS = sStart + (i + 0.5) * STEP_M;
      const inTunnelInterior = !!getTunnelAt(segMidS, -2.5);

      const px0 = posArr[i * 3];
      const py0 = posArr[i * 3 + 1];
      const pz0 = posArr[i * 3 + 2];
      const rx0 = rightArr[i * 3];
      const rz0 = rightArr[i * 3 + 2];

      const px1 = posArr[(i + 1) * 3];
      const py1 = posArr[(i + 1) * 3 + 1];
      const pz1 = posArr[(i + 1) * 3 + 2];
      const rx1 = rightArr[(i + 1) * 3];
      const rz1 = rightArr[(i + 1) * 3 + 2];

      for (const side of [-1, 1]) {
        if (inTunnelInterior) {
          _dummy.position.set(px0, py0 - 50, pz0);
          _dummy.scale.set(0, 0, 0);
          _dummy.updateMatrix();
          chunk.railsIM.setMatrixAt(rIdx, _dummy.matrix);
          chunk.postsIM.setMatrixAt(rIdx, _dummy.matrix);
          rIdx++;
          continue;
        }

        const lat = side * (halfRoad + 0.68);
        const ax = px0 + rx0 * lat;
        const az = pz0 + rz0 * lat;
        const bx = px1 + rx1 * lat;
        const bz = pz1 + rz1 * lat;

        const chordDx = bx - ax;
        const chordDy = py1 - py0;
        const chordDz = bz - az;
        const chordLen = Math.hypot(chordDx, chordDy, chordDz);

        _railSegDir.set(-chordDx, -chordDy, -chordDz).normalize();
        _railRight.crossVectors(_worldUp, _railSegDir).normalize();
        _railUp.crossVectors(_railSegDir, _railRight).normalize();
        _rotMat.makeBasis(_railRight, _railUp, _railSegDir);

        _dummy.quaternion.setFromRotationMatrix(_rotMat);
        _dummy.position.set((ax + bx) * 0.5, (py0 + py1) * 0.5, (az + bz) * 0.5);
        _dummy.scale.set(1, 1, chordLen + 0.08);
        _dummy.updateMatrix();
        chunk.railsIM.setMatrixAt(rIdx, _dummy.matrix);

        _dummy.scale.set(1, 1, 1);
        _dummy.position.set(ax, py0, az);
        _dummy.updateMatrix();
        chunk.postsIM.setMatrixAt(rIdx, _dummy.matrix);
        rIdx++;
      }
    }
    chunk.railsIM.instanceMatrix.needsUpdate = true;
    chunk.postsIM.instanceMatrix.needsUpdate = true;
    chunk.railsIM.computeBoundingSphere();
    chunk.postsIM.computeBoundingSphere();

    // Fast interpolated spine lookup using already-sampled chunk posArr/rightArr (zero heap allocations!)
    const _spot = { x: 0, y: 0, z: 0 };
    const evalSpineFast = (localS: number, lat: number, yDrop: number) => {
      const t = THREE.MathUtils.clamp(localS / CHUNK_LEN, 0, 1);
      const rowF = t * (rows - 1);
      const r0 = Math.min(rows - 2, Math.floor(rowF));
      const frac = rowF - r0;
      const b0 = r0 * 3;
      const b1 = (r0 + 1) * 3;
      const px = posArr[b0] + (posArr[b1] - posArr[b0]) * frac;
      const py = posArr[b0 + 1] + (posArr[b1 + 1] - posArr[b0 + 1]) * frac;
      const pz = posArr[b0 + 2] + (posArr[b1 + 2] - posArr[b0 + 2]) * frac;
      const rx = rightArr[b0] + (rightArr[b1] - rightArr[b0]) * frac;
      const rz = rightArr[b0 + 2] + (rightArr[b1 + 2] - rightArr[b0 + 2]) * frac;
      const sDist = sStart + localS;
      const hLift = getMountainHeight(sDist, lat);
      _spot.x = px + rx * lat;
      _spot.y = py + hLift - yDrop;
      _spot.z = pz + rz * lat;
      return _spot;
    };

    const sampleSlopeSpot = (minEdgeOffset: number, maxLat: number) => {
      const localS = rand() * CHUNK_LEN;
      const sDist = sStart + localS;
      const side = rand() > 0.5 ? 1 : -1;
      // Push trees/bushes/rocks outside tunnel portal & wall footprint when near a tunnel
      const nearTunnel = !!getTunnelAt(sDist, 14);
      const minLat = Math.max(halfRoad + minEdgeOffset, nearTunnel ? 15.2 : 0);
      const lat =
        side * (minLat + Math.pow(rand(), 1.32) * Math.max(2, maxLat - minLat));
      return evalSpineFast(localS, lat, 0.14);
    };

    // 5. Mountain Rocks
    for (let i = 0; i < rockCount; i++) {
      const p = sampleSlopeSpot(2.2, 72);
      const sc = 0.72 + rand() * 1.9;
      _dummy.position.set(p.x, p.y + 0.22, p.z);
      _dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      _dummy.scale.set(sc * 1.35, sc * 0.85, sc * 1.15);
      _dummy.updateMatrix();
      chunk.rocksIM.setMatrixAt(i, _dummy.matrix);
    }

    // 6. Clustered Dense Mountain Groves & Varied Conifers + Broadleaf Trees
    const grove0S = 18 + rand() * 32;
    const grove0Side = rand() > 0.5 ? 1 : -1;
    const grove0LatOff = halfRoad + 6.5 + rand() * 24;
    const grove1S = 64 + rand() * 40;
    const grove1Side = rand() > 0.5 ? 1 : -1;
    const grove1LatOff = halfRoad + 7.5 + rand() * 32;

    for (let i = 0; i < pineCount; i++) {
      let p = _spot;
      if (i % 3 === 0) {
        const use0 = i % 2 === 0;
        const gs = use0 ? grove0S : grove1S;
        const gside = use0 ? grove0Side : grove1Side;
        const glat = use0 ? grove0LatOff : grove1LatOff;
        const localS = THREE.MathUtils.clamp(gs + (rand() - 0.5) * 18, 1, CHUNK_LEN - 1);
        const minTunnelLat = getTunnelAt(sStart + localS, 14) ? 15.5 : halfRoad + 4.8;
        const lat = gside * Math.max(minTunnelLat, glat + (rand() - 0.5) * 16);
        p = evalSpineFast(localS, lat, 0.16);
      } else {
        p = sampleSlopeSpot(4.8, 130);
      }
      const scW = 0.85 + rand() * 0.75;
      const scH = 0.85 + rand() * 1.05;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
      _dummy.scale.set(scW, scH, scW * (0.9 + rand() * 0.2));
      _dummy.updateMatrix();
      chunk.pineTrunksIM.setMatrixAt(i, _dummy.matrix);
      chunk.pineCrownsIM.setMatrixAt(i, _dummy.matrix);

      _tint.setHSL(0.30 + (rand() - 0.5) * 0.05, 0.24 + rand() * 0.14, 0.72 + rand() * 0.26);
      chunk.pineCrownsIM.setColorAt(i, _tint);
    }

    for (let i = 0; i < broadCount; i++) {
      let p = _spot;
      if (i % 2 === 0) {
        const use0 = (i + 1) % 2 === 0;
        const gs = use0 ? grove0S : grove1S;
        const gside = use0 ? grove0Side : grove1Side;
        const glat = use0 ? grove0LatOff : grove1LatOff;
        const localS = THREE.MathUtils.clamp(gs + (rand() - 0.5) * 20, 1, CHUNK_LEN - 1);
        const minTunnelLat = getTunnelAt(sStart + localS, 14) ? 15.5 : halfRoad + 4.8;
        const lat = -gside * Math.max(minTunnelLat, glat + (rand() - 0.5) * 14);
        p = evalSpineFast(localS, lat, 0.16);
      } else {
        p = sampleSlopeSpot(4.8, 86);
      }
      const scW = 0.8 + rand() * 0.72;
      const scH = 0.82 + rand() * 0.88;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
      _dummy.scale.set(scW, scH, scW * (0.88 + rand() * 0.24));
      _dummy.updateMatrix();
      chunk.broadTrunksIM.setMatrixAt(i, _dummy.matrix);
      chunk.broadCrownsIM.setMatrixAt(i, _dummy.matrix);

      _tint.setHSL(0.27 + (rand() - 0.5) * 0.06, 0.26 + rand() * 0.14, 0.74 + rand() * 0.25);
      chunk.broadCrownsIM.setColorAt(i, _tint);
    }

    // 7. Roadside Bushes & Lush Grass Blade Tufts
    for (let i = 0; i < shrubCount; i++) {
      const p = sampleSlopeSpot(1.85, 38);
      const sc = 0.72 + rand() * 0.88;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      _dummy.scale.set(sc * (0.9 + rand() * 0.25), sc * (0.85 + rand() * 0.35), sc);
      _dummy.updateMatrix();
      chunk.shrubsIM.setMatrixAt(i, _dummy.matrix);

      _tint.setHSL(0.28 + (rand() - 0.5) * 0.05, 0.28 + rand() * 0.14, 0.76 + rand() * 0.22);
      chunk.shrubsIM.setColorAt(i, _tint);
    }

    for (let i = 0; i < grassCount; i++) {
      const localS = rand() * CHUNK_LEN;
      const side = i % 2 === 0 ? -1 : 1;
      const minGrassLat = getTunnelAt(sStart + localS, 12) ? 14.2 : halfRoad + 1.38;
      const lat = side * (minGrassLat + Math.pow(rand(), 1.55) * 22);
      const p = evalSpineFast(localS, lat, 0.08);
      const sc = 0.78 + rand() * 0.75;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      _dummy.scale.set(sc * (0.95 + rand() * 0.25), sc * (0.8 + rand() * 0.45), sc);
      _dummy.updateMatrix();
      chunk.grassIM.setMatrixAt(i, _dummy.matrix);

      _tint.setHSL(0.26 + (rand() - 0.5) * 0.05, 0.3 + rand() * 0.12, 0.78 + rand() * 0.2);
      chunk.grassIM.setColorAt(i, _tint);
    }

    for (const im of [
      chunk.rocksIM,
      chunk.pineTrunksIM,
      chunk.pineCrownsIM,
      chunk.broadTrunksIM,
      chunk.broadCrownsIM,
      chunk.shrubsIM,
      chunk.grassIM,
    ]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }

    // 8. Highway Streetlights (suppressed inside & immediately around tunnels)
    for (let p = 0; p < poleCount; p++) {
      const dist = sStart + 25 + p * 60;
      if (getTunnelAt(dist, 12)) {
        _dummy.position.set(0, -100, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        chunk.polesIM.setMatrixAt(p, _dummy.matrix);
        chunk.lampsIM.setMatrixAt(p, _dummy.matrix);
        continue;
      }

      sampleAtDistance(dist, _tmpSample);
      const side = (chunkIdx + p) % 2 === 0 ? -1 : 1;
      const lat = side * (halfRoad + 1.15);

      _negForward.copy(_tmpSample.forward).negate();
      _rotMat.makeBasis(_tmpSample.right, _worldUp, _negForward);
      _dummy.quaternion.setFromRotationMatrix(_rotMat);
      _dummy.scale.setScalar(1);
      _dummy.position.set(
        _tmpSample.position.x + _tmpSample.right.x * lat,
        _tmpSample.position.y,
        _tmpSample.position.z + _tmpSample.right.z * lat,
      );
      _dummy.updateMatrix();
      chunk.polesIM.setMatrixAt(p, _dummy.matrix);

      _dummy.position.set(
        _tmpSample.position.x + _tmpSample.right.x * (lat - side * 0.65),
        _tmpSample.position.y + 7.15,
        _tmpSample.position.z + _tmpSample.right.z * (lat - side * 0.65),
      );
      _dummy.updateMatrix();
      chunk.lampsIM.setMatrixAt(p, _dummy.matrix);
    }
    chunk.polesIM.instanceMatrix.needsUpdate = true;
    chunk.lampsIM.instanceMatrix.needsUpdate = true;
    chunk.polesIM.computeBoundingSphere();
    chunk.lampsIM.computeBoundingSphere();

    // 9. Reusable Mountain Highway Signboards at Start (Chunk 0) & Every 1 km Milestone
    if (chunkIdx === 0) {
      sampleAtDistance(28, _tmpSample);
      const slot = acquireSignSlot(
        level.highwayCode,
        level.name.toUpperCase().slice(0, 22),
        'ENDLESS MOUNTAIN HIGHWAY · DRIVE FREE',
      );
      const lat = -(halfRoad + 2.4);
      slot.group.position.set(
        _tmpSample.position.x + _tmpSample.right.x * lat,
        _tmpSample.position.y,
        _tmpSample.position.z + _tmpSample.right.z * lat,
      );
      _negForward.copy(_tmpSample.forward).negate();
      _rotMat.makeBasis(_tmpSample.right, _worldUp, _negForward);
      slot.group.quaternion.setFromRotationMatrix(_rotMat);
      chunk.signSlot = slot;
      chunk.group.add(slot.group);
    } else if (chunkIdx > 0) {
      const kmStart = Math.ceil(sStart / 1000);
      const kmDist = kmStart * 1000;
      if (kmDist > 0 && kmDist >= sStart && kmDist < sStart + CHUNK_LEN) {
        sampleAtDistance(kmDist, _tmpSample);
        const slot = acquireSignSlot(
          level.highwayCode,
          `${kmStart} KM MILESTONE`,
          'HIGHWAY TRAFFIC AHEAD · STAY SHARP',
        );
        const lat = -(halfRoad + 2.4);
        slot.group.position.set(
          _tmpSample.position.x + _tmpSample.right.x * lat,
          _tmpSample.position.y,
          _tmpSample.position.z + _tmpSample.right.z * lat,
        );
        _negForward.copy(_tmpSample.forward).negate();
        _rotMat.makeBasis(_tmpSample.right, _worldUp, _negForward);
        slot.group.quaternion.setFromRotationMatrix(_rotMat);
        chunk.signSlot = slot;
        chunk.group.add(slot.group);
      }
    }
  };

  // 4b. Pooled Instanced 3D GLB Tunnel Assemblies + Overhead Mountain Ridge Saddle Caps
  const MAX_HALF_STRAIGHTS = (MAX_TUNNEL_SEGMENTS - 2) * 2;
  const MAX_TUNNEL_LAMPS = 4 + MAX_HALF_STRAIGHTS * 2;
  const MAX_TUNNEL_VENTS = 6;

  interface PooledTunnelSlot {
    style: TunnelStyle;
    assignedTunnelId: number | null;
    group: THREE.Group;
    entrySeg: THREE.Group;
    exitSeg: THREE.Group;
    straightShellIMs: THREE.InstancedMesh[];
    lightIMs: THREE.InstancedMesh[];
    ventIMs: THREE.InstancedMesh[];
    ridgeGeo: THREE.BufferGeometry;
    ridgeVerts: Float32Array;
    ridgeColors: Float32Array;
    ridgeUvs: Float32Array;
    ridgeMesh: THREE.Mesh;
  }

  const RIDGE_ROWS = MAX_TUNNEL_SEGMENTS * 2 + 1;
  const RIDGE_LATS = [-24, -17.5, -13.2, -11.2, -9.2, -5.4, 0, 5.4, 9.2, 11.2, 13.2, 17.5, 24];
  const RIDGE_BASE_Y = [1.2, 6.2, 10.2, 12.2, 13.4, 15.2, 17.4, 15.2, 13.4, 12.2, 10.2, 6.2, 1.2];
  const RIDGE_COLS = RIDGE_LATS.length;
  const ridgeIdxArr: number[] = [];
  for (let r = 0; r < RIDGE_ROWS - 1; r++) {
    for (let c = 0; c < RIDGE_COLS - 1; c++) {
      const a = r * RIDGE_COLS + c;
      const b = a + 1;
      const d = (r + 1) * RIDGE_COLS + c;
      const e = d + 1;
      ridgeIdxArr.push(a, b, d, b, e, d);
    }
  }
  const sharedRidgeIndex = new THREE.Uint16BufferAttribute(ridgeIdxArr, 1);

  let tunnelTemplates: TunnelKitTemplates | null = null;
  const tunnelSlotsByStyle = new Map<TunnelStyle, PooledTunnelSlot>();
  const _tStartPos = new THREE.Vector3();
  const _tEndPos = new THREE.Vector3();
  const _tDir = new THREE.Vector3();
  const _tRight = new THREE.Vector3();
  const _tUp = new THREE.Vector3();
  const _tNegDir = new THREE.Vector3();
  const _tRotMat = new THREE.Matrix4();
  const _tSegPos = new THREE.Vector3();
  const _tSegQuat = new THREE.Quaternion();
  const _tSegScale = new THREE.Vector3();
  const _tSegMat = new THREE.Matrix4();
  const _tFixSegMat = new THREE.Matrix4();
  const _tLampLocalMat = new THREE.Matrix4();
  const _tLampWorldMat = new THREE.Matrix4();
  const _tLampDummy = new THREE.Object3D();
  const _tSample: TrackSample = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    surface: 'asphalt',
    mudIntensity: 0,
    slope: 0,
    bankAngle: 0,
    minLat: -halfRoad,
    maxLat: halfRoad,
  };

  const buildPortalGroup = (
    templates: TunnelKitTemplates,
    style: TunnelStyle,
    role: 'entry' | 'exit',
  ): THREE.Group => {
    const seg = new THREE.Group();
    const archWrap = new THREE.Group();
    const archClone = templates.styles[style].entrance.clone(true);
    if (role === 'entry') {
      archClone.rotation.y = Math.PI;
      archClone.position.z = -14.0;
    } else {
      archClone.position.z = 14.0;
    }
    archWrap.add(archClone);
    seg.add(archWrap);
    return seg;
  };

  const createTunnelSlotForStyle = (
    templates: TunnelKitTemplates,
    style: TunnelStyle,
  ): PooledTunnelSlot => {
    const slotGroup = new THREE.Group();
    const entrySeg = buildPortalGroup(templates, style, 'entry');
    const exitSeg = buildPortalGroup(templates, style, 'exit');
    slotGroup.add(entrySeg, exitSeg);

    const straightShellIMs: THREE.InstancedMesh[] = [];
    for (const b of templates.styles[style].straightBuckets) {
      if (!b.visible) continue;
      const im = new THREE.InstancedMesh(b.geometry, b.material, MAX_HALF_STRAIGHTS);
      im.castShadow = false;
      im.receiveShadow = true;
      im.renderOrder = b.renderOrder;
      slotGroup.add(im);
      straightShellIMs.push(im);
    }

    const lightIMs: THREE.InstancedMesh[] = [];
    for (const b of templates.lightBuckets) {
      if (!b.visible) continue;
      const im = new THREE.InstancedMesh(b.geometry, b.material, MAX_TUNNEL_LAMPS);
      im.castShadow = false;
      im.receiveShadow = false;
      im.renderOrder = b.renderOrder;
      slotGroup.add(im);
      lightIMs.push(im);
    }

    const ventIMs: THREE.InstancedMesh[] = [];
    for (const b of templates.ventBuckets) {
      if (!b.visible) continue;
      const im = new THREE.InstancedMesh(b.geometry, b.material, MAX_TUNNEL_VENTS);
      im.castShadow = false;
      im.receiveShadow = true;
      im.renderOrder = b.renderOrder;
      slotGroup.add(im);
      ventIMs.push(im);
    }

    const ridgeVerts = new Float32Array(RIDGE_ROWS * RIDGE_COLS * 3);
    const ridgeColors = new Float32Array(RIDGE_ROWS * RIDGE_COLS * 3);
    const ridgeUvs = new Float32Array(RIDGE_ROWS * RIDGE_COLS * 2);
    const ridgeGeo = new THREE.BufferGeometry();
    ridgeGeo.setAttribute('position', new THREE.BufferAttribute(ridgeVerts, 3));
    ridgeGeo.setAttribute('color', new THREE.BufferAttribute(ridgeColors, 3));
    ridgeGeo.setAttribute('uv', new THREE.BufferAttribute(ridgeUvs, 2));
    ridgeGeo.setIndex(sharedRidgeIndex);
    globalDisposables.push(ridgeGeo);

    const ridgeMesh = new THREE.Mesh(ridgeGeo, terrainMat);
    ridgeMesh.receiveShadow = true;
    slotGroup.add(ridgeMesh);

    return {
      style,
      assignedTunnelId: null,
      group: slotGroup,
      entrySeg,
      exitSeg,
      straightShellIMs,
      lightIMs,
      ventIMs,
      ridgeGeo,
      ridgeVerts,
      ridgeColors,
      ridgeUvs,
      ridgeMesh,
    };
  };

  const computeChordFrame = (
    s0: number,
    s1: number,
    roadWidthScaleX: number,
    zOverlapM: number,
  ): void => {
    evalSpinePos(s0, _tStartPos);
    evalSpinePos(s1, _tEndPos);

    const dx = _tEndPos.x - _tStartPos.x;
    const dy = _tEndPos.y - _tStartPos.y;
    const dz = _tEndPos.z - _tStartPos.z;
    const chordLen = Math.hypot(dx, dy, dz);

    _tDir.set(dx, dy, dz).normalize();
    _tRight.crossVectors(_tDir, _worldUp).normalize();
    _tUp.crossVectors(_tRight, _tDir).normalize();
    _tNegDir.copy(_tDir).negate();
    _tRotMat.makeBasis(_tRight, _tUp, _tNegDir);

    _tSegQuat.setFromRotationMatrix(_tRotMat);
    _tSegPos.set(
      (_tStartPos.x + _tEndPos.x) * 0.5,
      (_tStartPos.y + _tEndPos.y) * 0.5 - 0.02,
      (_tStartPos.z + _tEndPos.z) * 0.5,
    );
    _tSegScale.set(
      roadWidthScaleX,
      1.0,
      (chordLen + zOverlapM) / TUNNEL_SEGMENT_LEN,
    );
    _tSegMat.compose(_tSegPos, _tSegQuat, _tSegScale);

    _tSegScale.set(roadWidthScaleX, 1.0, 1.0);
    _tFixSegMat.compose(_tSegPos, _tSegQuat, _tSegScale);
  };

  const setLampAnchor = (tSpan: TunnelSpan, anchorIdx: number): void => {
    let anchor = tSpan.lampAnchors[anchorIdx];
    if (!anchor) {
      anchor = new THREE.Vector3();
      tSpan.lampAnchors[anchorIdx] = anchor;
    }
    anchor.set(
      _tSegPos.x + _tUp.x * 9.1,
      _tSegPos.y + _tUp.y * 9.1,
      _tSegPos.z + _tUp.z * 9.1,
    );
  };

  const appendCeilingLampsForChord = (
    slot: PooledTunnelSlot,
    lampCursorRef: { idx: number },
    zOffset: number,
  ): void => {
    for (const side of [-1, 1]) {
      _tLampDummy.position.set(side * 3.65, 10.56, zOffset);
      _tLampDummy.rotation.set(0, 0, -side * 0.19);
      _tLampDummy.scale.set(1, 1, 1);
      _tLampDummy.updateMatrix();
      _tLampLocalMat.copy(_tLampDummy.matrix);
      _tLampWorldMat.multiplyMatrices(_tFixSegMat, _tLampLocalMat);
      for (const im of slot.lightIMs) {
        im.setMatrixAt(lampCursorRef.idx, _tLampWorldMat);
      }
      lampCursorRef.idx++;
    }
  };

  const assignTunnelToSlot = (slot: PooledTunnelSlot, tSpan: TunnelSpan): void => {
    slot.assignedTunnelId = tSpan.id;
    const roadScaleX = Math.max(0.92, level.roadWidth / TUNNEL_BASE_ROAD_WIDTH);
    const segCount = Math.min(MAX_TUNNEL_SEGMENTS, tSpan.segmentCount);
    const straightCount = Math.max(1, segCount - 2);
    const halfCount = straightCount * 2;
    let anchorCursor = 0;
    const lampCursor = { idx: 0 };
    let ventCursor = 0;

    // 1. Entry portal
    computeChordFrame(
      tSpan.startS,
      tSpan.startS + TUNNEL_SEGMENT_LEN,
      roadScaleX,
      0.48,
    );
    slot.entrySeg.position.copy(_tSegPos);
    slot.entrySeg.quaternion.copy(_tSegQuat);
    _tSegMat.decompose(_tLampDummy.position, _tLampDummy.quaternion, slot.entrySeg.scale);
    slot.entrySeg.visible = true;
    setLampAnchor(tSpan, anchorCursor++);
    appendCeilingLampsForChord(slot, lampCursor, -1.5);

    // 2. Smooth 7m curved interior sub-segments (watertight 0.34m overlap + instanced lamps/vents)
    for (let i = 0; i < MAX_HALF_STRAIGHTS; i++) {
      if (i < halfCount) {
        const segS0 = tSpan.startS + TUNNEL_SEGMENT_LEN + i * TUNNEL_SUBSEG_LEN;
        const segS1 = segS0 + TUNNEL_SUBSEG_LEN;
        computeChordFrame(segS0, segS1, roadScaleX, 0.34);

        for (const im of slot.straightShellIMs) {
          im.setMatrixAt(i, _tSegMat);
        }
        appendCeilingLampsForChord(slot, lampCursor, 0);

        if (i % 4 === 2 && ventCursor < MAX_TUNNEL_VENTS) {
          for (const im of slot.ventIMs) {
            im.setMatrixAt(ventCursor, _tFixSegMat);
          }
          ventCursor++;
        }

        if (i % 2 === 0) {
          setLampAnchor(tSpan, anchorCursor++);
        }
      } else {
        // Hide unused instances cleanly at entry position with 0 scale so bounding sphere stays tight
        _tLampDummy.position.copy(slot.entrySeg.position);
        _tLampDummy.rotation.set(0, 0, 0);
        _tLampDummy.scale.set(0, 0, 0);
        _tLampDummy.updateMatrix();
        for (const im of slot.straightShellIMs) {
          im.setMatrixAt(i, _tLampDummy.matrix);
        }
      }
    }

    // 3. Exit portal
    const exitS0 = tSpan.startS + (straightCount + 1) * TUNNEL_SEGMENT_LEN;
    computeChordFrame(exitS0, exitS0 + TUNNEL_SEGMENT_LEN, roadScaleX, 0.48);
    slot.exitSeg.position.copy(_tSegPos);
    slot.exitSeg.quaternion.copy(_tSegQuat);
    _tSegMat.decompose(_tLampDummy.position, _tLampDummy.quaternion, slot.exitSeg.scale);
    slot.exitSeg.visible = true;
    setLampAnchor(tSpan, anchorCursor++);
    appendCeilingLampsForChord(slot, lampCursor, 1.5);
    tSpan.lampAnchors.length = anchorCursor;

    // Zero out unused lamp/vent instances
    _tLampDummy.position.copy(slot.entrySeg.position);
    _tLampDummy.rotation.set(0, 0, 0);
    _tLampDummy.scale.set(0, 0, 0);
    _tLampDummy.updateMatrix();
    for (let li = lampCursor.idx; li < MAX_TUNNEL_LAMPS; li++) {
      for (const im of slot.lightIMs) {
        im.setMatrixAt(li, _tLampDummy.matrix);
      }
    }
    for (let vi = ventCursor; vi < MAX_TUNNEL_VENTS; vi++) {
      for (const im of slot.ventIMs) {
        im.setMatrixAt(vi, _tLampDummy.matrix);
      }
    }

    for (const im of slot.straightShellIMs) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    for (const im of slot.lightIMs) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    for (const im of slot.ventIMs) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }

    // 4. Mountain Ridge Saddle Cap arching over tunnel roof (embeds portal cleanly into mountain)
    const capStartS = tSpan.startS + 4.2;
    const capEndS = tSpan.endS - 4.2;
    const capLen = Math.max(20, capEndS - capStartS);
    const { ridgeVerts, ridgeColors, ridgeUvs } = slot;

    for (let r = 0; r < RIDGE_ROWS; r++) {
      const rowT = r / (RIDGE_ROWS - 1);
      const sDist = capStartS + rowT * capLen;
      sampleAtDistance(sDist, _tSample);

      const portalTaper = Math.min(
        smoothstep01(capStartS, capStartS + 16, sDist),
        1 - smoothstep01(capEndS - 16, capEndS, sDist),
      );
      const ridgeCrest = 0.65 + 0.35 * Math.sin(sDist * 0.045 + phaseB);

      for (let c = 0; c < RIDGE_COLS; c++) {
        const lat = RIDGE_LATS[c];
        const absLat = Math.abs(lat);
        const baseY = RIDGE_BASE_Y[c];
        const hillAdd =
          c >= 2 && c <= RIDGE_COLS - 3
            ? (2.2 + ridgeCrest * 3.8) * portalTaper * (1 - absLat / 24)
            : 0;
        const vIdx = r * RIDGE_COLS + c;
        ridgeVerts[vIdx * 3] = _tSample.position.x + _tSample.right.x * lat;
        ridgeVerts[vIdx * 3 + 1] = _tSample.position.y + baseY + hillAdd;
        ridgeVerts[vIdx * 3 + 2] = _tSample.position.z + _tSample.right.z * lat;

        ridgeUvs[vIdx * 2] = (lat + 24) / 14;
        ridgeUvs[vIdx * 2 + 1] = sDist / 14;

        const patchVar = 0.5 + 0.5 * Math.sin(sDist * 0.05 + lat * 0.25 + phaseA);
        if (absLat >= 10.6 && absLat <= 18.0) {
          // Natural rocky cliff shoulder flanking tunnel portal ridge
          const rShade = 0.5 + patchVar * 0.14;
          ridgeColors[vIdx * 3] = rShade;
          ridgeColors[vIdx * 3 + 1] = rShade + 0.05;
          ridgeColors[vIdx * 3 + 2] = rShade + 0.02;
        } else {
          // Lush grassy green mountain ridge crest above tunnel
          ridgeColors[vIdx * 3] = 0.54 + patchVar * 0.12;
          ridgeColors[vIdx * 3 + 1] = 0.84 + patchVar * 0.14;
          ridgeColors[vIdx * 3 + 2] = 0.46 + patchVar * 0.09;
        }
      }
    }
    slot.ridgeGeo.attributes.position.needsUpdate = true;
    slot.ridgeGeo.attributes.color.needsUpdate = true;
    slot.ridgeGeo.attributes.uv.needsUpdate = true;
    slot.ridgeGeo.computeVertexNormals();
    slot.ridgeGeo.computeBoundingSphere();

    if (!slot.group.parent) {
      group.add(slot.group);
    }
  };

  let lastWindowPlayerS = 0;
  const _visibleTunnelsScratch: TunnelSpan[] = [];
  const _activeTunnelIdsScratch = new Set<number>();

  const syncVisibleTunnels = (playerDistM: number): void => {
    lastWindowPlayerS = playerDistM;
    if (!tunnelTemplates || worldDisposed) return;

    const minVisS = playerDistM - CHUNKS_BEHIND * CHUNK_LEN - 40;
    const maxVisS = playerDistM + CHUNKS_AHEAD * CHUNK_LEN + 60;
    ensureTunnelsUpTo(maxVisS + 200);

    _visibleTunnelsScratch.length = 0;
    _activeTunnelIdsScratch.clear();
    const firstIdx = findFirstTunnelByEndS(minVisS);
    for (let i = firstIdx; i < tunnels.length; i++) {
      const t = tunnels[i];
      if (t.startS > maxVisS) break;
      if (t.endS >= minVisS) {
        _visibleTunnelsScratch.push(t);
        _activeTunnelIdsScratch.add(t.id);
      }
    }

    for (const slot of tunnelSlotsByStyle.values()) {
      if (slot.assignedTunnelId !== null && !_activeTunnelIdsScratch.has(slot.assignedTunnelId)) {
        slot.assignedTunnelId = null;
        if (slot.group.parent) {
          group.remove(slot.group);
        }
      }
    }

    for (let i = 0; i < _visibleTunnelsScratch.length; i++) {
      const tSpan = _visibleTunnelsScratch[i];
      let slot = tunnelSlotsByStyle.get(tSpan.style);
      if (!slot) {
        slot = createTunnelSlotForStyle(tunnelTemplates, tSpan.style);
        tunnelSlotsByStyle.set(tSpan.style, slot);
      }
      if (slot.assignedTunnelId !== tSpan.id) {
        assignTunnelToSlot(slot, tSpan);
      }
    }
  };

  getTunnelKitTemplates()
    .then((templates) => {
      if (worldDisposed) return;
      tunnelTemplates = templates;
      // Pre-warm all 3 tunnel style slots immediately so no lazy slot building ever runs mid-drive
      const prewarmGroups: THREE.Group[] = [];
      for (const st of tunnelStyles) {
        if (!tunnelSlotsByStyle.has(st)) {
          const slot = createTunnelSlotForStyle(templates, st);
          tunnelSlotsByStyle.set(st, slot);
          prewarmGroups.push(slot.group);
        }
      }
      onTunnelTemplatesReady?.(prewarmGroups);
      syncVisibleTunnels(lastWindowPlayerS);
    })
    .catch((err) => {
      if (worldDisposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      onTunnelError?.(msg);
    });

  const getTunnelLightingState = (
    raceDistM: number,
    out: TunnelLightingState,
  ): void => {
    out.insideFactor = getTunnelFactorAt(raceDistM);
    let nearTunnel: TunnelSpan | null = null;
    const firstIdx = findFirstTunnelByEndS(raceDistM - 90);
    for (let i = firstIdx; i < tunnels.length; i++) {
      const t = tunnels[i];
      if (raceDistM >= t.startS - 210 && raceDistM <= t.endS + 90) {
        nearTunnel = t;
        break;
      }
      if (t.startS - 210 > raceDistM) break;
    }

    if (!nearTunnel || nearTunnel.lampAnchors.length === 0) {
      out.approachFactor = 0;
      out.activeLampCount = 0;
      return;
    }

    let app = 1;
    if (raceDistM < nearTunnel.startS - 18) {
      app = smoothstep01(nearTunnel.startS - 210, nearTunnel.startS - 18, raceDistM);
    } else if (raceDistM > nearTunnel.endS - 10) {
      app = 1 - smoothstep01(nearTunnel.endS - 10, nearTunnel.endS + 80, raceDistM);
    }
    out.approachFactor = app;

    const anchors = nearTunnel.lampAnchors;
    const count = Math.min(4, anchors.length);
    const relIdx = Math.round((raceDistM + 14 - nearTunnel.startS) / TUNNEL_SEGMENT_LEN);
    const startIdx = THREE.MathUtils.clamp(
      relIdx - 1,
      0,
      Math.max(0, anchors.length - count),
    );
    out.activeLampCount = count;
    for (let k = 0; k < count; k++) {
      out.lampPositions[k].copy(anchors[startIdx + k]);
    }
  };

  let lastCenterChunk = Number.NaN;

  const updateAtDistance = (playerDistM: number): void => {
    lastWindowPlayerS = playerDistM;
    const centerChunk = Math.floor(playerDistM / CHUNK_LEN);
    if (centerChunk === lastCenterChunk) return;
    lastCenterChunk = centerChunk;

    const minC = centerChunk - CHUNKS_BEHIND;
    const maxC = centerChunk + CHUNKS_AHEAD;

    // Recycle chunks falling outside sliding window back into the pool (zero GPU allocations!)
    for (const [idx, chunk] of chunks.entries()) {
      if (idx < minC || idx > maxC) {
        group.remove(chunk.group);
        if (chunk.signSlot) {
          chunk.group.remove(chunk.signSlot.group);
          signPool.push(chunk.signSlot);
          chunk.signSlot = null;
        }
        chunks.delete(idx);
        chunkPool.push(chunk);
      }
    }

    // Populate missing chunks inside sliding window from pool (or create only during initial warm-up)
    for (let idx = minC; idx <= maxC; idx++) {
      if (!chunks.has(idx)) {
        const chunk = chunkPool.pop() ?? createEmptyChunk();
        populateChunk(chunk, idx);
        chunks.set(idx, chunk);
        group.add(chunk.group);
      }
    }

    syncVisibleTunnels(playerDistM);
  };

  // Pre-build initial visible window around start grid s = 0
  updateAtDistance(0);

  // 5. Dynamic 3D Rain Particle Field (Active when weather === 'rain')
  let rainPoints: THREE.Points | null = null;
  let rainPositions: Float32Array | null = null;
  if (weather === 'rain') {
    const dropCount = quality === 'low' ? 600 : 1200;
    const rGeo = new THREE.BufferGeometry();
    rainPositions = new Float32Array(dropCount * 3);
    for (let i = 0; i < dropCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 70;
      rainPositions[i * 3 + 1] = Math.random() * 28;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    rGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rMat = new THREE.PointsMaterial({
      color: 0xcbd5e1,
      size: 0.16,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    globalDisposables.push(rGeo, rMat);
    rainPoints = new THREE.Points(rGeo, rMat);
    rainPoints.frustumCulled = false;
    group.add(rainPoints);
  }

  const updateWeatherFrame = (camPos: THREE.Vector3, dt: number) => {
    skyDome.position.copy(camPos);
    if (rainPoints && rainPositions) {
      rainPoints.position.set(camPos.x, Math.max(0, camPos.y - 6), camPos.z);
      const attr = rainPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        let y = rainPositions[i * 3 + 1] - 32 * dt;
        if (y < 0) y += 28;
        rainPositions[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }
  };

  return {
    group,
    sampleAtDistance,
    sampleGroundAt,
    getCurvatureAt,
    getTunnelFactorAt,
    getTunnelLightingState,
    updateAtDistance,
    rainPoints,
    updateWeatherFrame,
    dispose: () => {
      worldDisposed = true;
      for (const slot of tunnelSlotsByStyle.values()) {
        for (const im of slot.straightShellIMs) im.dispose();
        for (const im of slot.lightIMs) im.dispose();
        for (const im of slot.ventIMs) im.dispose();
      }
      for (const chunk of chunks.values()) {
        for (const d of chunk.disposables) {
          d.dispose();
        }
        chunk.railsIM.dispose();
        chunk.postsIM.dispose();
        chunk.rocksIM.dispose();
        chunk.pineTrunksIM.dispose();
        chunk.pineCrownsIM.dispose();
        chunk.broadTrunksIM.dispose();
        chunk.broadCrownsIM.dispose();
        chunk.shrubsIM.dispose();
        chunk.grassIM.dispose();
        chunk.polesIM.dispose();
        chunk.lampsIM.dispose();
      }
      for (const chunk of chunkPool) {
        for (const d of chunk.disposables) {
          d.dispose();
        }
        chunk.railsIM.dispose();
        chunk.postsIM.dispose();
        chunk.rocksIM.dispose();
        chunk.pineTrunksIM.dispose();
        chunk.pineCrownsIM.dispose();
        chunk.broadTrunksIM.dispose();
        chunk.broadCrownsIM.dispose();
        chunk.shrubsIM.dispose();
        chunk.grassIM.dispose();
        chunk.polesIM.dispose();
        chunk.lampsIM.dispose();
      }
      chunks.clear();
      chunkPool.length = 0;
      signPool.length = 0;
      tunnelSlotsByStyle.clear();
      for (const d of globalDisposables) {
        d.dispose();
      }
    },
  };
}
