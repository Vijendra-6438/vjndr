import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VehicleId } from '../types/game';
import { VEHICLES } from '../data/vehicles';
import { AnimatedDriverRig, createRealisticDriver } from './driverModel';
import type { VehicleRig } from './vehicleModels';
import type { TrafficVehicleKind, TrafficVehicleRig } from './trafficModels';
import { ExhaustFlameSystem } from './exhaustFlames';

export interface GlbVehicleConfig {
  url: string;
  diskPath: string;
  label: string;
  targetLength: number;
  defaultHalfWidth: number;
  defaultHalfLength: number;
  defaultWheelRadius: number;
  isBus: boolean;
  isSports: boolean;
  isFormula?: boolean;
  zUpToYUp: boolean;
  rotateYPi?: boolean;
  preserveBakedTexture: boolean;
  formulaTexturePaint?: boolean;
}

export const PLAYABLE_GLB_CONFIG: Record<
  Exclude<VehicleId, 'scorpio'>,
  GlbVehicleConfig
> = {
  bus: {
    url: '/EPEM7MD3B0KV6A09YKY3CJNNN.glb',
    diskPath: '/public/EPEM7MD3B0KV6A09YKY3CJNNN.glb',
    label: 'Bus',
    targetLength: 9.6,
    defaultHalfWidth: 1.29,
    defaultHalfLength: 4.8,
    defaultWheelRadius: 0.48,
    isBus: true,
    isSports: false,
    zUpToYUp: false,
    preserveBakedTexture: true,
  },
  lamborghini: {
    url: '/8cdc654398494796b3626e79364407fa.glb',
    diskPath: '/public/8cdc654398494796b3626e79364407fa.glb',
    label: 'Lamborghini',
    targetLength: 4.78,
    defaultHalfWidth: 1.08,
    defaultHalfLength: 2.39,
    defaultWheelRadius: 0.32,
    isBus: false,
    isSports: true,
    zUpToYUp: true,
    preserveBakedTexture: false,
  },
  nissan: {
    url: '/d966d1ba6e9843ad9a32909f7e6dde17.glb',
    diskPath: '/public/d966d1ba6e9843ad9a32909f7e6dde17.glb',
    label: 'Nissan IM03 Formula E Gen2',
    targetLength: 5.08,
    defaultHalfWidth: 0.94,
    defaultHalfLength: 2.54,
    defaultWheelRadius: 0.34,
    isBus: false,
    isSports: true,
    isFormula: true,
    zUpToYUp: false,
    rotateYPi: true,
    preserveBakedTexture: false,
    formulaTexturePaint: true,
  },
};

export const TRAFFIC_GLB_CONFIG: Record<TrafficVehicleKind, GlbVehicleConfig> = {
  bus: {
    ...PLAYABLE_GLB_CONFIG.bus,
    label: 'Highway Bus',
  },
  lamborghini: {
    ...PLAYABLE_GLB_CONFIG.lamborghini,
    label: 'Lamborghini',
  },
  scorpio: {
    url: '/4e4b85f3beae4f2183ca64f406609e92.glb',
    diskPath: '/public/4e4b85f3beae4f2183ca64f406609e92.glb',
    label: 'Mahindra Scorpio',
    targetLength: 4.48,
    defaultHalfWidth: 0.94,
    defaultHalfLength: 2.24,
    defaultWheelRadius: 0.37,
    isBus: false,
    isSports: false,
    zUpToYUp: false,
    preserveBakedTexture: false,
  },
};

const glbCache = new Map<string, Promise<GLTF>>();
const busPaintTexCache = new Map<string, THREE.CanvasTexture>();
const formulaPaintTexCache = new Map<string, THREE.CanvasTexture>();
let sharedDracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath('/draco/');
  }
  return sharedDracoLoader;
}

/**
 * Downscales oversized embedded GLB textures in memory (preserving crisp detail & mipmaps)
 * so giant 2K/4K source textures don't stall WebGL uploads or exhaust GPU VRAM.
 */
export function optimizeGltfTextures(
  root: THREE.Object3D,
  maxColorDim = 1024,
  maxAuxDim = 512,
): void {
  if (typeof document === 'undefined') return;
  const seenTex = new Set<THREE.Texture>();
  const downscaleTex = (tex: THREE.Texture | null | undefined, maxDim: number) => {
    if (!tex || seenTex.has(tex)) return;
    seenTex.add(tex);
    const img = tex.image as
      | (CanvasImageSource & { width?: number; height?: number; close?: () => void })
      | undefined;
    if (!img || !img.width || !img.height) return;
    const w = img.width;
    const h = img.height;
    if (w <= maxDim && h <= maxDim) return;

    const scale = maxDim / Math.max(w, h);
    const nw = Math.max(64, Math.round(w * scale));
    const nh = Math.max(64, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, nw, nh);
    if (typeof img.close === 'function') {
      try {
        img.close();
      } catch {
        // Ignore ImageBitmap close errors
      }
    }
    tex.image = canvas;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
  };

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        downscaleTex(mat.map, maxColorDim);
        downscaleTex(mat.emissiveMap, maxColorDim);
        downscaleTex(mat.normalMap, maxAuxDim);
        downscaleTex(mat.roughnessMap, maxAuxDim);
        downscaleTex(mat.metalnessMap, maxAuxDim);
        downscaleTex(mat.aoMap, maxAuxDim);
      }
    }
  });
}

function normalizeGeometryForMerge(
  src: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  includeUv: boolean,
): THREE.BufferGeometry {
  const nonIdx = src.index ? src.toNonIndexed() : src.clone();
  nonIdx.applyMatrix4(matrix);
  if (!nonIdx.attributes.normal) {
    nonIdx.computeVertexNormals();
  }
  const posCount = nonIdx.attributes.position.count;
  if (includeUv && !nonIdx.attributes.uv) {
    nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(posCount * 2), 2));
  }
  for (const attrName of Object.keys(nonIdx.attributes)) {
    if (
      attrName !== 'position' &&
      attrName !== 'normal' &&
      (!includeUv || attrName !== 'uv')
    ) {
      nonIdx.deleteAttribute(attrName);
    }
  }
  return nonIdx;
}

export interface MergedBucket {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  renderOrder: number;
  visible: boolean;
}

/**
 * Merges static meshes sharing the exact same material relative to `spaceRoot`.
 * Skips any meshes that use multi-material arrays or live inside `excludedNodes`.
 */
