import * as THREE from 'three';

// Pre-allocated scratch vectors for zero-GC per-frame IK animation
const _sToH = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _leftTarget = new THREE.Vector3();
const _rightTarget = new THREE.Vector3();
const _gearKnobPos = new THREE.Vector3(0.0, 0.90, -0.32);

export interface AnimatedDriverRig {
  root: THREE.Group;
  headVisuals: THREE.Group;
  updatePose: (
    wheelAngle: number,
    steerInput: number,
    gearShiftAnim: number, // 0..1
    roadBump: number,
    hideHeadForInteriorCam: boolean,
  ) => void;
  dispose: () => void;
}

function orientLimb(
  mesh: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
): void {
  _mid.addVectors(start, end).multiplyScalar(0.5);
  mesh.position.copy(_mid);
  _segDir.subVectors(end, start);
  const len = _segDir.length();
  if (len > 0.0001) {
    _segDir.divideScalar(len);
    _quat.setFromUnitVectors(_upVec, _segDir);
    mesh.quaternion.copy(_quat);
  }
}

function solveTwoBoneIK(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  poleHint: THREE.Vector3,
  outElbow: THREE.Vector3,
): void {
  _sToH.subVectors(target, shoulder);
  const rawDist = _sToH.length();
  const maxReach = l1 + l2 - 0.004;
  const minReach = Math.abs(l1 - l2) + 0.02;
  const d = THREE.MathUtils.clamp(rawDist, minReach, maxReach);

  _dir.copy(_sToH).normalize();

  // Gram-Schmidt orthogonalize poleHint against _dir
  const proj = poleHint.dot(_dir);
  _perp.copy(poleHint).addScaledVector(_dir, -proj);
  if (_perp.lengthSq() < 0.0001) {
    _perp.set(0, -1, 0);
  } else {
    _perp.normalize();
  }

  const cosAlpha = THREE.MathUtils.clamp(
    (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d),
    -1,
    1,
  );
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

  outElbow
    .copy(shoulder)
    .addScaledVector(_dir, l1 * cosAlpha)
    .addScaledVector(_perp, l1 * sinAlpha);
}

