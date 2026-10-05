import * as THREE from 'three';
import * as YUKA from 'yuka';
import { RAPIER } from '../physics';

export type MapId = 'desert' | 'jungle' | 'neon';

export interface MapMetadata {
  id: MapId;
  name: string;
  tagline: string;
  icon: string;
  description: string;
  themeColor: string;
  skyColor: number;
  sunColor: string;
  fogColor: string;
}

export interface MapSpawnPoints {
  playerSpawn: THREE.Vector3;
  botSpawns: THREE.Vector3[];
  lootSpawns: Array<{ type: 'health' | 'ammo' | 'weapon'; weaponType?: any; pos: THREE.Vector3; name: string }>;
  patrolWaypoints: YUKA.Vector3[];
  coverWaypoints: YUKA.Vector3[];
}

export interface BaseGameMap {
  id: MapId;
  metadata: MapMetadata;
  sceneGroup: THREE.Group;
  navMesh: YUKA.NavMesh;
  spawns: MapSpawnPoints;
  colliders: RAPIER.Collider[];
  rigidBodies: RAPIER.RigidBody[];
  lights: THREE.Light[];
  
  build(): void;
  update(delta: number): void;
  destroy(): void;
}

export const MAP_METADATA: Record<MapId, MapMetadata> = {
  desert: {
    id: 'desert',
    name: 'DESERT OUTPOST',
    tagline: 'Canyon Fortifications & Dusty Dunes',
    icon: '🏜️',
    description: 'Sand dunes with bump maps, bright sunlight (#fff1d0), warm distance fog (#e3af66), low-poly palms, and canyon barricades.',
    themeColor: '#f59e0b',
    skyColor: 0xf5d09b,
    sunColor: '#fff1d0',
    fogColor: '#e3af66',
  },
  jungle: {
    id: 'jungle',
    name: 'OVERGROWN JUNGLE',
    tagline: 'Rolling Hills & Dense Forest Cover',
    icon: '🌴',
    description: 'Rolling grassy heightmap terrain, mossy rock meshes, dense instanced tree trunks for cover, and a slight rain/canopy particle effect.',
    themeColor: '#10b981',
    skyColor: 0x163321,
    sunColor: '#d4ffd9',
    fogColor: '#1a3824',
  },
  neon: {
    id: 'neon',
    name: 'NEON CITY',
    tagline: 'Multi-Story Urban Cyber Arena',
    icon: '🌆',
    description: 'Compact urban layout with 2-story buildings, walkable staircases/rooftops, concrete obstacles, and night skybox with bloom lighting.',
    themeColor: '#00f0ff',
    skyColor: 0x070b19,
    sunColor: '#00e5ff',
    fogColor: '#080d1e',
  },
};
