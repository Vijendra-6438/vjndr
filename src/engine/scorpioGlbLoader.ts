import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { VEHICLES } from '../data/vehicles';
import { AnimatedDriverRig, createRealisticDriver } from './driverModel';
import type { VehicleRig } from './vehicleModels';
import { loadValidatedGlb } from './vehicleGlbLoader';
import { ExhaustFlameSystem } from './exhaustFlames';

export const SCORPIO_GLB_URL = '/4e4b85f3beae4f2183ca64f406609e92.glb';

export function preloadScorpioGlb(): Promise<GLTF> {
  return loadValidatedGlb(
    SCORPIO_GLB_URL,
    '/public/4e4b85f3beae4f2183ca64f406609e92.glb',
    'Mahindra Scorpio',
  );
}

export function buildScorpioGlbRig(params: {
  initialPaintHex: string;
  contactShadowMap: THREE.Texture;
  onError?: (message: string) => void;
  onLoaded?: () => void;
}): VehicleRig {
  const { initialPaintHex, contactShadowMap, onError, onLoaded } = params;
  const spec = VEHICLES.scorpio;

  const root = new THREE.Group();
  root.name = 'ScorpioGLBRoot';

  // Ground contact shadow plane under the SUV tires
  const shadowGeo = new THREE.PlaneGeometry(2.5, 5.15);
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

  // Unsprung group holds the 4 tires on the road; bodyGroup holds sprung chassis + interior
  const unsprungWheelsGroup = new THREE.Group();
  root.add(unsprungWheelsGroup);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const frontLeftPivot = new THREE.Group();
  const frontRightPivot = new THREE.Group();
  const wheels: THREE.Group[] = [];
  const steeringWheel = new THREE.Group();
  const gearShifter = new THREE.Group();

  // Shared compatible material handles required by VehicleRig contract
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
    emissiveIntensity: 0.55,
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
    emissiveIntensity: 0.1,
  });
  const rightIndicatorMaterial = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.1,
  });

  // Ground-skimming headlight beam projection + real downward-aimed SpotLight (zero mid-air haze/blur)
  const headlightCones = new THREE.Group();
  const beamGeo = new THREE.PlaneGeometry(1.25, 11.5);
  beamGeo.rotateX(-Math.PI * 0.5);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfef9ec,
    transparent: true,
    opacity: 0.024,
    depthWrite: false,
  });
  for (const sx of [-0.66, 0.66]) {
    const patch = new THREE.Mesh(beamGeo, beamMat);
    patch.position.set(sx, 0.055, -7.8);
    headlightCones.add(patch);
  }
  headlightCones.visible = false;
  bodyGroup.add(headlightCones);

  const headlightSpot = new THREE.SpotLight(0xfef7e6, 0, 56, Math.PI / 4.8, 0.78, 1.55);
  headlightSpot.castShadow = false;
  headlightSpot.position.set(0, 0.92, -2.18);
  headlightSpot.target.position.set(0, 0.05, -24);
  bodyGroup.add(headlightSpot);
  bodyGroup.add(headlightSpot.target);

  // Real rear-right under-bumper silencer outlet for high-speed exhaust flame bursts
  const exhaustFlames = new ExhaustFlameSystem([
    { x: 0.49, y: 0.325, z: 2.22, scale: 0.86 },
  ]);
  bodyGroup.add(exhaustFlames.group);

  // Driver placed inside the GLB RHD cockpit (updated precisely when GLB mounts)
  let driver: AnimatedDriverRig = createRealisticDriver(
    0x374151,
    new THREE.Vector3(0.414, 1.122, -0.529),
    0.165,
    0.38,
  );
  driver.root.visible = false;
  bodyGroup.add(driver.root);

  // Live references populated once GLB mounts
  let glbMounted = false;
  let disposed = false;
  let latestPaintHex = initialPaintHex;
  let glbWheelFLPivot: THREE.Object3D | null = null;
  let glbWheelFRPivot: THREE.Object3D | null = null;
  let glbWheelSpinTargets: THREE.Object3D[] = [];
  let glbSteeringPivot: THREE.Object3D | null = null;
  const glbPaintMaterials: THREE.MeshStandardMaterial[] = [];
  const glbLightMaterials: THREE.MeshStandardMaterial[] = [];
  const clonedMaterials: THREE.Material[] = [];

  const resolveScorpioPaintTint = (hex: string): string => {
    const h = hex.trim().toLowerCase();
    if (h === '#171a21') return '#22262e'; // Glossy Napoli Black over grey body sheet metal
    if (h === '#15803d') return '#1da14e'; // Deep metallic green
    if (h === '#f1f5f9') return '#ffffff'; // Crisp pearl white
    if (h === '#eab308') return '#facc15'; // Vivid yellow
    if (h === '#2563eb') return '#3b82f6'; // Rich cobalt blue
    return hex;
  };

  const applyPaintHex = (hex: string) => {
    latestPaintHex = hex;
    paintMaterial.color.set(hex);
    if (!glbMounted) return;
    const tint = resolveScorpioPaintTint(hex);
    for (const mat of glbPaintMaterials) {
      mat.color.set(tint);
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
    sideCamOffset: [4.6, 1.08, 0.15],
    halfWidth: 0.94,
    halfLength: 2.24,
    wheelRadius: 0.37,
    driverEyeOffset: [0.41, 1.46, -0.14],
    steeringEyeOffset: [0.41, 1.35, 0.05],
    steeringLookZ: -7.5,
    frontCamOffset: [0.0, 1.0, -2.35],
    chaseCamOffset: [0.0, 2.48, 6.25],
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
      if (glbWheelFLPivot) glbWheelFLPivot.rotation.y = steerAngle;
      if (glbWheelFRPivot) glbWheelFRPivot.rotation.y = steerAngle;
      for (const wMesh of glbWheelSpinTargets) {
        wMesh.rotation.x = -wheelSpinRad;
      }

      bodyGroup.position.y = heaveY;
      bodyGroup.rotation.x = pitchRad;
      bodyGroup.rotation.z = rollRad;

      const swAngle = steerAngle * 3.1;
      if (glbSteeringPivot) {
        glbSteeringPivot.rotation.z = swAngle;
      }

      driver.updatePose(
        swAngle,
        -steerAngle / 0.45,
        gearShiftAnim,
        roadBump,
        hideDriverHead,
      );

      const lightsActive = headlightsOn || highBeamOn;
      brakeLightMaterial.emissiveIntensity = braking ? 3.2 : 0.65;
      reverseLightMaterial.emissiveIntensity = reversing ? 3.2 : 0.05;
      headlightMaterial.emissive.setHex(lightsActive ? 0xfef3c7 : 0x000000);
      headlightMaterial.emissiveIntensity = highBeamOn ? 1.15 : headlightsOn ? 0.55 : 0;
      leftIndicatorMaterial.emissiveIntensity =
        (hazardActive && hazardBlinkOn) || leftBlinkOn ? 4.2 : 0.08;
      rightIndicatorMaterial.emissiveIntensity =
        (hazardActive && hazardBlinkOn) || rightBlinkOn ? 4.2 : 0.08;

      for (const lMat of glbLightMaterials) {
        lMat.emissive.setHex(lightsActive ? 0xfef3c7 : 0x000000);
        lMat.emissiveIntensity = highBeamOn ? 1.1 : headlightsOn ? 0.52 : 0;
      }

      // Never draw floating white ground rectangles in front of the vehicle
      headlightCones.visible = false;
      headlightSpot.intensity = highBeamOn ? 2.0 : headlightsOn ? 0.85 : 0;
      headlightSpot.distance = highBeamOn ? 64 : 44;

      exhaustFlames.setIntensity(exhaustFlame, performance.now() * 0.001);
    },
    dispose: () => {
      disposed = true;
      exhaustFlames.dispose();
      driver.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      paintMaterial.dispose();
      brakeLightMaterial.dispose();
      reverseLightMaterial.dispose();
      headlightMaterial.dispose();
      leftIndicatorMaterial.dispose();
      rightIndicatorMaterial.dispose();
      for (const m of clonedMaterials) {
        m.dispose();
      }
    },
  };

  preloadScorpioGlb()
    .then((gltf) => {
      if (disposed) return;
      const modelScene = gltf.scene.clone(true);
      modelScene.updateMatrixWorld(true);

      // Compute exact raw bounds & normalize to real Scorpio SUV proportions (4.48m long), centered & grounded at y=0
      const rawBox = new THREE.Box3().setFromObject(modelScene);
      const rawSize = new THREE.Vector3();
      const rawCenter = new THREE.Vector3();
      rawBox.getSize(rawSize);
      rawBox.getCenter(rawCenter);

      const targetLength = 4.48;
      const normScale = rawSize.z > 0.01 ? targetLength / rawSize.z : 1.0;

      const modelWrapper = new THREE.Group();
      modelWrapper.name = 'ScorpioGLBAligned';
      modelWrapper.scale.setScalar(normScale);
      modelWrapper.position.set(
        -rawCenter.x * normScale,
        -rawBox.min.y * normScale,
        -rawCenter.z * normScale,
      );
      modelWrapper.add(modelScene);
      bodyGroup.add(modelWrapper);
      bodyGroup.updateMatrixWorld(true);

      // Update collision footprint directly from normalized bounds
      const alignedBox = new THREE.Box3().setFromObject(modelWrapper);
      const alignedSize = new THREE.Vector3();
      alignedBox.getSize(alignedSize);
      rig.halfWidth = alignedSize.x * 0.49;
      rig.halfLength = alignedSize.z * 0.49;

      // Clone materials per instance and configure realistic PBR lighting, shadows & automotive glass
      const clonedMatCache = new Map<THREE.Material, THREE.Material>();
      modelScene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;

        const meshName = obj.name || '';
        const isGlass = /glass|windshield/i.test(meshName);
        const isMainPaint = /main[_\s]car/i.test(meshName);
        const isHeadlight = /car[_\s]light/i.test(meshName);

        const handleMat = (srcMat: THREE.Material): THREE.Material => {
          let mat = clonedMatCache.get(srcMat);
          if (!mat) {
            mat = srcMat.clone();
            clonedMatCache.set(srcMat, mat);
            clonedMaterials.push(mat);

            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.envMapIntensity = 1.2;
              if (isGlass) {
                mat.transparent = true;
                mat.opacity = 0.34;
                mat.roughness = 0.08;
                mat.metalness = 0.25;
                mat.envMapIntensity = 1.45;
                mat.depthWrite = false;
                mat.side = THREE.DoubleSide;
              } else if (isMainPaint) {
                mat.roughness = 0.21;
                mat.metalness = 0.44;
                mat.envMapIntensity = 1.45;
                glbPaintMaterials.push(mat);
              } else if (isHeadlight) {
                mat.roughness = 0.12;
                mat.emissive = new THREE.Color(0x000000);
                mat.emissiveIntensity = 0;
                glbLightMaterials.push(mat);
              }
            }
          }
          return mat;
        };

        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map(handleMat);
        } else if (obj.material) {
          obj.material = handleMat(obj.material);
        }

        if (isGlass) {
          obj.castShadow = false;
          obj.receiveShadow = true;
          obj.renderOrder = 4;
        } else {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Locate wheel nodes & steering wheel inside the GLB hierarchy (handles Three.js GLTFLoader space->underscore sanitization)
      const wheelFL = modelScene.getObjectByName('Wheel_FL') ?? modelScene.getObjectByName('Wheel FL');
      const wheelFR = modelScene.getObjectByName('Wheel_FR') ?? modelScene.getObjectByName('Wheel FR');
      const wheelBL = modelScene.getObjectByName('Wheel_BL') ?? modelScene.getObjectByName('Wheel BL');
      const wheelBR = modelScene.getObjectByName('Wheel_BR') ?? modelScene.getObjectByName('Wheel BR');
      const steeringNode = modelScene.getObjectByName('Steering');

      const spinTargets: THREE.Object3D[] = [];
      const attachWheel = (wheelNode: THREE.Object3D | undefined, isFrontLeft: boolean, isFrontRight: boolean) => {
        if (!wheelNode) return;
        wheelNode.updateMatrixWorld(true);

        // Compute wheel radius in root space before attaching
        const wBox = new THREE.Box3().setFromObject(wheelNode);
        const wSize = new THREE.Vector3();
        wBox.getSize(wSize);
        if (wSize.y > 0.2) {
          rig.wheelRadius = wSize.y * 0.5;
        }

        // Move wheel node into unsprung group while preserving world transform
        unsprungWheelsGroup.attach(wheelNode);

        if (isFrontLeft) {
          glbWheelFLPivot = wheelNode;
        } else if (isFrontRight) {
          glbWheelFRPivot = wheelNode;
        }

        // Spin the child mesh inside the wheel pivot so steering (Y) and rolling (X) never interfere
        const spinChild = wheelNode.children[0] ?? wheelNode;
        spinTargets.push(spinChild);
      };

      attachWheel(wheelFL, true, false);
      attachWheel(wheelFR, false, true);
      attachWheel(wheelBL, false, false);
      attachWheel(wheelBR, false, false);
      glbWheelSpinTargets = spinTargets;

      if (steeringNode) {
        glbSteeringPivot = steeringNode;

        // Compute steering wheel center in bodyGroup local space to seat our animated human driver accurately
        steeringNode.updateMatrixWorld(true);
        const sBox = new THREE.Box3().setFromObject(steeringNode);
        const sCenter = new THREE.Vector3();
        sBox.getCenter(sCenter);
        bodyGroup.worldToLocal(sCenter);

        bodyGroup.remove(driver.root);
        driver.dispose();
        driver = createRealisticDriver(0x374151, sCenter, 0.165, 0.36);
        driver.root.visible = true;
        bodyGroup.add(driver.root);
        rig.driver = driver;

        // Align cockpit cameras precisely to the GLB steering wheel & windshield
        rig.driverEyeOffset = [sCenter.x, sCenter.y + 0.34, sCenter.z + 0.39];
        rig.steeringEyeOffset = [sCenter.x, sCenter.y + 0.23, sCenter.z + 0.58];
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