export function mergeMeshesByMaterial(
  spaceRoot: THREE.Object3D,
  excludedNodes?: Set<THREE.Object3D>,
): { merged: MergedBucket[]; passthrough: THREE.Mesh[] } {
  spaceRoot.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(spaceRoot.matrixWorld).invert();
  const relMat = new THREE.Matrix4();

  const buckets = new Map<
    string,
    {
      material: THREE.Material;
      meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[];
      renderOrder: number;
      visible: boolean;
      hasUv: boolean;
    }
  >();
  const passthrough: THREE.Mesh[] = [];

  spaceRoot.traverse((obj) => {
    if (excludedNodes) {
      let p: THREE.Object3D | null = obj;
      while (p) {
        if (excludedNodes.has(p)) return;
        p = p.parent;
      }
    }
    if (!(obj instanceof THREE.Mesh) || !obj.geometry || !obj.material) return;
    if (!obj.visible) return;
    if (Array.isArray(obj.material)) {
      passthrough.push(obj);
      return;
    }

    relMat.multiplyMatrices(invRoot, obj.matrixWorld);
    const key = `${obj.material.uuid}:${obj.renderOrder}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: obj.material,
        meshes: [],
        renderOrder: obj.renderOrder,
        visible: obj.visible,
        hasUv: !!obj.geometry.attributes.uv,
      };
      buckets.set(key, bucket);
    } else if (obj.geometry.attributes.uv) {
      bucket.hasUv = true;
    }
    bucket.meshes.push({ mesh: obj, matrix: relMat.clone() });
  });

  const merged: MergedBucket[] = [];
  for (const bucket of buckets.values()) {
    const geos = bucket.meshes.map((entry) =>
      normalizeGeometryForMerge(entry.mesh.geometry, entry.matrix, bucket.hasUv),
    );
    if (geos.length === 1) {
      merged.push({
        geometry: geos[0],
        material: bucket.material,
        renderOrder: bucket.renderOrder,
        visible: bucket.visible,
      });
    } else {
      const combined = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (combined) {
        merged.push({
          geometry: combined,
          material: bucket.material,
          renderOrder: bucket.renderOrder,
          visible: bucket.visible,
        });
      }
    }
  }

  return { merged, passthrough };
}

function resolveBodyTint(cfg: GlbVehicleConfig, hex: string): string {
  if (!cfg.isBus && !cfg.isSports) {
    // Scorpio traffic GLB grey sheet-metal calibration
    const h = hex.trim().toLowerCase();
    if (h === '#171a21') return '#22262e';
    if (h === '#15803d') return '#1da14e';
    if (h === '#f1f5f9') return '#ffffff';
    if (h === '#eab308') return '#facc15';
    if (h === '#2563eb') return '#3b82f6';
  }
  return hex;
}

/**
 * Recolors ONLY the blue/cyan painted exterior body regions of the Bus TexMap atlas,
 * leaving tires, rims, windows, headlights, taillights, plates, and white lettering untouched.
 */
function getRecoloredBusTexture(origTex: THREE.Texture, targetHex: string): THREE.Texture {
  const normHex = targetHex.trim().toLowerCase();
  if (normHex === '#2563eb') {
    return origTex; // Original blue livery
  }

  const cacheKey = `${origTex.uuid}::${normHex}`;
  const cached = busPaintTexCache.get(cacheKey);
  if (cached) return cached;

  const img = origTex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width || !img.height || typeof document === 'undefined') {
    return origTex;
  }

  const w = Math.min(1024, img.width);
  const h = Math.min(1024, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return origTex;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const targetColor = new THREE.Color(normHex);
  const tr = Math.round(targetColor.r * 255);
  const tg = Math.round(targetColor.g * 255);
  const tb = Math.round(targetColor.b * 255);
  const isWhitePaint = normHex === '#f1f5f9' || normHex === '#ffffff';
  const isBlackPaint = normHex === '#171a21';

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const blueDom = b - r;
    if (blueDom > 18 && b > 52) {
      const m1 = Math.min(1, (blueDom - 18) / 28);
      const m2 = Math.min(1, (b - 52) / 36);
      const mask = m1 * m2;

      // Preserve two-tone shade variation & panel ambient occlusion
      const rawLum = (0.299 * r + 0.587 * g + 0.114 * b) / 140;
      const shade = isWhitePaint
        ? Math.min(1.06, Math.max(0.74, 0.72 + rawLum * 0.28))
        : isBlackPaint
        ? Math.min(1.18, Math.max(0.55, 0.5 + rawLum * 0.55))
        : Math.min(1.38, Math.max(0.38, rawLum));

      const nr = Math.min(255, Math.round(tr * shade));
      const ng = Math.min(255, Math.round(tg * shade));
      const nb = Math.min(255, Math.round(tb * shade));

      data[i] = Math.round(r + (nr - r) * mask);
      data[i + 1] = Math.round(g + (ng - g) * mask);
      data[i + 2] = Math.round(b + (nb - b) * mask);
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const recoloredTex = new THREE.CanvasTexture(canvas);
  recoloredTex.colorSpace = THREE.SRGBColorSpace;
  recoloredTex.flipY = origTex.flipY;
  recoloredTex.wrapS = origTex.wrapS;
  recoloredTex.wrapT = origTex.wrapT;
  recoloredTex.anisotropy = origTex.anisotropy;
  recoloredTex.needsUpdate = true;

  busPaintTexCache.set(cacheKey, recoloredTex);
  return recoloredTex;
}

/**
 * Recolors ONLY the painted bodywork livery regions (crimson livery & metallic silver/white aero panels)
 * on the Formula E exterior body material, keeping carbon fiber, vents, black trim, and colored decals intact.
 */
function getRecoloredFormulaBodyTexture(
  origTex: THREE.Texture,
  targetHex: string,
): THREE.Texture {
  const normHex = targetHex.trim().toLowerCase();
  const cacheKey = `${origTex.uuid}::${normHex}`;
  const cached = formulaPaintTexCache.get(cacheKey);
  if (cached) return cached;

  const img = origTex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width || !img.height || typeof document === 'undefined') {
    return origTex;
  }

  const w = Math.min(1024, img.width);
  const h = Math.min(1024, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return origTex;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const isBlackPaint = normHex === '#171a21';
  const isWhitePaint = normHex === '#f1f5f9' || normHex === '#ffffff';
  const targetColor = new THREE.Color(isBlackPaint ? '#1e232c' : normHex);
  const tr = Math.round(targetColor.r * 255);
  const tg = Math.round(targetColor.g * 255);
  const tb = Math.round(targetColor.b * 255);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx - mn;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const redness = r - Math.max(g, b);

    const redMask = redness > 20 ? Math.min(1, (redness - 20) / 30) : 0;
    const silverMask =
      sat < 26 && lum > 118
        ? Math.min(1, (lum - 118) / 30) * (1 - sat / 26)
        : 0;
    const mask = Math.max(redMask, silverMask);

    if (mask > 0.01) {
      let shade = 1.0;
      if (redMask >= silverMask) {
        shade = isWhitePaint
          ? Math.min(1.06, Math.max(0.84, 0.8 + (lum / 140) * 0.22))
          : isBlackPaint
          ? Math.min(1.15, Math.max(0.55, 0.55 + (lum / 140) * 0.45))
          : Math.min(1.22, Math.max(0.52, lum / 112));
      } else {
        shade = isWhitePaint
          ? Math.min(1.06, Math.max(0.84, lum / 210))
          : isBlackPaint
          ? Math.min(1.22, Math.max(0.64, 0.65 + (lum / 225) * 0.45))
          : Math.min(1.18, Math.max(0.64, lum / 188));
      }

      const nr = Math.min(255, Math.round(tr * shade));
      const ng = Math.min(255, Math.round(tg * shade));
      const nb = Math.min(255, Math.round(tb * shade));

      data[i] = Math.round(r + (nr - r) * mask);
      data[i + 1] = Math.round(g + (ng - g) * mask);
      data[i + 2] = Math.round(b + (nb - b) * mask);
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const recoloredTex = new THREE.CanvasTexture(canvas);
  recoloredTex.colorSpace = THREE.SRGBColorSpace;
  recoloredTex.flipY = origTex.flipY;
  recoloredTex.wrapS = origTex.wrapS;
  recoloredTex.wrapT = origTex.wrapT;
  recoloredTex.anisotropy = origTex.anisotropy;
  recoloredTex.needsUpdate = true;

  formulaPaintTexCache.set(cacheKey, recoloredTex);
  return recoloredTex;
}

const FALLBACK_CONCRETE_PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOYM3PSfwAGYwLHexjOggAAAABJRU5ErkJggg==';

/**
 * Checks embedded GLB image bufferViews in memory and replaces any truncated/corrupt image
 * (e.g. truncated WebP/PNG/JPEG payloads) with a valid fallback data URI so GLTFLoader never
 * attempts to decode broken blob: URLs while keeping all BIN offsets untouched.
 */
function sanitizeGlbEmbeddedImages(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength < 28) return buffer;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    return buffer;
  }

  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > buffer.byteLength) {
    return buffer;
  }

  const binChunkStart = 20 + jsonLen;
  if (binChunkStart + 8 > buffer.byteLength) return buffer;
  const binDataStart = binChunkStart + 8;

  interface GlbImageDef {
    mimeType?: string;
    bufferView?: number;
    uri?: string;
  }
  interface GlbBufferViewDef {
    buffer?: number;
    byteOffset?: number;
    byteLength?: number;
  }

  let json: {
    images?: GlbImageDef[];
    bufferViews?: GlbBufferViewDef[];
  };
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen))) as {
      images?: GlbImageDef[];
      bufferViews?: GlbBufferViewDef[];
    };
  } catch {
    return buffer;
  }

  if (!Array.isArray(json.images) || !Array.isArray(json.bufferViews)) {
    return buffer;
  }

  let modified = false;
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < json.images.length; i++) {
    const img: GlbImageDef = json.images[i];
    if (img.bufferView === undefined) continue;
    const bv: GlbBufferViewDef | undefined = json.bufferViews[img.bufferView];
    if (!bv || (bv.buffer ?? 0) !== 0) continue;

    const byteOffset: number = bv.byteOffset ?? 0;
    const byteLength: number = bv.byteLength ?? 0;
    const off = binDataStart + byteOffset;

    let invalid = false;
    if (byteLength < 24 || off < binDataStart || off + byteLength > buffer.byteLength) {
      invalid = true;
    } else if (
      img.mimeType === 'image/webp' ||
      (bytes[off] === 0x52 && bytes[off + 1] === 0x49 && bytes[off + 8] === 0x57)
    ) {
      const isRiffWebp =
        bytes[off] === 0x52 &&
        bytes[off + 1] === 0x49 &&
        bytes[off + 2] === 0x46 &&
        bytes[off + 3] === 0x46 &&
        bytes[off + 8] === 0x57 &&
        bytes[off + 9] === 0x45 &&
        bytes[off + 10] === 0x42 &&
        bytes[off + 11] === 0x50;
      const declaredSize = view.getUint32(off + 4, true) + 8;
      if (!isRiffWebp || declaredSize > byteLength + 4) {
        invalid = true;
      }
    } else if (img.mimeType === 'image/png') {
      if (
        bytes[off] !== 0x89 ||
        bytes[off + 1] !== 0x50 ||
        bytes[off + 2] !== 0x4e ||
        bytes[off + 3] !== 0x47
      ) {
        invalid = true;
      }
    } else if (img.mimeType === 'image/jpeg') {
      if (bytes[off] !== 0xff || bytes[off + 1] !== 0xd8) {
        invalid = true;
      }
    }

    if (invalid) {
      delete img.bufferView;
      img.mimeType = 'image/png';
      img.uri = FALLBACK_CONCRETE_PNG_URI;
      modified = true;
    }
  }

  if (!modified) return buffer;

  const rawJsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJsonLen = (rawJsonBytes.byteLength + 3) & ~3;
  const binChunkBytes = bytes.subarray(binChunkStart);
  const out = new Uint8Array(20 + paddedJsonLen + binChunkBytes.byteLength);
  const outView = new DataView(out.buffer);

  out.set(bytes.subarray(0, 20), 0);
  outView.setUint32(8, out.byteLength, true);
  outView.setUint32(12, paddedJsonLen, true);
  out.set(rawJsonBytes, 20);
  for (let p = 20 + rawJsonBytes.byteLength; p < 20 + paddedJsonLen; p++) {
    out[p] = 0x20;
  }
  out.set(binChunkBytes, 20 + paddedJsonLen);
  return out.buffer;
}

/**
 * Fetches and caches a GLB model once per URL across player and all traffic spawns.
 * Validates the 'glTF' binary magic bytes so Vite's HTML SPA fallback never fails silently.
 */
export function loadValidatedGlb(
  url: string,
  diskPath: string,
  label: string,
): Promise<GLTF> {
  const existing = glbCache.get(url);
  if (existing) return existing;

  const promise = (async () => {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      glbCache.delete(url);
      throw new Error(
        `Unable to fetch 3D model for ${label} (${diskPath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Missing 3D GLB model for ${label}: expected ${diskPath} (HTTP ${response.status})`,
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const rawBuffer = await response.arrayBuffer();
    if (rawBuffer.byteLength < 12) {
      throw new Error(
        `Invalid or empty 3D GLB model for ${label}: expected valid .glb at ${diskPath}`,
      );
    }

    const view = new DataView(rawBuffer);
    const magic = view.getUint32(0, true);
    const isGlbMagic = magic === 0x46546c67; // 'glTF'

    if (!isGlbMagic) {
      const previewText = new TextDecoder().decode(rawBuffer.slice(0, 96)).trimStart();
      if (
        contentType.includes('text/html') ||
        previewText.startsWith('<!') ||
        previewText.toLowerCase().startsWith('<html')
      ) {
        throw new Error(
          `Missing 3D GLB model for ${label}: place the uploaded .glb file at ${diskPath}`,
        );
      }
    }

    const buffer = isGlbMagic ? sanitizeGlbEmbeddedImages(rawBuffer) : rawBuffer;

    const loader = new GLTFLoader();
    loader.setDRACOLoader(getDracoLoader());
    const basePath = url.substring(0, url.lastIndexOf('/') + 1);
    return await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        buffer,
        basePath,
        (gltf) => {
          optimizeGltfTextures(gltf.scene, 1024, 512);
          resolve(gltf);
        },
        (err) => {
          reject(
            new Error(
              `Invalid GLB model for ${label} (${diskPath}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        },
      );
    });
  })();

  glbCache.set(url, promise);
  return promise;
}

