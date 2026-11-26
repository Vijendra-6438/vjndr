import * as THREE from 'three';
import { VehicleId } from '../types/game';

export interface ProceduralTextureSet {
  asphaltMap: THREE.CanvasTexture;
  asphaltRoughMap: THREE.CanvasTexture;
  asphaltBumpMap: THREE.CanvasTexture;
  mountainTerrainMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  rockMap: THREE.CanvasTexture;
  pineNeedleMap: THREE.CanvasTexture;
  broadleafMap: THREE.CanvasTexture;
  shrubMap: THREE.CanvasTexture;
  grassTuftMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function createProceduralTextureSet(maxAnisotropy: number): ProceduralTextureSet {
  const rand = seededRand(90421);

  // 1. Deep Charcoal-Black Mountain Highway Asphalt Albedo + Roughness + Micro-Bump
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 1024;
  asphaltCanvas.height = 1024;
  const aCtx = asphaltCanvas.getContext('2d')!;
  aCtx.fillStyle = '#0e1014';
  aCtx.fillRect(0, 0, 1024, 1024);

  // Fine crushed-basalt & bitumen aggregate grain (deep black-charcoal, never brown or bright grey)
  for (let i = 0; i < 65000; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const highlight = rand() > 0.94;
    const v = highlight ? 28 + Math.floor(rand() * 14) : 10 + Math.floor(rand() * 14);
    aCtx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
    aCtx.fillRect(x, y, 1.5, 1.5);
  }

  // Subtle darker longitudinal rubber tire wear tracks on left & right carriageways
  for (const [cx, span] of [
    [164, 112],
    [380, 112],
    [644, 112],
    [860, 112],
  ]) {
    const wg = aCtx.createLinearGradient(cx - span * 0.5, 0, cx + span * 0.5, 0);
    wg.addColorStop(0, 'rgba(0,0,0,0)');
    wg.addColorStop(0.35, 'rgba(3,4,6,0.42)');
    wg.addColorStop(0.65, 'rgba(3,4,6,0.42)');
    wg.addColorStop(1, 'rgba(0,0,0,0)');
    aCtx.fillStyle = wg;
    aCtx.fillRect(cx - span * 0.5, 0, span, 1024);
  }

  // Crisp Solid White Outer Highway Edge Lines
  aCtx.fillStyle = '#e6ecf2';
  aCtx.fillRect(28, 0, 14, 1024);
  aCtx.fillRect(982, 0, 14, 1024);

  // Double Center Highway Divider Line (Amber/Yellow Mountain Highway Median)
  aCtx.fillStyle = '#eab308';
  aCtx.fillRect(498, 0, 10, 1024);
  aCtx.fillRect(516, 0, 10, 1024);

  // Crisp White Dashed Lane Markings dividing Left & Right 2-Lane Carriageways
  aCtx.fillStyle = '#eaeff5';
  for (let y = 40; y < 1024; y += 256) {
    aCtx.fillRect(266, y, 10, 136);
    aCtx.fillRect(748, y, 10, 136);
  }

  const asphaltMap = new THREE.CanvasTexture(asphaltCanvas);
  asphaltMap.colorSpace = THREE.SRGBColorSpace;
  asphaltMap.wrapS = THREE.ClampToEdgeWrapping;
  asphaltMap.wrapT = THREE.RepeatWrapping;
  asphaltMap.anisotropy = maxAnisotropy;

  // Asphalt Roughness Map (matte aggregate with slightly smoother tire-worn paths, zero plastic shine)
  const aRoughCanvas = document.createElement('canvas');
  aRoughCanvas.width = 512;
  aRoughCanvas.height = 512;
  const arCtx = aRoughCanvas.getContext('2d')!;
  arCtx.fillStyle = '#e2e2e2';
  arCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const g = 196 + Math.floor(rand() * 52);
    arCtx.fillStyle = `rgb(${g},${g},${g})`;
    arCtx.fillRect(rand() * 512, rand() * 512, 2, 2);
  }
  for (const wx of [88, 192, 320, 424]) {
    const wg = arCtx.createLinearGradient(wx - 28, 0, wx + 28, 0);
    wg.addColorStop(0, 'rgba(220,220,220,0)');
    wg.addColorStop(0.5, 'rgba(155,155,155,0.42)');
    wg.addColorStop(1, 'rgba(220,220,220,0)');
    arCtx.fillStyle = wg;
    arCtx.fillRect(wx - 28, 0, 56, 512);
  }
  const asphaltRoughMap = new THREE.CanvasTexture(aRoughCanvas);
  asphaltRoughMap.wrapS = THREE.ClampToEdgeWrapping;
  asphaltRoughMap.wrapT = THREE.RepeatWrapping;
  asphaltRoughMap.anisotropy = maxAnisotropy;

