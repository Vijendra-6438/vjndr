import * as THREE from 'three';
import { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  loadValidatedGlb,
  MergedBucket,
  mergeMeshesByMaterial,
} from './vehicleGlbLoader';

export const TUNNEL_GLB_URL = '/d95584df70fe4b65bbef8c2323391e4f.glb';
export const TUNNEL_GLB_DISK_PATH = '/public/d95584df70fe4b65bbef8c2323391e4f.glb';
export const TUNNEL_SEGMENT_LEN = 14.0;
export const TUNNEL_SUBSEG_LEN = 7.0;
export const TUNNEL_BASE_ROAD_WIDTH = 14.0;

export type TunnelStyle = 'A' | 'B' | 'C';

export interface TunnelKitTemplates {
  styles: Record<
    TunnelStyle,
    {
      entrance: THREE.Group;
      straight: THREE.Group;
      entranceBuckets: MergedBucket[];
      straightBuckets: MergedBucket[];
    }
  >;
  lightFixture: THREE.Group;
  airVent: THREE.Group;
  lightBuckets: MergedBucket[];
  ventBuckets: MergedBucket[];
}

let tunnelGltfPromise: Promise<GLTF> | null = null;
let cachedTemplates: TunnelKitTemplates | null = null;
let lastTunnelError: string | null = null;

export function getTunnelGlbError(): string | null {
  return lastTunnelError;
}

export function preloadTunnelGlb(): Promise<GLTF> {
  if (!tunnelGltfPromise) {
    tunnelGltfPromise = loadValidatedGlb(
      TUNNEL_GLB_URL,
      TUNNEL_GLB_DISK_PATH,
      'Mountain Highway Tunnel',
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      lastTunnelError = msg;
      tunnelGltfPromise = null;
      throw err;
    });
  }
  return tunnelGltfPromise;
}

function calibrateTunnelMaterials(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial) || seen.has(mat)) continue;
      seen.add(mat);

      const mName = (mat.name || '').toLowerCase();
      if (mName === 'light') {
        mat.alphaTest = 0;
        mat.transparent = false;
        mat.color.setHex(0xfff7e2);
        mat.emissive.setHex(0xffe19c);
        mat.emissiveIntensity = 1.9;
        mat.roughness = 0.25;
        mat.metalness = 0.0;
        mat.envMapIntensity = 0.22;
      } else if (mName === 'glass') {
        mat.alphaTest = 0;
        mat.transparent = true;
        mat.opacity = 0.78;
        mat.color.setHex(0xfef3c7);
        mat.emissive.setHex(0xffd888);
        mat.emissiveIntensity = 0.55;
        mat.roughness = 0.16;
        mat.metalness = 0.04;
        mat.envMapIntensity = 0.38;
      } else if (mName === 'whitetiles') {
        mat.alphaTest = 0;
        mat.transparent = false;
        mat.roughness = 0.36;
        mat.envMapIntensity = 0.38;
      } else if (mName === 'sidewalk') {
        mat.alphaTest = 0;
        mat.transparent = false;
        mat.color.setHex(0xbab6ae);
        mat.roughness = 0.88;
        mat.envMapIntensity = 0.22;
      } else {
        // Opaque architectural concrete / stone / steel / sidewalk
        mat.alphaTest = 0;
        mat.transparent = false;
        mat.roughness = Math.max(mat.roughness ?? 0.82, 0.76);
        mat.envMapIntensity = 0.22;
      }
      mat.needsUpdate = true;
    }
  });
}

function buildGroupFromMergedBuckets(
  buckets: MergedBucket[],
  receiveShadow: boolean,
): THREE.Group {
  const g = new THREE.Group();
  for (const b of buckets) {
    const mesh = new THREE.Mesh(b.geometry, b.material);
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    mesh.renderOrder = b.renderOrder;
    mesh.visible = b.visible;
    g.add(mesh);
  }
  return g;
}

function extractNormalizedPiece(
  sceneRoot: THREE.Object3D,
  nodeName: string,
  xOffset: number,
  zOffset: number,
  rotateYPi: boolean,
  omitRoadMesh: boolean,
): { group: THREE.Group; buckets: MergedBucket[] } {
  const src = sceneRoot.getObjectByName(nodeName);
  if (!src) {
    throw new Error(
      `Tunnel GLB (${TUNNEL_GLB_DISK_PATH}) is missing expected node "${nodeName}"`,
    );
  }

  const pieceClone = src.clone(true);
  if (omitRoadMesh) {
    pieceClone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const lowerName = (mesh.name || '').toLowerCase();
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const matName = (mat?.name || '').toLowerCase();
      if (lowerName.includes('_road_') || matName === 'road') {
        // Keep the existing curved mountain highway asphalt & lane markings unobstructed
        mesh.visible = false;
      } else {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      }
    });
  } else {
    pieceClone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    });
  }

  // Center locally around X=0, Y=0, Z in [-7, +7]
  const wrapper = new THREE.Group();
  const aligner = new THREE.Group();
  pieceClone.position.x += xOffset;
  aligner.add(pieceClone);

  if (rotateYPi) {
    aligner.rotation.y = Math.PI;
  }
  aligner.position.z = zOffset;
  wrapper.add(aligner);

  const { merged, passthrough } = mergeMeshesByMaterial(wrapper);
  const buckets = [...merged];
  for (const pm of passthrough) {
    buckets.push({
      geometry: pm.geometry,
      material: pm.material as THREE.Material,
      renderOrder: pm.renderOrder,
      visible: pm.visible,
    });
  }

  return {
    group: buildGroupFromMergedBuckets(buckets, true),
    buckets,
  };
}

