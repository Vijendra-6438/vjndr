import * as THREE from 'three';
import { VehicleId } from '../types/game';
import { AnimatedDriverRig } from './driverModel';
import { buildScorpioGlbRig, preloadScorpioGlb } from './scorpioGlbLoader';
import { buildPlayableGlbRig } from './vehicleGlbLoader';

export { preloadScorpioGlb };

export interface VehicleRig {
  root: THREE.Group;
  bodyGroup: THREE.Group; // Suspended sprung chassis + interior + driver
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Group[]; // [FL, FR, ...REAR] rotating meshes
  steeringWheel: THREE.Group;
  gearShifter: THREE.Group;
  driver: AnimatedDriverRig;
  paintMaterial: THREE.MeshPhysicalMaterial;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  reverseLightMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  leftIndicatorMaterial: THREE.MeshStandardMaterial;
  rightIndicatorMaterial: THREE.MeshStandardMaterial;
  headlightCones: THREE.Group;
  sideCamOffset: [number, number, number];
  halfWidth: number;
  halfLength: number;
  wheelRadius: number;
  driverEyeOffset: [number, number, number];
  steeringEyeOffset: [number, number, number];
  steeringLookZ: number;
  frontCamOffset: [number, number, number];
  chaseCamOffset: [number, number, number];
  setPaintColor: (hex: string) => void;
  updateVisuals: (params: {
    steerAngle: number; // front wheel steer rad (-0.5..0.5)
    wheelSpinRad: number;
    braking: boolean;
    reversing?: boolean;
    headlightsOn: boolean;
    highBeamOn?: boolean;
    leftBlinkOn?: boolean;
    rightBlinkOn?: boolean;
    hazardActive?: boolean;
    hazardBlinkOn?: boolean;
    pitchRad: number;
    rollRad: number;
    heaveY: number;
    gearShiftAnim: number;
    roadBump: number;
    hideDriverHead: boolean;
    exhaustFlame?: number;
  }) => void;
  dispose?: () => void;
}

export function buildVehicleModel(
  vehicleId: VehicleId,
  initialPaintHex: string,
  contactShadowMap: THREE.Texture,
  _isSoftwareGl: boolean,
  _customPlate?: string,
  options?: {
    onModelError?: (message: string) => void;
    onModelLoaded?: () => void;
  },
): VehicleRig {
  // Scorpio GLB rig is locked and preserved untouched
  if (vehicleId === 'scorpio') {
    return buildScorpioGlbRig({
      initialPaintHex,
      contactShadowMap,
      onError: options?.onModelError,
      onLoaded: options?.onModelLoaded,
    });
  }

  // All remaining playable vehicles load real GLB assets via /public/models/<id>.glb
  return buildPlayableGlbRig({
    vehicleId,
    initialPaintHex,
    contactShadowMap,
    onError: options?.onModelError,
    onLoaded: options?.onModelLoaded,
  });
}