/**
 * Normalizes orientation, scale, centering, and road grounding (minY = 0, facing -Z).
 */
function alignAndScaleModel(
  modelScene: THREE.Object3D,
  cfg: GlbVehicleConfig,
): { alignedWrapper: THREE.Group; size: THREE.Vector3 } {
  if (cfg.zUpToYUp) {
    // Convert Z-up / +Y-forward CAD/FBX exports cleanly into Y-up / -Z-forward Three.js space
    modelScene.rotation.x = -Math.PI * 0.5;
  }
  if (cfg.rotateYPi) {
    // Flip +Z-facing exports cleanly to face -Z forward along the highway
    modelScene.rotation.y += Math.PI;
  }

  modelScene.updateMatrixWorld(true);
  const preBox = new THREE.Box3().setFromObject(modelScene);
  const preSize = new THREE.Vector3();
  preBox.getSize(preSize);

  const alignedWrapper = new THREE.Group();
  alignedWrapper.name = 'GlbAlignedWrapper';

  // Auto-detect if a Y-up model was exported sideways along X
  if (!cfg.zUpToYUp && !cfg.rotateYPi && preSize.x > preSize.z * 1.18) {
    modelScene.rotation.y -= Math.PI * 0.5;
    modelScene.updateMatrixWorld(true);
  }

  const rawBox = new THREE.Box3().setFromObject(modelScene);
  const rawSize = new THREE.Vector3();
  const rawCenter = new THREE.Vector3();
  rawBox.getSize(rawSize);
  rawBox.getCenter(rawCenter);

  const normScale = rawSize.z > 0.01 ? cfg.targetLength / rawSize.z : 1.0;
  alignedWrapper.scale.setScalar(normScale);
  alignedWrapper.position.set(
    -rawCenter.x * normScale,
    -rawBox.min.y * normScale,
    -rawCenter.z * normScale,
  );
  alignedWrapper.add(modelScene);
  alignedWrapper.updateMatrixWorld(true);

  const finalBox = new THREE.Box3().setFromObject(alignedWrapper);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);
  return { alignedWrapper, size: finalSize };
}

interface ProcessedGlbParts {
  paintMaterials: THREE.MeshStandardMaterial[];
  headlightMaterials: THREE.MeshStandardMaterial[];
  taillightMaterials: THREE.MeshStandardMaterial[];
  leftIndMaterials: THREE.MeshStandardMaterial[];
  rightIndMaterials: THREE.MeshStandardMaterial[];
  wheelFLPivot: THREE.Object3D | null;
  wheelFRPivot: THREE.Object3D | null;
  wheelSpinTargets: THREE.Object3D[];
  detectedWheelRadius: number | null;
  steeringPivot: THREE.Object3D | null;
  steeringCenterBodyLocal: THREE.Vector3 | null;
  clonedMaterials: THREE.Material[];
}