export async function getTunnelKitTemplates(): Promise<TunnelKitTemplates> {
  if (cachedTemplates) return cachedTemplates;
  const gltf = await preloadTunnelGlb();
  calibrateTunnelMaterials(gltf.scene);

  const buildStyle = (
    style: TunnelStyle,
    xCenterOffset: number,
  ): {
    entrance: THREE.Group;
    straight: THREE.Group;
    entranceBuckets: MergedBucket[];
    straightBuckets: MergedBucket[];
  } => {
    const ent = extractNormalizedPiece(
      gltf.scene,
      `Entrance${style}`,
      xCenterOffset,
      0,
      false,
      true,
    );
    const str = extractNormalizedPiece(
      gltf.scene,
      `Straight${style}`,
      xCenterOffset,
      0,
      false,
      true,
    );
    return {
      entrance: ent.group,
      straight: str.group,
      entranceBuckets: ent.buckets,
      straightBuckets: str.buckets,
    };
  };

  // Light01 has node translation [-72.5, 0, 0] while its geometry is already centered at [0,0,0]
  const lightSrc = gltf.scene.getObjectByName('Light01');
  if (!lightSrc) {
    throw new Error(
      `Tunnel GLB (${TUNNEL_GLB_DISK_PATH}) is missing expected fixture "Light01"`,
    );
  }
  const rawLightFixture = new THREE.Group();
  const lightPiece = lightSrc.clone(true);
  lightPiece.position.set(0, 0, 0);
  lightPiece.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  });
  rawLightFixture.add(lightPiece);
  const { merged: lightMerged } = mergeMeshesByMaterial(rawLightFixture);
  const lightFixture = buildGroupFromMergedBuckets(lightMerged, false);

  // AirVents01 is centered at x=0, z=[-9,-5] -> shift +7m on Z to sit inside Straight [-7,+7]
  const ventSrc = gltf.scene.getObjectByName('AirVents01');
  if (!ventSrc) {
    throw new Error(
      `Tunnel GLB (${TUNNEL_GLB_DISK_PATH}) is missing expected prop "AirVents01"`,
    );
  }
  const rawAirVent = new THREE.Group();
  const ventPiece = ventSrc.clone(true);
  ventPiece.position.z += 7.0;
  ventPiece.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    }
  });
  rawAirVent.add(ventPiece);
  const { merged: ventMerged } = mergeMeshesByMaterial(rawAirVent);
  const airVent = buildGroupFromMergedBuckets(ventMerged, true);

  cachedTemplates = {
    styles: {
      A: buildStyle('A', 0),
      B: buildStyle('B', 25.0),
      C: buildStyle('C', 50.0),
    },
    lightFixture,
    airVent,
    lightBuckets: lightMerged,
    ventBuckets: ventMerged,
  };
  return cachedTemplates;
}

/**
 * Clones one reusable 14m tunnel module (entry portal, straight bore, or exit portal)
 * sharing all GLB BufferGeometries and Materials, fitted with GLB ceiling Light01 fixtures.
 */
export function cloneTunnelSegmentWithFixtures(
  templates: TunnelKitTemplates,
  style: TunnelStyle,
  role: 'entry' | 'straight' | 'exit',
  withAirVents: boolean,
): THREE.Group {
  const segment = new THREE.Group();
  const styleSet = templates.styles[style];

  if (role === 'entry') {
    // Rotate 180° around Y and shift -14m on Z so outer portal facade (-21.76..-7) maps to (+7..+21.76 -> -7..+7)
    // Facing +Z (backward toward approaching traffic) and joining Straight at -7!
    const archWrap = new THREE.Group();
    const archClone = styleSet.entrance.clone(true);
    archClone.rotation.y = Math.PI;
    archClone.position.z = -14.0;
    archWrap.add(archClone);
    segment.add(archWrap);
  } else if (role === 'exit') {
    // Keep outer portal facade facing -Z (outward into exit valley), shift +14m so [-21,-7] maps to [-7,+7]
    const archWrap = new THREE.Group();
    const archClone = styleSet.entrance.clone(true);
    archClone.position.z = 14.0;
    archWrap.add(archClone);
    segment.add(archWrap);
  } else {
    segment.add(styleSet.straight.clone(true));
    if (withAirVents) {
      segment.add(templates.airVent.clone(true));
    }
  }

  // Mount warm-white GLB ceiling Light01 fixtures flush along the tunnel vault arch
  const zOffsets = role === 'entry' ? [-1.5] : role === 'exit' ? [1.5] : [-3.5, 3.5];
  for (const lz of zOffsets) {
    for (const side of [-1, 1]) {
      const lamp = templates.lightFixture.clone(true);
      lamp.position.set(side * 3.65, 10.56, lz);
      lamp.rotation.z = -side * 0.19;
      segment.add(lamp);
    }
  }

  return segment;
}

/**
 * Clones one reusable 7m curved interior tunnel sub-segment as separate shell + un-squished fixtures,
 * allowing smooth curved Z-chords without distorting ceiling Light01 housings or AirVents01.
 */
export function cloneTunnelCurvedSubSegment(
  templates: TunnelKitTemplates,
  style: TunnelStyle,
  withAirVents: boolean,
): { shell: THREE.Group; fixtures: THREE.Group } {
  const styleSet = templates.styles[style];
  const shell = styleSet.straight.clone(true);
  const fixtures = new THREE.Group();

  for (const side of [-1, 1]) {
    const lamp = templates.lightFixture.clone(true);
    lamp.position.set(side * 3.65, 10.56, 0);
    lamp.rotation.z = -side * 0.19;
    fixtures.add(lamp);
  }

  if (withAirVents) {
    fixtures.add(templates.airVent.clone(true));
  }

  return { shell, fixtures };
}
