import * as THREE from 'three';
import { FPSController } from '../fps-controller';
import { NetworkManager } from '../network/network-manager';

export type GameModeType = 'tdm' | 'clash' | 'br';

export interface GameModeContext {
  scene: THREE.Scene;
  controller: FPSController;
  networkManager: NetworkManager;
}

export interface GameModeHUDState {
  title: string;
  subHeader: string;
  scoreLeftLabel: string;
  scoreLeftValue: number | string;
  scoreRightLabel: string;
  scoreRightValue: number | string;
  centerBadge: string;
  extraInfo?: string;
}

export interface GameModeInfo {
  id: GameModeType;
  title: string;
  tagline: string;
  icon: string;
  details: string;
}