function processGlbScene(
  stagingRoot: THREE.Group,
  stagingBodyGroup: THREE.Group,
  stagingUnsprungWheelsGroup: THREE.Group,
  modelScene: THREE.Object3D,
  cfg: GlbVehicleConfig,
  options?: { isTraffic?: boolean },
): ProcessedGlbParts {
  const isTraffic = options?.isTraffic ?? false;
  const paintMaterials: THREE.MeshStandardMaterial[] = [];
  const headlightMaterials: THREE.MeshStandardMaterial[] = [];
  const taillightMaterials: THREE.MeshStandardMaterial[] = [];
  const leftIndMaterials: THREE.MeshStandardMaterial[] = [];
  const rightIndMaterials: THREE.MeshStandardMaterial[] = [];
  const clonedMaterials: THREE.Material[] = [];

  const clonedMatCache = new Map<string, THREE.Material>();
  const meshCenter = new THREE.Vector3();
  const meshBox = new THREE.Box3();

  modelScene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    const name = obj.name || '';
    const parentName = obj.parent?.name || '';
    const combinedName = `${parentName} ${name}`;
    const meshIsGlass = /glass|windshield|windscreen|car_windows/i.test(name);
    const meshIsMainCar = /main[_\s]?car/i.test(name);
    const meshIsHead = /car[_\s]?light|head[_\s]?light|front[_\s]?light|drl/i.test(name);
    const meshIsTail = /vehiclelights|tail[_\s]?light|brake[_\s]?light|rear[_\s]?light|back_lamp_low/i.test(combinedName);
    const meshIsInd = /indicator|blinker|turn[_\s]?signal/i.test(name);
    const formulaIsBodyMesh =
      !!cfg.formulaTexturePaint &&
      (/^(main_body_|front_bumper|rear_bumper|side_plates|mirror_low)/i.test(name) ||
        /^(main_body_|front_bumper|rear_bumper|side_plates|mirror_low)/i.test(parentName));

    let computedMeshCenter = false;
    const ensureMeshCenterX = (): number => {
      if (!computedMeshCenter) {
        computedMeshCenter = true;
        meshBox.setFromObject(obj);
        meshBox.getCenter(meshCenter);
        stagingRoot.worldToLocal(meshCenter);
      }
      return meshCenter.x;
    };

    let hasExteriorShadowMesh = meshIsMainCar || /body|chassis|bus/i.test(combinedName);

    const roleKey = cfg.formulaTexturePaint
      ? formulaIsBodyMesh
        ? 'formula_body'
        : meshIsTail
        ? 'formula_tail'
        : 'formula_other'
      : 'default';

    const cloneMat = (srcMat: THREE.Material): THREE.Material => {
      const cacheKey = `${srcMat.uuid}:${roleKey}`;
      let mat = clonedMatCache.get(cacheKey);
      if (!mat) {
        mat = srcMat.clone();
        clonedMatCache.set(cacheKey, mat);
        clonedMaterials.push(mat);

        if (mat instanceof THREE.MeshStandardMaterial) {
          const matName = mat.name || '';

          if (cfg.formulaTexturePaint) {
            if (mat.map && !mat.userData.origBakedMap) {
              mat.userData.origBakedMap = mat.map;
            }
            mat.alphaTest = 0;
            mat.transparent = false;
            mat.opacity = 1.0;

            if (roleKey === 'formula_body') {
              mat.roughness = 0.24;
              mat.metalness = 0.34;
              mat.envMapIntensity = 1.12;
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0.0;
              paintMaterials.push(mat);
              hasExteriorShadowMesh = true;
            } else if (roleKey === 'formula_tail') {
              mat.roughness = 0.18;
              mat.emissive = new THREE.Color(0xef4444);
              mat.emissiveIntensity = 0.65;
              taillightMaterials.push(mat);
            } else {
              mat.envMapIntensity = 0.96;
              mat.emissiveIntensity = 0.75;
            }
          } else if (cfg.preserveBakedTexture) {
            if (mat.map && !mat.userData.origBakedMap) {
              mat.userData.origBakedMap = mat.map;
            }
            mat.alphaTest = 0;
            mat.transparent = false;
            mat.roughness = 0.38;
            mat.metalness = 0.24;
            mat.envMapIntensity = isTraffic ? 0.85 : 0.98;
            mat.color.setHex(0xffffff);
            paintMaterials.push(mat);
            hasExteriorShadowMesh = true;
          } else {
            const isLowAlphaGlass =
              (mat.opacity < 0.25 && /window|glass|_Color_A08_1/i.test(matName)) ||
              /car_windows|glass|windshield|windscreen/i.test(matName) ||
              meshIsGlass;
            const isIndicator = meshIsInd || /indicator|blinker|turn[_\s]?signal/i.test(matName);
            const isTaillight = meshIsTail || /vehiclelights|tail[_\s]?light|brake[_\s]?light/i.test(matName);
            const isHeadlight =
              !isLowAlphaGlass &&
              !isTaillight &&
              (meshIsHead || /head[_\s]?light|car[_\s]?light|drl/i.test(matName));
            const isExteriorPaint =
              !isLowAlphaGlass &&
              !isTaillight &&
              !isHeadlight &&
              (/^body$/i.test(matName) ||
                /^main[_\s]?car$/i.test(matName) ||
                /paint|carpaint|exterior/i.test(matName) ||
                (meshIsMainCar && !/trim|interior|tire|wheel|chassis|disc/i.test(matName)));

            if (isExteriorPaint) {
              hasExteriorShadowMesh = true;
            }

            // Fix glTF alphaMode: MASK (alphaTest=0.5) artifacts on solid opaque meshes vs transparent glass
            if (isLowAlphaGlass) {
              mat.alphaTest = 0;
              mat.transparent = true;
              mat.opacity = 0.34;
              mat.roughness = 0.1;
              mat.metalness = 0.22;
              mat.envMapIntensity = isTraffic ? 0.95 : 1.15;
              mat.depthWrite = false;
              mat.side = THREE.DoubleSide;
            } else {
              mat.alphaTest = 0;
              mat.transparent = false;
              mat.opacity = 1.0;
              mat.envMapIntensity = isTraffic ? 0.88 : 1.02;

              if (isIndicator) {
                mat.roughness = 0.18;
                mat.emissive = new THREE.Color(0xf59e0b);
                mat.emissiveIntensity = 0.08;
                if (ensureMeshCenterX() < 0) leftIndMaterials.push(mat);
                else rightIndMaterials.push(mat);
              } else if (isHeadlight) {
                mat.roughness = 0.14;
                mat.emissive = new THREE.Color(0x000000);
                mat.emissiveIntensity = 0;
                headlightMaterials.push(mat);
              } else if (isTaillight) {
                mat.roughness = 0.2;
                mat.emissive = new THREE.Color(0xef4444);
                mat.emissiveIntensity = 0.55;
                taillightMaterials.push(mat);
              } else if (isExteriorPaint) {
                mat.roughness = cfg.isSports ? 0.18 : 0.22;
                mat.metalness = cfg.isSports ? 0.58 : 0.42;
                mat.envMapIntensity = isTraffic ? 0.95 : 1.15;
                paintMaterials.push(mat);
              }
            }
          }
        }
      }
      return mat;
    };

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(cloneMat);
    } else if (obj.material) {
      obj.material = cloneMat(obj.material);
    }

    const matAlphaGlass =
      !Array.isArray(obj.material) &&
      obj.material instanceof THREE.MeshStandardMaterial &&
      obj.material.transparent;
    if (meshIsGlass || matAlphaGlass) {
      obj.castShadow = false;
      obj.receiveShadow = !isTraffic;
      obj.renderOrder = 4;
    } else {
      // Traffic vehicles rely on crisp ground contact shadows, saving shadow-map passes on 16 pooled vehicles
      obj.castShadow = !isTraffic;
      obj.receiveShadow = !isTraffic;
    }
  });

  // Collect separate wheel nodes (supports Scorpio Wheel_FL..BR, Lamborghini wheel1..wheel4, Formula E *_wheel_low, & generic names)
  const wheelCandidates: THREE.Object3D[] = [];
  const knownWheelNames = [
    'Wheel_FL',
    'Wheel FL',
    'Wheel_FR',
    'Wheel FR',
    'Wheel_BL',
    'Wheel BL',
    'Wheel_BR',
    'Wheel BR',
    'Wheel_RL',
    'Wheel_RR',
    'wheel1',
    'wheel2',
    'wheel3',
    'wheel4',
    'front_left_wheel_low',
    'front_right_wheel_low',
    'back_left_wheel_low',
    'back_right_wheel_low',
  ];
  for (const name of knownWheelNames) {
    const found = modelScene.getObjectByName(name);
    if (found && !wheelCandidates.includes(found)) {
      wheelCandidates.push(found);
    }
  }

  if (wheelCandidates.length === 0) {
    modelScene.traverse((obj) => {
      if (obj === modelScene) return;
      const n = obj.name || '';
      if (!/^(wheel|tire|tyre)/i.test(n)) return;
      if (/_0$/i.test(n)) return; // Skip sub-primitive meshes like Mesh21_wheel_0
      let p = obj.parent;
      let ancestorCaptured = false;
      while (p) {
        if (wheelCandidates.includes(p)) {
          ancestorCaptured = true;
          break;
        }
        p = p.parent;
      }
      if (!ancestorCaptured) {
        wheelCandidates.push(obj);
      }
    });
  }

  let wheelFLPivot: THREE.Object3D | null = null;
  let wheelFRPivot: THREE.Object3D | null = null;
  const wheelSpinTargets: THREE.Object3D[] = [];
  let detectedWheelRadius: number | null = null;

  const wheelInfos = wheelCandidates.map((node) => {
    node.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const localCenter = stagingRoot.worldToLocal(center.clone());
    return { node, localCenter, size };
  });

  for (const info of wheelInfos) {
    if (info.size.y > 0.2 && info.size.y < 1.6) {
      detectedWheelRadius = info.size.y * 0.5;
    }

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(info.localCenter);
    stagingUnsprungWheelsGroup.add(steerPivot);
    steerPivot.updateMatrixWorld(true);

    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);
    spinPivot.updateMatrixWorld(true);
    spinPivot.attach(info.node);

    const isFront =
      /_fl|_fr|front/i.test(info.node.name) || info.localCenter.z < -0.35;
    if (isFront) {
      if (info.localCenter.x < 0 && !wheelFLPivot) {
        wheelFLPivot = steerPivot;
      } else if (info.localCenter.x >= 0 && !wheelFRPivot) {
        wheelFRPivot = steerPivot;
      }
    }
    wheelSpinTargets.push(spinPivot);
  }

  // Attach front brake calipers (e.g., Lamborghini hub_rf1 / hub_rf2) to front steer pivots without spinning
  for (const hubName of ['hub_rf1', 'hub_rf2']) {
    const hub = modelScene.getObjectByName(hubName);
    if (!hub) continue;
    hub.updateMatrixWorld(true);
    const hBox = new THREE.Box3().setFromObject(hub);
    const hCenter = new THREE.Vector3();
    hBox.getCenter(hCenter);
    stagingRoot.worldToLocal(hCenter);
    if (hCenter.x < 0 && wheelFLPivot) {
      wheelFLPivot.attach(hub);
    } else if (hCenter.x >= 0 && wheelFRPivot) {
      wheelFRPivot.attach(hub);
    }
  }

  // Locate steering wheel and wrap in a center-located pivot so it spins in place without orbiting
  let steeringPivot: THREE.Object3D | null = null;
  let steeringCenterBodyLocal: THREE.Vector3 | null = null;
  if (!isTraffic) {
    const steeringCandidate =
      modelScene.getObjectByName('Steering') ??
      modelScene.getObjectByName('Steering_Wheel') ??
      modelScene.getObjectByName('SteeringWheel') ??
      modelScene.getObjectByName('movsteer_o1') ??
      modelScene.getObjectByName('steer_main_body_low');
    if (steeringCandidate) {
      steeringCandidate.updateMatrixWorld(true);
      const sBox = new THREE.Box3().setFromObject(steeringCandidate);
      const sCenter = new THREE.Vector3();
      sBox.getCenter(sCenter);
      stagingBodyGroup.worldToLocal(sCenter);
      steeringCenterBodyLocal = sCenter.clone();

      const sPivot = new THREE.Group();
      sPivot.position.copy(sCenter);
      stagingBodyGroup.add(sPivot);
      sPivot.updateMatrixWorld(true);
      sPivot.attach(steeringCandidate);
      if (cfg.isFormula) {
        for (const extraName of [
          'steer_main_holder_low',
          'steer_base_plate_low',
          'steer_screen_low',
          'steer_buttons_1_low',
          'steer_base_buttons_1_low',
          'steer_buttons_1_round_low',
          'steer_buttons_2_low',
          'steer_twister_low',
          'steer_clutch_base_low',
          'steer_clutch_buttons_low',
        ]) {
          const part = modelScene.getObjectByName(extraName);
          if (part) sPivot.attach(part);
        }
      }
      steeringPivot = sPivot;
    }
  }

  return {
    paintMaterials,
    headlightMaterials,
    taillightMaterials,
    leftIndMaterials,
    rightIndMaterials,
    wheelFLPivot,
    wheelFRPivot,
    wheelSpinTargets,
    detectedWheelRadius,
    steeringPivot,
    steeringCenterBodyLocal,
    clonedMaterials,
  };
}

