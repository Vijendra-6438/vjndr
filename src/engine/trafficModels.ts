import * as THREE from 'three';
import { buildTrafficGlbRig } from './vehicleGlbLoader';

export type TrafficVehicleKind = 'bus' | 'lamborghini' | 'scorpio';

export interface TrafficVehicleRig {
  root: THREE.Group;
  kind: TrafficVehicleKind;
  label: string;
  halfWidth: number;
  halfLength: number;
  wheelRadius: number;
  loaded: boolean;
  updateVisuals: (params: {
    wheelSpinRad: number;
    steerAngle?: number;
    braking: boolean;
    headlightsOn: boolean;
    leftBlink?: boolean;
    rightBlink?: boolean;
    hazardBlink?: boolean;
  }) => void;
  dispose?: () => void;
}

export function buildTrafficVehicleModel(
  kind: TrafficVehicleKind,
  paintHex: string,
  _plateNumber: string,
  contactShadowMap: THREE.Texture,
  options?: {
    onError?: (message: string, diskPath: string) => void;
    onLoaded?: () => void;
  },
): TrafficVehicleRig {
  return buildTrafficGlbRig(kind, paintHex, contactShadowMap, options);
}
