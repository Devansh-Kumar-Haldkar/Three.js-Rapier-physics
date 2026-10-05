import * as THREE from 'three';

export type WeaponSlotKey = 1 | 2 | 3;
export type WeaponSlotName = 'primary' | 'secondary' | 'heavy';
export type WeaponType = 'rifle' | 'sniper' | 'shotgun' | 'pistol' | 'rpg';

export interface WeaponStats {
  name: string;
  type: WeaponType;
  slot: WeaponSlotKey;
  fireRate: number; // Shots per minute (e.g. 600 RPM = 0.1s, 45 RPM = 1.33s)
  damage: number;
  headshotMultiplier: number;
  bulletForce: number;
  magSize: number;
  reserveAmmo: number;
  maxReserve: number;
  reloadDuration: number;
  isAutomatic: boolean;
  
  // Spread & Recoil
  baseSpread: number;
  moveSpreadFactor: number;
  continuousSpreadMax: number;
  spreadRecoverySpeed: number;
  recoilKickBack: number;
  recoilPitch: number;
  recoilYaw: number;
  recoilRecovery: number;

  // Special Weapon Capabilities
  hasScope?: boolean;
  scopeZoomFOV?: number; // e.g. 20 for 4x zoom from 75 FOV
  scopeSensitivityMultiplier?: number; // e.g. 0.25
  pelletCount?: number; // For shotgun (10 pellets)
  pelletSpreadAngle?: number; // Conical spread radius in radians
  damageFalloffStart?: number; // e.g. 12m for shotgun
  damageFalloffEnd?: number; // e.g. 25m
  isRocketLauncher?: boolean;
  rocketSpeed?: number; // 45 m/s
  explosionRadius?: number; // 5m
  explosionDamageMax?: number; // 150
}

export const WEAPON_PRESETS: Record<WeaponType, WeaponStats> = {
  rifle: {
    name: 'AR-X PULSE RIFLE',
    type: 'rifle',
    slot: 1,
    fireRate: 600,
    damage: 28,
    headshotMultiplier: 2.0,
    bulletForce: 18.0,
    magSize: 30,
    reserveAmmo: 120,
    maxReserve: 240,
    reloadDuration: 1.6,
    isAutomatic: true,
    baseSpread: 0.006,
    moveSpreadFactor: 0.035,
    continuousSpreadMax: 0.045,
    spreadRecoverySpeed: 4.5,
    recoilKickBack: 0.07,
    recoilPitch: 0.085,
    recoilYaw: 0.03,
    recoilRecovery: 18.0,
  },
  sniper: {
    name: 'AWP-50 VOID SNIPER',
    type: 'sniper',
    slot: 1,
    fireRate: 45, // 1.33s per shot
    damage: 95,
    headshotMultiplier: 2.5, // 95 * 2.5 = 237.5 instakill!
    bulletForce: 60.0,
    magSize: 5,
    reserveAmmo: 20,
    maxReserve: 40,
    reloadDuration: 2.4,
    isAutomatic: false,
    baseSpread: 0.001,
    moveSpreadFactor: 0.08,
    continuousSpreadMax: 0.06,
    spreadRecoverySpeed: 2.5,
    recoilKickBack: 0.22,
    recoilPitch: 0.28,
    recoilYaw: 0.06,
    recoilRecovery: 8.0,
    hasScope: true,
    scopeZoomFOV: 18.75, // 4x zoom (75 / 4 = 18.75)
    scopeSensitivityMultiplier: 0.25, // 4x sensitivity reduction
  },
  shotgun: {
    name: 'SPAS-12 STRIKER',
    type: 'shotgun',
    slot: 1,
    fireRate: 65, // ~0.92s pump cycle
    damage: 12, // 10 pellets * 12 = 120 max burst damage!
    headshotMultiplier: 1.5,
    bulletForce: 35.0,
    magSize: 8,
    reserveAmmo: 32,
    maxReserve: 64,
    reloadDuration: 2.0,
    isAutomatic: false,
    baseSpread: 0.045,
    moveSpreadFactor: 0.02,
    continuousSpreadMax: 0.06,
    spreadRecoverySpeed: 5.0,
    recoilKickBack: 0.16,
    recoilPitch: 0.19,
    recoilYaw: 0.05,
    recoilRecovery: 12.0,
    pelletCount: 10, // 10 simultaneous conical raycasts
    pelletSpreadAngle: 0.055,
    damageFalloffStart: 12.0, // Sharp falloff beyond 12 meters
    damageFalloffEnd: 24.0,
  },
  pistol: {
    name: 'G-19 CYBER PISTOL',
    type: 'pistol',
    slot: 2,
    fireRate: 420, // Semi-auto tap rate
    damage: 24,
    headshotMultiplier: 2.0,
    bulletForce: 12.0,
    magSize: 15,
    reserveAmmo: 60,
    maxReserve: 120,
    reloadDuration: 1.2,
    isAutomatic: false,
    baseSpread: 0.008,
    moveSpreadFactor: 0.025,
    continuousSpreadMax: 0.035,
    spreadRecoverySpeed: 6.0,
    recoilKickBack: 0.04,
    recoilPitch: 0.05,
    recoilYaw: 0.015,
    recoilRecovery: 24.0,
  },
  rpg: {
    name: 'TITAN-RPG HEAVY',
    type: 'rpg',
    slot: 3,
    fireRate: 30, // 2.0s per rocket
    damage: 150, // Epicenter explosion damage
    headshotMultiplier: 1.0,
    bulletForce: 80.0,
    magSize: 1,
    reserveAmmo: 5,
    maxReserve: 10,
    reloadDuration: 2.5,
    isAutomatic: false,
    baseSpread: 0.002,
    moveSpreadFactor: 0.04,
    continuousSpreadMax: 0.03,
    spreadRecoverySpeed: 3.0,
    recoilKickBack: 0.25,
    recoilPitch: 0.22,
    recoilYaw: 0.04,
    recoilRecovery: 10.0,
    isRocketLauncher: true,
    rocketSpeed: 45.0, // 45 m/s physical projectile speed
    explosionRadius: 5.0, // 5m explosion radius
    explosionDamageMax: 150,
  },
};