/**
 * Aligns, scales, and extracts wheels/materials inside a detached identity staging hierarchy
 * so world position/heading of the vehicle rig (e.g. oncoming traffic rotated Math.PI or on hills)
 * NEVER corrupts wheel pivot positions or spin axes.
 */
function mountAlignedAndProcessedGlb(
  bodyGroup: THREE.Group,
  unsprungWheelsGroup: THREE.Group,
  modelScene: THREE.Object3D,
  cfg: GlbVehicleConfig,
  options?: { isTraffic?: boolean },
): { size: THREE.Vector3; parts: ProcessedGlbParts } {
  const stagingRoot = new THREE.Group();
  const stagingUnsprung = new THREE.Group();
  const stagingBody = new THREE.Group();
  stagingRoot.add(stagingUnsprung, stagingBody);

  const { alignedWrapper, size } = alignAndScaleModel(modelScene, cfg);
  stagingBody.add(alignedWrapper);
  stagingRoot.updateMatrixWorld(true);

  const parts = processGlbScene(
    stagingRoot,
    stagingBody,
    stagingUnsprung,
    modelScene,
    cfg,
    options,
  );

  while (stagingBody.children.length > 0) {
    bodyGroup.add(stagingBody.children[0]);
  }
  while (stagingUnsprung.children.length > 0) {
    unsprungWheelsGroup.add(stagingUnsprung.children[0]);
  }

  return { size, parts };
}

export function disposeVehicleObjectMaterials(
  clonedMaterials: THREE.Material[],
  extraMaterials: THREE.Material[],
  extraGeometries: THREE.BufferGeometry[],
): void {
  for (const mat of clonedMaterials) mat.dispose();
  for (const mat of extraMaterials) mat.dispose();
  for (const geo of extraGeometries) geo.dispose();
}

/**
 * Builds a playable VehicleRig backed strictly by an external realistic .glb file
 * (used for Bus, Car, Lamborghini; Scorpio stays untouched in scorpioGlbLoader.ts).
 */