  // Asphalt Fine Aggregate Bump Map
  const aBumpCanvas = document.createElement('canvas');
  aBumpCanvas.width = 512;
  aBumpCanvas.height = 512;
  const abCtx = aBumpCanvas.getContext('2d')!;
  abCtx.fillStyle = '#808080';
  abCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 24000; i++) {
    const g = 104 + Math.floor(rand() * 48);
    abCtx.fillStyle = `rgb(${g},${g},${g})`;
    abCtx.fillRect(rand() * 512, rand() * 512, 1.5, 1.5);
  }
  const asphaltBumpMap = new THREE.CanvasTexture(aBumpCanvas);
  asphaltBumpMap.wrapS = THREE.RepeatWrapping;
  asphaltBumpMap.wrapT = THREE.RepeatWrapping;
  asphaltBumpMap.anisotropy = maxAnisotropy;

  // 2. Lush Natural Green Mountain Meadow, Turf & Mossy Forest Grass Texture (Zero Brown Dirt)
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = 512;
  terrainCanvas.height = 512;
  const tCtx = terrainCanvas.getContext('2d')!;
  tCtx.fillStyle = '#2d4f23';
  tCtx.fillRect(0, 0, 512, 512);

  // Soft natural meadow turf patches (subtle tonal variance, never neon or dry brown)
  for (let i = 0; i < 220; i++) {
    const px = rand() * 512;
    const py = rand() * 512;
    const rad = 18 + rand() * 48;
    const patchShade = rand();
    const g = tCtx.createRadialGradient(px, py, 2, px, py, rad);
    if (patchShade < 0.5) {
      g.addColorStop(0, 'rgba(34, 68, 28, 0.38)');
      g.addColorStop(1, 'rgba(34, 68, 28, 0)');
    } else {
      g.addColorStop(0, 'rgba(62, 102, 42, 0.34)');
      g.addColorStop(1, 'rgba(62, 102, 42, 0)');
    }
    tCtx.fillStyle = g;
    tCtx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }

  // Dense organic grass blades, clover & deep mossy greens
  for (let i = 0; i < 24000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const choice = rand();
    if (choice < 0.52) {
      // Fresh forest meadow grass blades
      const v = 50 + Math.floor(rand() * 32);
      tCtx.fillStyle = `rgb(${Math.floor(v * 0.62)},${v + 28},${Math.floor(v * 0.48)})`;
      tCtx.fillRect(x, y, 1.6, 4.4);
    } else if (choice < 0.88) {
      // Deep emerald alpine turf & moss
      const g = 60 + Math.floor(rand() * 28);
      tCtx.fillStyle = `rgb(${Math.floor(g * 0.55)},${g},${Math.floor(g * 0.44)})`;
      tCtx.fillRect(x, y, 2.4, 2.4);
    } else {
      // Subtle shaded evergreen moss flecks
      const m = 42 + Math.floor(rand() * 20);
      tCtx.fillStyle = `rgb(${Math.floor(m * 0.72)},${m + 18},${Math.floor(m * 0.6)})`;
      tCtx.fillRect(x, y, 2.0, 2.0);
    }
  }
  const mountainTerrainMap = new THREE.CanvasTexture(terrainCanvas);
  mountainTerrainMap.colorSpace = THREE.SRGBColorSpace;
  mountainTerrainMap.wrapS = THREE.RepeatWrapping;
  mountainTerrainMap.wrapT = THREE.RepeatWrapping;
  mountainTerrainMap.anisotropy = maxAnisotropy;

  // 3. Mountain Conifer & Highland Bark
  const barkCanvas = document.createElement('canvas');
  barkCanvas.width = 128;
  barkCanvas.height = 256;
  const bCtx = barkCanvas.getContext('2d')!;
  bCtx.fillStyle = '#3d3025';
  bCtx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 950; i++) {
    const x = rand() * 128;
    const y = rand() * 256;
    bCtx.fillStyle = rand() > 0.5 ? '#281f18' : '#514134';
    bCtx.fillRect(x, y, 2, 14 + rand() * 20);
  }
  const barkMap = new THREE.CanvasTexture(barkCanvas);
  barkMap.colorSpace = THREE.SRGBColorSpace;
  barkMap.wrapS = THREE.RepeatWrapping;
  barkMap.wrapT = THREE.RepeatWrapping;

  // 4. Mountain Cliff Rock Strata (Granite & Moss-Dappled Basalt)
  const rockCanvas = document.createElement('canvas');
  rockCanvas.width = 256;
  rockCanvas.height = 256;
  const rCtx = rockCanvas.getContext('2d')!;
  rCtx.fillStyle = '#4c5153';
  rCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3800; i++) {
    const v = 54 + Math.floor(rand() * 52);
    if (rand() < 0.18) {
      // Subtle moss lichen fleck
      rCtx.fillStyle = `rgb(${Math.floor(v * 0.72)},${v + 12},${Math.floor(v * 0.68)})`;
    } else {
      rCtx.fillStyle = `rgb(${v + 1},${v + 2},${v + 3})`;
    }
    rCtx.fillRect(rand() * 256, rand() * 256, 7, 3);
  }
  const rockMap = new THREE.CanvasTexture(rockCanvas);
  rockMap.colorSpace = THREE.SRGBColorSpace;
  rockMap.wrapS = THREE.RepeatWrapping;
  rockMap.wrapT = THREE.RepeatWrapping;

  // 5. Lush Mountain Pine / Deodar Needle Bough Texture (Alpha Cutout)
  const pineCanvas = document.createElement('canvas');
  pineCanvas.width = 256;
  pineCanvas.height = 256;
  const pCtx = pineCanvas.getContext('2d')!;
  pCtx.clearRect(0, 0, 256, 256);

  pCtx.strokeStyle = '#36291e';
  pCtx.lineWidth = 4;
  pCtx.beginPath();
  pCtx.moveTo(128, 248);
  pCtx.lineTo(128, 18);
  pCtx.stroke();

  for (let s = 0; s < 16; s++) {
    const sy = 232 - s * 13;
    const side = s % 2 === 0 ? 1 : -1;
    const len = 38 + (1 - s / 17) * 72;
    const tipX = 128 + side * len;
    const tipY = sy - 22 - rand() * 14;

    pCtx.strokeStyle = '#403125';
    pCtx.lineWidth = 2.3;
    pCtx.beginPath();
    pCtx.moveTo(128, sy);
    pCtx.lineTo(tipX, tipY);
    pCtx.stroke();

    for (let k = 0; k < 36; k++) {
      const t = k / 36;
      const bx = THREE.MathUtils.lerp(128, tipX, t);
      const by = THREE.MathUtils.lerp(sy, tipY, t);
      const nAng = Math.atan2(tipY - sy, tipX - 128) + (rand() - 0.5) * 1.55;
      const nLen = 13 + rand() * 12;
      const shade = t * 0.6 + rand() * 0.4;
      const r = Math.floor(26 + shade * 32);
      const g = Math.floor(56 + shade * 54);
      const b = Math.floor(26 + shade * 24);
      pCtx.strokeStyle = `rgb(${r},${g},${b})`;
      pCtx.lineWidth = 2.4;
      pCtx.beginPath();
      pCtx.moveTo(bx, by);
      pCtx.lineTo(bx + Math.cos(nAng) * nLen, by + Math.sin(nAng) * nLen);
      pCtx.stroke();
    }
  }
  const pineNeedleMap = new THREE.CanvasTexture(pineCanvas);
  pineNeedleMap.colorSpace = THREE.SRGBColorSpace;
  pineNeedleMap.anisotropy = maxAnisotropy;

  // 6. Broadleaf Mountain Canopy Foliage Cluster (Alpha Cutout - Oak / Rhododendron / Hill Tree)
  const broadCanvas = document.createElement('canvas');
  broadCanvas.width = 256;
  broadCanvas.height = 256;
  const blCtx = broadCanvas.getContext('2d')!;
  blCtx.clearRect(0, 0, 256, 256);

  // Woody interior twig ribs
  blCtx.strokeStyle = '#3c2e22';
  blCtx.lineWidth = 3.5;
  for (const ang of [-0.55, 0, 0.55]) {
    blCtx.beginPath();
    blCtx.moveTo(128, 238);
    blCtx.lineTo(128 + Math.sin(ang) * 74, 96);
    blCtx.stroke();
  }

  // Layered organic leaf clusters (dark inner leaves -> rich mid-green outer leaves)
  for (let l = 0; l < 170; l++) {
    const rad = Math.pow(rand(), 0.65) * 96;
    const ang = rand() * Math.PI * 2;
    const lx = 128 + Math.cos(ang) * rad;
    const ly = 126 + Math.sin(ang) * rad * 0.92;
    const leafW = 10 + rand() * 11;
    const leafH = 6 + rand() * 7;
    const rot = rand() * Math.PI;
    const rimLight = (126 - ly) / 220 + rand() * 0.35;
    const r = Math.floor(28 + Math.max(0, rimLight) * 38);
    const g = Math.floor(54 + Math.max(0, rimLight) * 62);
    const b = Math.floor(24 + Math.max(0, rimLight) * 24);
    blCtx.save();
    blCtx.translate(lx, ly);
    blCtx.rotate(rot);
    blCtx.fillStyle = `rgb(${r},${g},${b})`;
    blCtx.beginPath();
    blCtx.ellipse(0, 0, leafW, leafH, 0, 0, Math.PI * 2);
    blCtx.fill();
    blCtx.restore();
  }
  const broadleafMap = new THREE.CanvasTexture(broadCanvas);
  broadleafMap.colorSpace = THREE.SRGBColorSpace;
  broadleafMap.anisotropy = maxAnisotropy;

  // 7. Lush Mountain Roadside Bush / Fern Shrub Cluster (Alpha Cutout)
  const shrubCanvas = document.createElement('canvas');
  shrubCanvas.width = 256;
  shrubCanvas.height = 256;
  const shCtx = shrubCanvas.getContext('2d')!;
  shCtx.clearRect(0, 0, 256, 256);

  for (let f = 0; f < 26; f++) {
    const baseAngle = -Math.PI * 0.5 + ((f / 25) - 0.5) * 2.1 + (rand() - 0.5) * 0.14;
    const len = 90 + rand() * 110;
    const ex = 128 + Math.cos(baseAngle) * len;
    const ey = 248 + Math.sin(baseAngle) * len;
    const cx = 128 + (ex - 128) * 0.4;
    const cy = 248 + (ey - 248) * 0.6;
    const shade = rand();
    shCtx.strokeStyle = `rgb(${Math.floor(34 + shade * 38)},${Math.floor(66 + shade * 54)},${Math.floor(28 + shade * 24)})`;
    shCtx.lineWidth = 4.2;
    shCtx.beginPath();
    shCtx.moveTo(128, 252);
    shCtx.quadraticCurveTo(cx, cy, ex, ey);
    shCtx.stroke();

    // Leaflets along fern frond
    for (let lf = 0.3; lf <= 0.95; lf += 0.16) {
      const mx = THREE.MathUtils.lerp(128, ex, lf);
      const my = THREE.MathUtils.lerp(250, ey, lf);
      shCtx.fillStyle = `rgb(${Math.floor(40 + shade * 36)},${Math.floor(78 + shade * 52)},${Math.floor(32 + shade * 24)})`;
      shCtx.beginPath();
      shCtx.ellipse(mx, my, 9, 4.5, baseAngle + 0.5, 0, Math.PI * 2);
      shCtx.fill();
    }
  }
  const shrubMap = new THREE.CanvasTexture(shrubCanvas);
  shrubMap.colorSpace = THREE.SRGBColorSpace;
  shrubMap.anisotropy = maxAnisotropy;

  // 8. Roadside Tall Grass Blade Tuft (Alpha Cutout)
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 256;
  grassCanvas.height = 256;
  const gCtx = grassCanvas.getContext('2d')!;
  gCtx.clearRect(0, 0, 256, 256);

  for (let b = 0; b < 32; b++) {
    const startX = 70 + rand() * 116;
    const lean = (startX - 128) * 0.75 + (rand() - 0.5) * 48;
    const h = 110 + rand() * 120;
    const tipX = startX + lean;
    const tipY = 252 - h;
    const shade = rand();
    gCtx.fillStyle = `rgb(${Math.floor(40 + shade * 42)},${Math.floor(78 + shade * 54)},${Math.floor(30 + shade * 26)})`;
    gCtx.beginPath();
    gCtx.moveTo(startX - 4.5, 256);
    gCtx.quadraticCurveTo(startX + lean * 0.35, 252 - h * 0.55, tipX, tipY);
    gCtx.quadraticCurveTo(startX + lean * 0.42 + 4.5, 252 - h * 0.55, startX + 4.5, 256);
    gCtx.closePath();
    gCtx.fill();
  }
  const grassTuftMap = new THREE.CanvasTexture(grassCanvas);
  grassTuftMap.colorSpace = THREE.SRGBColorSpace;
  grassTuftMap.anisotropy = maxAnisotropy;

  // 9. Soft Radial Contact Shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
  sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  sGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.36)');
  sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);

  return {
    asphaltMap,
    asphaltRoughMap,
    asphaltBumpMap,
    mountainTerrainMap,
    barkMap,
    rockMap,
    pineNeedleMap,
    broadleafMap,
    shrubMap,
    grassTuftMap,
    contactShadowMap,
    dispose: () => {
      asphaltMap.dispose();
      asphaltRoughMap.dispose();
      asphaltBumpMap.dispose();
      mountainTerrainMap.dispose();
      barkMap.dispose();
      rockMap.dispose();
      pineNeedleMap.dispose();
      broadleafMap.dispose();
      shrubMap.dispose();
      grassTuftMap.dispose();
      contactShadowMap.dispose();
    },
  };
}