export function createRealisticDriver(
  shirtHex = 0x1e3a5f,
  wheelCenter = new THREE.Vector3(0.38, 1.11, -0.43),
  wheelRadius = 0.175,
  wheelTiltRad = 0.42,
): AnimatedDriverRig {
  const root = new THREE.Group();

  // Realistic PBR Human Skin, Hair, Eyes & Tailored Clothing Materials
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xb87d56,
    roughness: 0.56,
    metalness: 0.02,
  });
  const lipMat = new THREE.MeshStandardMaterial({
    color: 0x8f5343,
    roughness: 0.5,
    metalness: 0.0,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x171412,
    roughness: 0.78,
    metalness: 0.04,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirtHex,
    roughness: 0.84,
    metalness: 0.03,
  });
  const trousersMat = new THREE.MeshStandardMaterial({
    color: 0x1f242d,
    roughness: 0.88,
    metalness: 0.02,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.45,
    metalness: 0.1,
  });
  const scleraMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.2,
  });
  const irisMat = new THREE.MeshStandardMaterial({
    color: 0x24150e,
    roughness: 0.15,
  });
  const watchBandMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.88,
  });

  const seatX = wheelCenter.x; // +0.38 (Right-Hand Drive driver position)

  // 1. Seated Pelvis, Thighs, Calves & Driving Shoes
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.12, 8, 14), trousersMat);
  pelvis.rotation.z = Math.PI * 0.5;
  pelvis.position.set(seatX, 0.73, 0.09);
  root.add(pelvis);

  for (const side of [-1, 1]) {
    const legX = seatX + side * 0.095;
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.28, 6, 12), trousersMat);
    thigh.position.set(legX, 0.76, -0.08);
    thigh.rotation.x = Math.PI * 0.44;
    root.add(thigh);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.054, 0.28, 6, 12), trousersMat);
    shin.position.set(legX, 0.57, -0.30);
    shin.rotation.x = Math.PI * 0.22;
    root.add(shin);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.06, 0.19), shoeMat);
    shoe.position.set(legX, 0.41, -0.44);
    shoe.rotation.x = -0.25;
    root.add(shoe);
  }

  // 2. Torso, Chest, Collar & Shoulders
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.30, 8, 16), shirtMat);
  torso.position.set(seatX, 1.03, 0.11);
  torso.scale.set(1.12, 1.0, 0.78);
  torso.rotation.x = -0.10;
  torso.castShadow = true;
  root.add(torso);

  // Broad shoulder bridge
  const shoulderBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.28, 8, 12), shirtMat);
  shoulderBar.rotation.z = Math.PI * 0.5;
  shoulderBar.position.set(seatX, 1.23, 0.11);
  root.add(shoulderBar);

  // Shirt collar ring
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.072, 0.018, 8, 18),
    shirtMat,
  );
  collar.rotation.x = Math.PI * 0.5 - 0.1;
  collar.position.set(seatX, 1.28, 0.09);
  root.add(collar);

  // 3. Detailed Human Head, Neck, Face, Eyes, Nose, Ears & Hair
  const headVisuals = new THREE.Group();
  headVisuals.position.set(seatX, 1.32, 0.09);
  root.add(headVisuals);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.060, 0.11, 14), skinMat);
  neck.position.set(0, 0.03, 0);
  headVisuals.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.13, -0.01);
  headVisuals.add(headPivot);

  // Cranium + sculpted jaw
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.105, 22, 20), skinMat);
  cranium.scale.set(0.92, 1.08, 1.0);
  cranium.castShadow = true;
  headPivot.add(cranium);

  const jaw = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.05, 8, 14), skinMat);
  jaw.position.set(0, -0.045, -0.02);
  jaw.scale.set(0.95, 1.0, 0.95);
  headPivot.add(jaw);

  // Nose bridge & tip (pointing forward along -Z)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.052, 10), skinMat);
  nose.rotation.x = -Math.PI * 0.42;
  nose.position.set(0, -0.008, -0.105);
  headPivot.add(nose);

  // Lips
  const lips = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.011, 0.016), lipMat);
  lips.position.set(0, -0.048, -0.094);
  headPivot.add(lips);

  // Eyes, Irises, Pupils & Eyebrows
  for (const s of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 10), scleraMat);
    eyeWhite.scale.set(1.15, 0.78, 0.6);
    eyeWhite.position.set(s * 0.036, 0.016, -0.094);
    headPivot.add(eyeWhite);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 10), irisMat);
    iris.position.set(s * 0.036, 0.016, -0.101);
    headPivot.add(iris);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.006, 0.012), hairMat);
    brow.position.set(s * 0.036, 0.034, -0.095);
    brow.rotation.z = s * -0.08;
    headPivot.add(brow);

    // Left & Right Human Ears
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 10), skinMat);
    ear.scale.set(0.38, 1.15, 0.72);
    ear.position.set(s * 0.098, 0.0, 0.005);
    headPivot.add(ear);
  }

  // Groomed Hair Cap, Crown & Sideburns
  const hairCrown = new THREE.Mesh(
    new THREE.SphereGeometry(0.111, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat,
  );
  hairCrown.scale.set(0.94, 1.06, 1.03);
  hairCrown.position.set(0, 0.012, 0.008);
  hairCrown.rotation.x = 0.22;
  headPivot.add(hairCrown);

  const hairFrontQuiff = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.09, 6, 12), hairMat);
  hairFrontQuiff.rotation.z = Math.PI * 0.5;
  hairFrontQuiff.position.set(0, 0.088, -0.068);
  headPivot.add(hairFrontQuiff);

  for (const s of [-1, 1]) {
    const sideburn = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.055, 0.038), hairMat);
    sideburn.position.set(s * 0.093, 0.012, -0.02);
    headPivot.add(sideburn);
  }

  // 4. Articulated Upper Arms, Forearms & Detailed Hands with Fingers
  const L1 = 0.295;
  const L2 = 0.275;
  const leftShoulder = new THREE.Vector3(seatX - 0.175, 1.22, 0.11);
  const rightShoulder = new THREE.Vector3(seatX + 0.175, 1.22, 0.11);

  const createArmAssembly = (isRight: boolean) => {
    const upperArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.044, L1 - 0.06, 6, 12),
      shirtMat,
    );
    upperArm.castShadow = true;
    root.add(upperArm);

    // Rolled polo/jacket sleeve + skin forearm
    const forearmGroup = new THREE.Group();
    const forearmSkin = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.036, L2 - 0.05, 6, 12),
      skinMat,
    );
    forearmGroup.add(forearmSkin);

    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.043, 0.08, 12),
      shirtMat,
    );
    cuff.position.y = -0.08;
    forearmGroup.add(cuff);

    // Wristwatch on right wrist for extra cockpit realism
    if (isRight) {
      const watch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.039, 0.039, 0.022, 14),
        watchBandMat,
      );
      watch.position.y = 0.095;
      forearmGroup.add(watch);
    }

    root.add(forearmGroup);

    // Sculpted Hand (Palm + 4 Curled Fingers + Thumb gripping steering rim)
    const handGroup = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.028, 0.075), skinMat);
    handGroup.add(palm);

    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0085, 0.036, 4, 8),
        skinMat,
      );
      finger.position.set((f - 1.5) * 0.016, -0.012, -0.042);
      finger.rotation.x = Math.PI * 0.35;
      handGroup.add(finger);
    }

    const thumb = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0095, 0.032, 4, 8),
      skinMat,
    );
    thumb.position.set(isRight ? -0.038 : 0.038, -0.006, -0.018);
    thumb.rotation.z = isRight ? 0.55 : -0.55;
    handGroup.add(thumb);

    root.add(handGroup);

    return { upperArm, forearmGroup, handGroup };
  };

  const leftArm = createArmAssembly(false);
  const rightArm = createArmAssembly(true);

  const cosTilt = Math.cos(wheelTiltRad);
  const sinTilt = Math.sin(wheelTiltRad);

  const updatePose = (
    wheelAngle: number,
    steerInput: number,
    gearShiftAnim: number,
    roadBump: number,
    hideHeadForInteriorCam: boolean,
  ) => {
    headVisuals.visible = !hideHeadForInteriorCam;

    // Subtle natural driver head movement looking into the corner + road bump nod
    headPivot.rotation.y = THREE.MathUtils.clamp(-steerInput * 0.24, -0.3, 0.3);
    headPivot.rotation.z = THREE.MathUtils.clamp(-steerInput * 0.07, -0.1, 0.1);
    headPivot.rotation.x = roadBump * 0.08 + (gearShiftAnim > 0.1 ? 0.06 * gearShiftAnim : 0);

    // Clamp hand grip angle so arms rotate naturally with the wheel without crossing unnaturally
    const gripAngle = THREE.MathUtils.clamp(wheelAngle, -1.25, 1.25);

    // Right hand at 3 o'clock (+R, 0) rotated by gripAngle in tilted wheel plane
    // Wheel plane: local X = +X, local Y_wheel = (0, cosTilt, -sinTilt)
    const rxLocal = Math.cos(gripAngle) * wheelRadius;
    const ryLocal = Math.sin(gripAngle) * wheelRadius;
    _rightTarget.set(
      wheelCenter.x + rxLocal,
      wheelCenter.y + ryLocal * cosTilt,
      wheelCenter.z - ryLocal * sinTilt,
    );

    // Left hand at 9 o'clock (gripAngle + PI)
    const lxLocal = Math.cos(gripAngle + Math.PI) * wheelRadius;
    const lyLocal = Math.sin(gripAngle + Math.PI) * wheelRadius;
    _leftTarget.set(
      wheelCenter.x + lxLocal,
      wheelCenter.y + lyLocal * cosTilt,
      wheelCenter.z - lyLocal * sinTilt,
    );

    // Smooth left-hand gear-shifting animation down to center-console gear lever
    if (gearShiftAnim > 0.001) {
      const arcLift = Math.sin(gearShiftAnim * Math.PI) * 0.06;
      _leftTarget.lerp(_gearKnobPos, gearShiftAnim);
      _leftTarget.y += arcLift;
    }

    // Solve Right Arm IK
    _pole.set(0.32, -1.0, 0.22);
    solveTwoBoneIK(rightShoulder, _rightTarget, L1, L2, _pole, _elbow);
    orientLimb(rightArm.upperArm, rightShoulder, _elbow);
    orientLimb(rightArm.forearmGroup, _elbow, _rightTarget);
    rightArm.handGroup.position.copy(_rightTarget);
    rightArm.handGroup.rotation.set(-wheelTiltRad, 0, gripAngle);

    // Solve Left Arm IK
    _pole.set(-0.32, -1.0, 0.22);
    solveTwoBoneIK(leftShoulder, _leftTarget, L1, L2, _pole, _elbow);
    orientLimb(leftArm.upperArm, leftShoulder, _elbow);
    orientLimb(leftArm.forearmGroup, _elbow, _leftTarget);
    leftArm.handGroup.position.copy(_leftTarget);
    leftArm.handGroup.rotation.set(
      THREE.MathUtils.lerp(-wheelTiltRad, 0.1, gearShiftAnim),
      0,
      THREE.MathUtils.lerp(gripAngle, 0, gearShiftAnim),
    );
  };

  // Initialize neutral driving pose immediately
  updatePose(0, 0, 0, 0, false);

  const dispose = () => {
    const seenGeos = new Set<THREE.BufferGeometry>();
    const seenMats = new Set<THREE.Material>();
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry && !seenGeos.has(obj.geometry)) {
          seenGeos.add(obj.geometry);
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m && !seenMats.has(m)) {
            seenMats.add(m);
            m.dispose();
          }
        }
      }
    });
  };

  return {
    root,
    headVisuals,
    updatePose,
    dispose,
  };
}