export function buildPlayableGlbRig(params: {
  vehicleId: Exclude<VehicleId, 'scorpio'>;
  initialPaintHex: string;
  contactShadowMap: THREE.Texture;
  onError?: (message: string) => void;
  onLoaded?: () => void;
}): VehicleRig {
  const { vehicleId, initialPaintHex, contactShadowMap, onError, onLoaded } = params;
  const spec = VEHICLES[vehicleId];
  const cfg = PLAYABLE_GLB_CONFIG[vehicleId];

  const root = new THREE.Group();
  root.name = `${vehicleId}_GLBRoot`;

  const shadowGeo = new THREE.PlaneGeometry(
    cfg.isBus ? 3.1 : 2.55,
    cfg.isBus ? 10.4 : 5.35,
  );
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowMap,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI * 0.5;
  shadowPlane.position.y = 0.015;
  root.add(shadowPlane);

  const unsprungWheelsGroup = new THREE.Group();
  root.add(unsprungWheelsGroup);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const frontLeftPivot = new THREE.Group();
  const frontRightPivot = new THREE.Group();
  const wheels: THREE.Group[] = [];
  const steeringWheel = new THREE.Group();
  const gearShifter = new THREE.Group();

  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(initialPaintHex),
    metalness: 0.72,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });
  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: new THREE.Color(0xdc2626),
    emissiveIntensity: 0.6,
  });
  const reverseLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.05,
  });
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });
  const leftIndicatorMaterial = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.08,
  });
  const rightIndicatorMaterial = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.08,
  });

  // Ground-skimming headlight beam projection + real downward-aimed SpotLight (zero mid-air haze/blur)
  const headlightCones = new THREE.Group();
  const beamGeo = new THREE.PlaneGeometry(cfg.isBus ? 1.5 : 1.25, 11.5);
  beamGeo.rotateX(-Math.PI * 0.5);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfef9ec,
    transparent: true,
    opacity: 0.024,
    depthWrite: false,
  });
  for (const sx of [cfg.isBus ? -0.84 : -0.66, cfg.isBus ? 0.84 : 0.66]) {
    const patch = new THREE.Mesh(beamGeo, beamMat);
    patch.position.set(sx, 0.055, -cfg.defaultHalfLength - 5.6);
    headlightCones.add(patch);
  }
  headlightCones.visible = false;
  bodyGroup.add(headlightCones);

  const headlightSpot = new THREE.SpotLight(0xfef7e6, 0, 56, Math.PI / 4.8, 0.78, 1.55);
  headlightSpot.castShadow = false;
  headlightSpot.position.set(0, cfg.isBus ? 1.08 : cfg.isSports ? 0.55 : 0.9, -cfg.defaultHalfLength + 0.05);
  headlightSpot.target.position.set(0, 0.05, -cfg.defaultHalfLength - 22);
  bodyGroup.add(headlightSpot);
  bodyGroup.add(headlightSpot.target);

  let driver: AnimatedDriverRig = createRealisticDriver(
    0x374151,
    cfg.isBus
      ? new THREE.Vector3(0.72, 1.45, -cfg.defaultHalfLength + 1.1)
      : new THREE.Vector3(-0.36, 0.72, -0.35),
    0.155,
    0.34,
  );
  driver.root.visible = false;
  bodyGroup.add(driver.root);

  let glbMounted = false;
  let disposed = false;
  let latestPaintHex = initialPaintHex;
  let parts: ProcessedGlbParts | null = null;
  let exhaustFlames: ExhaustFlameSystem | null = null;

  const applyPaintHex = (hex: string) => {
    latestPaintHex = hex;
    paintMaterial.color.set(hex);
    if (!glbMounted || !parts) return;
    for (const mat of parts.paintMaterials) {
      if (cfg.formulaTexturePaint) {
        mat.color.setHex(0xffffff);
        const origMap = mat.userData.origBakedMap as THREE.Texture | undefined;
        if (origMap) {
          mat.map = getRecoloredFormulaBodyTexture(origMap, hex);
          mat.needsUpdate = true;
        }
      } else if (cfg.preserveBakedTexture) {
        mat.color.setHex(0xffffff);
        const origMap = mat.userData.origBakedMap as THREE.Texture | undefined;
        if (origMap) {
          mat.map = getRecoloredBusTexture(origMap, hex);
          mat.needsUpdate = true;
        }
      } else {
        mat.color.set(resolveBodyTint(cfg, hex));
      }
    }
  };

  const rig: VehicleRig = {
    root,
    bodyGroup,
    frontLeftPivot,
    frontRightPivot,
    wheels,
    steeringWheel,
    gearShifter,
    driver,
    paintMaterial,
    brakeLightMaterial,
    reverseLightMaterial,
    headlightMaterial,
    leftIndicatorMaterial,
    rightIndicatorMaterial,
    headlightCones,
    sideCamOffset: cfg.isBus
      ? [7.8, 1.85, 0.2]
      : cfg.isFormula
      ? [4.35, 0.86, 0.1]
      : cfg.isSports
      ? [4.4, 0.88, 0.15]
      : [4.5, 0.98, 0.15],
    halfWidth: cfg.defaultHalfWidth,
    halfLength: cfg.defaultHalfLength,
    wheelRadius: cfg.defaultWheelRadius,
    driverEyeOffset: cfg.isBus
      ? [0.68, 2.28, -4.84]
      : cfg.isFormula
      ? [0.0, 0.88, 0.16]
      : cfg.isSports
      ? [-0.36, 0.92, -0.05]
      : [0.38, 1.24, -0.08],
    steeringEyeOffset: cfg.isBus
      ? [0.68, 2.15, -4.82]
      : cfg.isFormula
      ? [0.0, 0.78, -0.02]
      : cfg.isSports
      ? [-0.36, 0.84, 0.12]
      : [0.38, 1.15, 0.1],
    steeringLookZ: -7.5,
    frontCamOffset: cfg.isBus
      ? [0.0, 1.35, -5.0]
      : cfg.isFormula
      ? [0.0, 0.56, -2.62]
      : cfg.isSports
      ? [0.0, 0.56, -2.5]
      : [0.0, 0.86, -2.35],
    chaseCamOffset: cfg.isBus
      ? [0.0, 4.15, 12.2]
      : cfg.isFormula
      ? [0.0, 1.88, 5.65]
      : cfg.isSports
      ? [0.0, 1.92, 5.55]
      : [0.0, 2.32, 6.2],
    setPaintColor: applyPaintHex,
    updateVisuals: ({
      steerAngle,
      wheelSpinRad,
      braking,
      reversing = false,
      headlightsOn,
      highBeamOn = false,
      leftBlinkOn = false,
      rightBlinkOn = false,
      hazardActive = false,
      hazardBlinkOn = false,
      pitchRad,
      rollRad,
      heaveY,
      gearShiftAnim,
      roadBump,
      hideDriverHead,
      exhaustFlame = 0,
    }) => {
      if (parts) {
        if (parts.wheelFLPivot) parts.wheelFLPivot.rotation.y = steerAngle;
        if (parts.wheelFRPivot) parts.wheelFRPivot.rotation.y = steerAngle;
        for (const wTarget of parts.wheelSpinTargets) {
          wTarget.rotation.x = -wheelSpinRad;
        }
        const swAngle = steerAngle * 3.1;
        if (parts.steeringPivot) {
          parts.steeringPivot.rotation.z = swAngle;
        }
        const lightsActive = headlightsOn || highBeamOn;
        for (const hMat of parts.headlightMaterials) {
          hMat.emissive.setHex(lightsActive ? 0xfef3c7 : 0x000000);
          hMat.emissiveIntensity = highBeamOn ? 1.1 : headlightsOn ? 0.52 : 0;
        }
        for (const tMat of parts.taillightMaterials) {
          tMat.emissiveIntensity = braking ? 2.1 : 0.55;
        }
        for (const lInd of parts.leftIndMaterials) {
          lInd.emissiveIntensity = (hazardActive && hazardBlinkOn) || leftBlinkOn ? 3.2 : 0.08;
        }
        for (const rInd of parts.rightIndMaterials) {
          rInd.emissiveIntensity = (hazardActive && hazardBlinkOn) || rightBlinkOn ? 3.2 : 0.08;
        }
      }

      bodyGroup.position.y = heaveY;
      bodyGroup.rotation.x = pitchRad;
      bodyGroup.rotation.z = rollRad;

      driver.updatePose(
        steerAngle * 3.1,
        -steerAngle / 0.45,
        gearShiftAnim,
        roadBump,
        hideDriverHead,
      );

      const lightsActive = headlightsOn || highBeamOn;
      brakeLightMaterial.emissiveIntensity = braking ? 2.1 : 0.55;
      reverseLightMaterial.emissiveIntensity = reversing ? 2.0 : 0.05;
      headlightMaterial.emissive.setHex(lightsActive ? 0xfef3c7 : 0x000000);
      headlightMaterial.emissiveIntensity = highBeamOn ? 1.15 : headlightsOn ? 0.55 : 0;
      leftIndicatorMaterial.emissiveIntensity =
        (hazardActive && hazardBlinkOn) || leftBlinkOn ? 3.2 : 0.08;
      rightIndicatorMaterial.emissiveIntensity =
        (hazardActive && hazardBlinkOn) || rightBlinkOn ? 3.2 : 0.08;

      // Never draw flat white ground patches in front of vehicles
      headlightCones.visible = false;
      headlightSpot.intensity = highBeamOn ? 2.0 : headlightsOn ? 0.85 : 0;
      headlightSpot.distance = highBeamOn ? 64 : 44;

      exhaustFlames?.setIntensity(exhaustFlame, performance.now() * 0.001);
    },
    dispose: () => {
      disposed = true;
      exhaustFlames?.dispose();
      exhaustFlames = null;
      driver.dispose();
      disposeVehicleObjectMaterials(
        parts?.clonedMaterials ?? [],
        [
          shadowMat,
          beamMat,
          paintMaterial,
          brakeLightMaterial,
          reverseLightMaterial,
          headlightMaterial,
          leftIndicatorMaterial,
          rightIndicatorMaterial,
        ],
        [shadowGeo, beamGeo],
      );
    },
  };

  loadValidatedGlb(cfg.url, cfg.diskPath, cfg.label)
    .then((gltf) => {
      if (disposed) return;
      const modelScene = gltf.scene.clone(true);
      const mounted = mountAlignedAndProcessedGlb(
        bodyGroup,
        unsprungWheelsGroup,
        modelScene,
        cfg,
        { isTraffic: false },
      );
      const { size } = mounted;
      parts = mounted.parts;
      bodyGroup.updateMatrixWorld(true);

      rig.halfWidth = size.x * 0.49;
      rig.halfLength = size.z * 0.49;
      if (parts.detectedWheelRadius) {
        rig.wheelRadius = parts.detectedWheelRadius;
      }

      // Attach exhaust flames ONLY to combustion performance vehicles (Lamborghini), never Bus or EV Formula E
      if (!cfg.isBus && !cfg.isFormula) {
        let outlets = [
          { x: -0.082, y: 0.319, z: 2.21, scale: 1.06 },
          { x: 0.082, y: 0.319, z: 2.21, scale: 1.06 },
        ];
        const exhaustNode = modelScene.getObjectByName('exhaust1');
        if (exhaustNode) {
          exhaustNode.updateMatrixWorld(true);
          const localBox = new THREE.Box3();
          const invBody = new THREE.Matrix4().copy(bodyGroup.matrixWorld).invert();
          const relMat = new THREE.Matrix4();
          const meshBox = new THREE.Box3();
          exhaustNode.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
              if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
              if (child.geometry.boundingBox) {
                relMat.multiplyMatrices(invBody, child.matrixWorld);
                meshBox.copy(child.geometry.boundingBox).applyMatrix4(relMat);
                localBox.union(meshBox);
              }
            }
          });
          if (!localBox.isEmpty()) {
            const cx = (localBox.min.x + localBox.max.x) * 0.5;
            const cy = (localBox.min.y + localBox.max.y) * 0.5;
            const spanX = Math.abs(localBox.max.x - localBox.min.x);
            const halfTipOffset = THREE.MathUtils.clamp(spanX * 0.25, 0.065, 0.11);
            const tipZ = localBox.max.z + 0.01;
            outlets = [
              { x: cx - halfTipOffset, y: cy, z: tipZ, scale: 1.06 },
              { x: cx + halfTipOffset, y: cy, z: tipZ, scale: 1.06 },
            ];
          }
        }
        exhaustFlames = new ExhaustFlameSystem(outlets);
        bodyGroup.add(exhaustFlames.group);
      }

      if (parts.steeringCenterBodyLocal && !cfg.preserveBakedTexture) {
        const sc = parts.steeringCenterBodyLocal;
        if (!cfg.isSports && !cfg.isFormula) {
          bodyGroup.remove(driver.root);
          driver.dispose();
          driver = createRealisticDriver(0x374151, sc, 0.155, 0.34);
          driver.root.visible = true;
          bodyGroup.add(driver.root);
          rig.driver = driver;
        }
        rig.driverEyeOffset = [
          cfg.isFormula ? 0.0 : sc.x,
          cfg.isFormula
            ? Math.min(size.y - 0.12, sc.y + 0.3)
            : Math.min(size.y - 0.14, sc.y + (cfg.isSports ? 0.24 : 0.32)),
          sc.z + (cfg.isFormula ? 0.5 : 0.34),
        ];
        rig.steeringEyeOffset = [
          cfg.isFormula ? 0.0 : sc.x,
          cfg.isFormula
            ? Math.min(size.y - 0.16, sc.y + 0.21)
            : Math.min(size.y - 0.18, sc.y + (cfg.isSports ? 0.18 : 0.22)),
          sc.z + (cfg.isFormula ? 0.34 : 0.52),
        ];
      }

      glbMounted = true;
      applyPaintHex(latestPaintHex);
      onLoaded?.();
    })
    .catch((err) => {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(msg);
      onError?.(msg);
    });

  return rig;
}

