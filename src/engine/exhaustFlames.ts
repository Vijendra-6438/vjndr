import * as THREE from 'three';

export interface ExhaustOutletSpec {
  x: number;
  y: number;
  z: number;
  scale?: number;
}

let sharedOuterFlameTex: THREE.CanvasTexture | null = null;
let sharedInnerBlueTex: THREE.CanvasTexture | null = null;
let sharedTipGlowTex: THREE.CanvasTexture | null = null;

function getExhaustTextures(): {
  outerTex: THREE.CanvasTexture;
  innerTex: THREE.CanvasTexture;
  glowTex: THREE.CanvasTexture;
} {
  if (!sharedOuterFlameTex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    // UV y=0 is cone base (at exhaust pipe mouth), y=1 is cone tip (trailing behind)
    // Canvas y=128 corresponds to v=0 (base), y=0 corresponds to v=1 (tip)
    const grad = ctx.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0.0, 'rgba(255, 248, 210, 0.96)');
    grad.addColorStop(0.22, 'rgba(253, 224, 71, 0.94)');
    grad.addColorStop(0.54, 'rgba(249, 115, 22, 0.78)');
    grad.addColorStop(0.82, 'rgba(234, 88, 12, 0.32)');
    grad.addColorStop(1.0, 'rgba(234, 88, 12, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 128);

    // Subtle longitudinal flame streaks for natural combustion variation
    ctx.globalCompositeOperation = 'destination-in';
    const horiz = ctx.createLinearGradient(0, 0, 64, 0);
    horiz.addColorStop(0.0, 'rgba(255,255,255,0.65)');
    horiz.addColorStop(0.25, 'rgba(255,255,255,1.0)');
    horiz.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    horiz.addColorStop(0.75, 'rgba(255,255,255,1.0)');
    horiz.addColorStop(1.0, 'rgba(255,255,255,0.65)');
    ctx.fillStyle = horiz;
    ctx.fillRect(0, 0, 64, 128);

    sharedOuterFlameTex = new THREE.CanvasTexture(c);
    sharedOuterFlameTex.colorSpace = THREE.SRGBColorSpace;
  }

  if (!sharedInnerBlueTex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0.0, 'rgba(224, 242, 254, 1.0)');
    grad.addColorStop(0.32, 'rgba(96, 165, 250, 0.92)');
    grad.addColorStop(0.72, 'rgba(59, 130, 246, 0.45)');
    grad.addColorStop(1.0, 'rgba(37, 99, 235, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 128);

    sharedInnerBlueTex = new THREE.CanvasTexture(c);
    sharedInnerBlueTex.colorSpace = THREE.SRGBColorSpace;
  }

  if (!sharedTipGlowTex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const rad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    rad.addColorStop(0.0, 'rgba(255, 237, 179, 0.85)');
    rad.addColorStop(0.45, 'rgba(249, 115, 22, 0.38)');
    rad.addColorStop(1.0, 'rgba(249, 115, 22, 0.0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 64, 64);

    sharedTipGlowTex = new THREE.CanvasTexture(c);
    sharedTipGlowTex.colorSpace = THREE.SRGBColorSpace;
  }

  return {
    outerTex: sharedOuterFlameTex,
    innerTex: sharedInnerBlueTex,
    glowTex: sharedTipGlowTex,
  };
}

interface OutletNodes {
  pivot: THREE.Group;
  outerMesh: THREE.Mesh;
  innerMesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  baseScale: number;
}

/**
 * Lightweight, pooled exhaust-outlet flame burst renderer attached to a player vehicle's bodyGroup.
 * Renders zero draw calls when inactive and adds zero dynamic scene lights.
 */
export class ExhaustFlameSystem {
  public readonly group: THREE.Group;
  private outlets: OutletNodes[] = [];
  private outerMat: THREE.MeshBasicMaterial;
  private innerMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private geometries: THREE.BufferGeometry[] = [];

  constructor(specs: ExhaustOutletSpec[]) {
    this.group = new THREE.Group();
    this.group.name = 'PlayerExhaustFlames';
    this.group.visible = false;

    const { outerTex, innerTex, glowTex } = getExhaustTextures();

    this.outerMat = new THREE.MeshBasicMaterial({
      map: outerTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.innerMat = new THREE.MeshBasicMaterial({
      map: innerTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Shared tapered flame cones pointing backward (+Z) from pipe lip
    const outerGeo = new THREE.ConeGeometry(0.068, 0.42, 10, 1, true);
    outerGeo.rotateX(Math.PI * 0.5);
    outerGeo.translate(0, 0, 0.21);

    const innerGeo = new THREE.ConeGeometry(0.036, 0.21, 8, 1, true);
    innerGeo.rotateX(Math.PI * 0.5);
    innerGeo.translate(0, 0, 0.105);

    const glowGeo = new THREE.PlaneGeometry(0.19, 0.19);
    glowGeo.translate(0, 0, 0.025);

    this.geometries.push(outerGeo, innerGeo, glowGeo);

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const baseScale = s.scale ?? 1.0;
      const pivot = new THREE.Group();
      pivot.position.set(s.x, s.y, s.z);
      pivot.scale.setScalar(baseScale);

      const outerMesh = new THREE.Mesh(outerGeo, this.outerMat);
      outerMesh.renderOrder = 6;
      const innerMesh = new THREE.Mesh(innerGeo, this.innerMat);
      innerMesh.renderOrder = 7;
      const glowMesh = new THREE.Mesh(glowGeo, this.glowMat);
      glowMesh.renderOrder = 5;

      pivot.add(glowMesh, outerMesh, innerMesh);
      this.group.add(pivot);
      this.outlets.push({
        pivot,
        outerMesh,
        innerMesh,
        glowMesh,
        baseScale,
      });
    }
  }

  public setIntensity(intensity: number, timeSec: number): void {
    if (intensity <= 0.015 || this.outlets.length === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const clamped = Math.min(1.0, intensity);

    this.outerMat.opacity = 0.88 * clamped;
    this.innerMat.opacity = 0.94 * Math.min(1.0, clamped * 1.12);
    this.glowMat.opacity = 0.42 * clamped;

    for (let i = 0; i < this.outlets.length; i++) {
      const o = this.outlets[i];
      const f1 = Math.sin(timeSec * 68.0 + i * 2.17);
      const f2 = Math.cos(timeSec * 107.0 + i * 3.41);
      const lenPulse = 0.78 + 0.34 * clamped + f1 * 0.16 + f2 * 0.09;
      const radPulse = 0.85 + 0.18 * clamped + f2 * 0.1;

      o.outerMesh.scale.set(radPulse, radPulse, Math.max(0.35, lenPulse));
      o.outerMesh.rotation.set(f2 * 0.04, f1 * 0.045, timeSec * 18.0 + i);

      o.innerMesh.scale.set(
        radPulse * 0.95,
        radPulse * 0.95,
        Math.max(0.35, lenPulse * 0.92),
      );
      o.innerMesh.rotation.set(f1 * 0.03, f2 * 0.03, -timeSec * 14.0);

      const gScale = 0.88 + 0.28 * clamped + f1 * 0.12;
      o.glowMesh.scale.setScalar(gScale);
    }
  }

  public dispose(): void {
    this.outerMat.dispose();
    this.innerMat.dispose();
    this.glowMat.dispose();
    for (const g of this.geometries) {
      g.dispose();
    }
  }
}