export function createPlateTexture(plateNumber: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  const isShowPlate = plateNumber.toUpperCase() === 'SCORPIO';
  if (isShowPlate) {
    ctx.fillStyle = '#090b0f';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SCORPIO', 128, 44);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);

    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(6, 6, 30, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IND', 21, 46);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(plateNumber, 144, 42);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createDashboardTexture(vehicleId: VehicleId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, 512, 192);

  const accent =
    vehicleId === 'lamborghini'
      ? '#f59e0b'
      : vehicleId === 'nissan'
      ? '#38bdf8'
      : vehicleId === 'bus'
      ? '#34d399'
      : '#ef4444';

  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(110, 102, 66, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  ctx.strokeStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(110, 102, 66, Math.PI * 1.95, Math.PI * 2.25);
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(vehicleId === 'nissan' ? 'EV KW' : 'x1000 RPM', 110, 132);
  ctx.fillStyle = accent;
  ctx.font = 'bold 19px monospace';
  ctx.fillText(
    vehicleId === 'lamborghini'
      ? 'V12'
      : vehicleId === 'nissan'
      ? 'EV GEN2'
      : vehicleId === 'bus'
      ? 'OM926'
      : 'mHAWK',
    110,
    98,
  );

  ctx.fillStyle = '#111827';
  ctx.fillRect(198, 36, 116, 122);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(198, 36, 116, 122);
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(
    vehicleId === 'bus'
      ? 'AIR SUSP'
      : vehicleId === 'nissan'
      ? 'IM03 EV'
      : vehicleId === 'scorpio'
      ? '4XPLOR'
      : 'CORSA',
    256,
    64,
  );
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('DRIVE', 256, 102);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px monospace';
  ctx.fillText('ENDLESS', 256, 136);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(402, 102, 66, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(
    vehicleId === 'bus'
      ? '160'
      : vehicleId === 'lamborghini'
      ? '320'
      : vehicleId === 'nissan'
      ? '280'
      : '220',
    402,
    96,
  );
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('KM/H', 402, 132);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createScorpioBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);

  ctx.fillStyle = '#18181b';
  ctx.fillRect(4, 8, 248, 48);
  ctx.strokeStyle = '#d4d4d8';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 8, 248, 48);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCORPIO S11', 128, 41);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createHighwaySignTexture(
  code: string,
  line1: string,
  line2: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // Indian National Mountain Highway reflective royal-blue / emerald gantry sign
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

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