interface CachedTrafficWheelTemplate {
  steerPos: THREE.Vector3;
  isFL: boolean;
  isFR: boolean;
  spinBuckets: MergedBucket[];
  caliperBuckets: MergedBucket[];
}

interface CachedTrafficKindTemplate {
  size: THREE.Vector3;
  halfWidth: number;
  halfLength: number;
  wheelRadius: number;
  bodyBuckets: {
    bucket: MergedBucket;
    role: 'paint' | 'headlight' | 'taillight' | 'leftInd' | 'rightInd' | 'static';
  }[];
  wheels: CachedTrafficWheelTemplate[];
}

const trafficTemplateCache = new Map<TrafficVehicleKind, Promise<CachedTrafficKindTemplate>>();
const sharedTrafficPaintMatCache = new Map<string, THREE.Material>();

function getOrBuildTrafficKindTemplate(
  kind: TrafficVehicleKind,
  cfg: GlbVehicleConfig,
): Promise<CachedTrafficKindTemplate> {
  const existing = trafficTemplateCache.get(kind);
  if (existing) return existing;

  const promise = loadValidatedGlb(cfg.url, cfg.diskPath, cfg.label).then((gltf) => {
    const stagingRoot = new THREE.Group();
    const stagingUnsprung = new THREE.Group();
    const stagingBody = new THREE.Group();
    stagingRoot.add(stagingUnsprung, stagingBody);

    const modelScene = gltf.scene.clone(true);
    const { alignedWrapper, size } = alignAndScaleModel(modelScene, cfg);
    stagingBody.add(alignedWrapper);
    stagingRoot.updateMatrixWorld(true);

    const parts = processGlbScene(
      stagingRoot,
      stagingBody,
      stagingUnsprung,
      modelScene,
      cfg,
      { isTraffic: true },
    );

    const paintSet = new Set<THREE.Material>(parts.paintMaterials);
    const headSet = new Set<THREE.Material>(parts.headlightMaterials);
    const tailSet = new Set<THREE.Material>(parts.taillightMaterials);
    const leftSet = new Set<THREE.Material>(parts.leftIndMaterials);
    const rightSet = new Set<THREE.Material>(parts.rightIndMaterials);

    const classifyMat = (
      mat: THREE.Material,
    ): 'paint' | 'headlight' | 'taillight' | 'leftInd' | 'rightInd' | 'static' => {
      if (paintSet.has(mat)) return 'paint';
      if (headSet.has(mat)) return 'headlight';
      if (tailSet.has(mat)) return 'taillight';
      if (leftSet.has(mat)) return 'leftInd';
      if (rightSet.has(mat)) return 'rightInd';
      return 'static';
    };

    // Merge all static body meshes sharing the exact same material ONCE
    const { merged: rawBodyMerged, passthrough } = mergeMeshesByMaterial(stagingBody);
    const bodyBuckets: CachedTrafficKindTemplate['bodyBuckets'] = rawBodyMerged.map((b) => ({
      bucket: b,
      role: classifyMat(b.material),
    }));
    for (const pm of passthrough) {
      const m = Array.isArray(pm.material) ? pm.material[0] : pm.material;
      bodyBuckets.push({
        bucket: {
          geometry: pm.geometry,
          material: pm.material as THREE.Material,
          renderOrder: pm.renderOrder,
          visible: pm.visible,
        },
        role: m ? classifyMat(m) : 'static',
      });
    }

    // Merge each wheel assembly's sub-primitives ONCE relative to its steer/spin pivot
    const wheels: CachedTrafficWheelTemplate[] = [];
    for (const steerPivot of stagingUnsprung.children) {
      const spinPivot = steerPivot.children[0];
      if (!spinPivot) continue;
      const spinSet = new Set<THREE.Object3D>([spinPivot]);
      const { merged: caliperMerged } = mergeMeshesByMaterial(steerPivot, spinSet);
      const { merged: spinMerged } = mergeMeshesByMaterial(spinPivot);
      wheels.push({
        steerPos: steerPivot.position.clone(),
        isFL: steerPivot === parts.wheelFLPivot,
        isFR: steerPivot === parts.wheelFRPivot,
        spinBuckets: spinMerged,
        caliperBuckets: caliperMerged,
      });
    }

    return {
      size,
      halfWidth: size.x * 0.49,
      halfLength: size.z * 0.49,
      wheelRadius: parts.detectedWheelRadius ?? cfg.defaultWheelRadius,
      bodyBuckets,
      wheels,
    };
  });

  trafficTemplateCache.set(kind, promise);
  return promise;
}

/**
 * Builds an AI Highway Traffic vehicle rig backed by a cached, geometry-merged .glb template.
 * Shares immutable geometries & non-animated materials across pooled traffic vehicles so 16 traffic cars
 * use minimal draw calls, shader programs, and GPU VRAM.
 */
export function buildTrafficGlbRig(
  kind: TrafficVehicleKind,
  paintHex: string,
  contactShadowMap: THREE.Texture,
  options?: {
    onError?: (message: string, diskPath: string) => void;
    onLoaded?: () => void;
  },
): TrafficVehicleRig {
  const cfg = TRAFFIC_GLB_CONFIG[kind];
  const root = new THREE.Group();
  root.name = `Traffic_${kind}_GLBRoot`;
  root.visible = false;

  const shadowGeo = new THREE.PlaneGeometry(
    cfg.defaultHalfWidth * 2.35,
    cfg.defaultHalfLength * 2.2,
  );
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowMap,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.015;
  root.add(shadow);

  const unsprungWheelsGroup = new THREE.Group();
  root.add(unsprungWheelsGroup);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const leftIndMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.06,
    roughness: 0.2,
  });
  const rightIndMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.06,
    roughness: 0.2,
  });
  const lampGeo = new THREE.BoxGeometry(0.14, 0.1, 0.08);

  const perRigMaterials: THREE.Material[] = [];
  const headlightMaterials: THREE.MeshStandardMaterial[] = [];
  const taillightMaterials: THREE.MeshStandardMaterial[] = [];
  const leftIndMaterials: THREE.MeshStandardMaterial[] = [];
  const rightIndMaterials: THREE.MeshStandardMaterial[] = [];
  let wheelFLPivot: THREE.Object3D | null = null;
  let wheelFRPivot: THREE.Object3D | null = null;
  const wheelSpinTargets: THREE.Object3D[] = [];
  let disposed = false;

  const rig: TrafficVehicleRig = {
    root,
    kind,
    label: cfg.label,
    halfWidth: cfg.defaultHalfWidth,
    halfLength: cfg.defaultHalfLength,
    wheelRadius: cfg.defaultWheelRadius,
    loaded: false,
    updateVisuals: ({
      wheelSpinRad,
      steerAngle = 0,
      braking,
      headlightsOn,
      leftBlink,
      rightBlink,
      hazardBlink,
    }) => {
      if (!rig.loaded || disposed) return;
      const leftIntensity = hazardBlink || leftBlink ? 3.8 : 0.06;
      const rightIntensity = hazardBlink || rightBlink ? 3.8 : 0.06;
      leftIndMat.emissiveIntensity = leftIntensity;
      rightIndMat.emissiveIntensity = rightIntensity;

      if (wheelFLPivot) wheelFLPivot.rotation.y = steerAngle;
      if (wheelFRPivot) wheelFRPivot.rotation.y = steerAngle;
      for (const wTarget of wheelSpinTargets) {
        wTarget.rotation.x = -wheelSpinRad;
      }
      for (const hMat of headlightMaterials) {
        hMat.emissive.setHex(headlightsOn ? 0xfef3c7 : 0x000000);
        hMat.emissiveIntensity = headlightsOn ? 0.48 : 0;
      }
      for (const tMat of taillightMaterials) {
        tMat.emissiveIntensity = braking ? 2.1 : 0.55;
      }
      for (const lInd of leftIndMaterials) {
        lInd.emissiveIntensity = leftIntensity;
      }
      for (const rInd of rightIndMaterials) {
        rInd.emissiveIntensity = rightIntensity;
      }
    },
    dispose: () => {
      disposed = true;
      disposeVehicleObjectMaterials(
        perRigMaterials,
        [shadowMat, leftIndMat, rightIndMat],
        [shadowGeo, lampGeo],
      );
    },
  };

  getOrBuildTrafficKindTemplate(kind, cfg)
    .then((tpl) => {
      if (disposed) return;

      const resolvedPaint = (paintHex || '').trim().toLowerCase();
      const matCloneMap = new Map<THREE.Material, THREE.Material>();

      const resolveRigMaterial = (
        srcMat: THREE.Material,
        role: 'paint' | 'headlight' | 'taillight' | 'leftInd' | 'rightInd' | 'static',
      ): THREE.Material => {
        if (role === 'static' || Array.isArray(srcMat)) {
          return srcMat;
        }
        if (role === 'paint') {
          const paintKey = `${kind}:${srcMat.uuid}:${resolvedPaint}`;
          let sharedPaint = sharedTrafficPaintMatCache.get(paintKey);
          if (!sharedPaint) {
            sharedPaint = srcMat.clone();
            if (sharedPaint instanceof THREE.MeshStandardMaterial) {
              if (cfg.preserveBakedTexture) {
                sharedPaint.color.setHex(0xffffff);
                const origMap =
                  srcMat instanceof THREE.MeshStandardMaterial ? srcMat.map : null;
                if (origMap && resolvedPaint) {
                  sharedPaint.map = getRecoloredBusTexture(origMap, paintHex);
                  sharedPaint.needsUpdate = true;
                }
              } else if (paintHex) {
                sharedPaint.color.set(resolveBodyTint(cfg, paintHex));
              }
            }
            sharedTrafficPaintMatCache.set(paintKey, sharedPaint);
          }
          return sharedPaint;
        }

        let cloned = matCloneMap.get(srcMat);
        if (!cloned) {
          cloned = srcMat.clone();
          matCloneMap.set(srcMat, cloned);
          perRigMaterials.push(cloned);
          if (cloned instanceof THREE.MeshStandardMaterial) {
            if (role === 'headlight') headlightMaterials.push(cloned);
            else if (role === 'taillight') taillightMaterials.push(cloned);
            else if (role === 'leftInd') leftIndMaterials.push(cloned);
            else if (role === 'rightInd') rightIndMaterials.push(cloned);
          }
        }
        return cloned;
      };

      for (const entry of tpl.bodyBuckets) {
        const mat = resolveRigMaterial(entry.bucket.material, entry.role);
        const mesh = new THREE.Mesh(entry.bucket.geometry, mat);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = entry.bucket.renderOrder;
        mesh.visible = entry.bucket.visible;
        bodyGroup.add(mesh);
      }

      for (const w of tpl.wheels) {
        const steerPivot = new THREE.Group();
        steerPivot.position.copy(w.steerPos);
        unsprungWheelsGroup.add(steerPivot);

        for (const cb of w.caliperBuckets) {
          const cMesh = new THREE.Mesh(cb.geometry, cb.material);
          cMesh.castShadow = false;
          cMesh.receiveShadow = false;
          steerPivot.add(cMesh);
        }

        const spinPivot = new THREE.Group();
        steerPivot.add(spinPivot);
        for (const sb of w.spinBuckets) {
          const sMesh = new THREE.Mesh(sb.geometry, sb.material);
          sMesh.castShadow = false;
          sMesh.receiveShadow = false;
          spinPivot.add(sMesh);
        }

        if (w.isFL && !wheelFLPivot) wheelFLPivot = steerPivot;
        if (w.isFR && !wheelFRPivot) wheelFRPivot = steerPivot;
        wheelSpinTargets.push(spinPivot);
      }

      rig.halfWidth = tpl.halfWidth;
      rig.halfLength = tpl.halfLength;
      rig.wheelRadius = tpl.wheelRadius;
      shadow.scale.set(
        (tpl.size.x * 1.18) / (cfg.defaultHalfWidth * 2.35),
        (tpl.size.z * 1.1) / (cfg.defaultHalfLength * 2.2),
        1,
      );

      // Mount compact corner amber turn-signal lamps if GLB lacks named indicator meshes
      if (leftIndMaterials.length === 0 || rightIndMaterials.length === 0) {
        const indicatorGroup = new THREE.Group();
        const cornerX = Math.max(0.55, rig.halfWidth * 0.84);
        const cornerZ = Math.max(1.2, rig.halfLength * 0.96);
        const lampY = Math.min(1.05, tpl.size.y * 0.42);
        for (const s of [-1, 1]) {
          const mat = s < 0 ? leftIndMat : rightIndMat;
          const frontLamp = new THREE.Mesh(lampGeo, mat);
          frontLamp.position.set(s * cornerX, lampY, -cornerZ);
          indicatorGroup.add(frontLamp);

          const rearLamp = new THREE.Mesh(lampGeo, mat);
          rearLamp.position.set(s * cornerX, lampY, cornerZ);
          indicatorGroup.add(rearLamp);
        }
        bodyGroup.add(indicatorGroup);
      }

      rig.loaded = true;
      root.visible = true;
      options?.onLoaded?.();
    })
    .catch((err) => {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      options?.onError?.(msg, cfg.diskPath);
    });

  return rig;
}
