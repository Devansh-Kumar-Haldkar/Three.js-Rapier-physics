export * from './weapons/types';
export * from './weapons/sound-manager';
export * from './weapons/fx-manager';
export * from './weapons/rocket-projectile';
export * from './weapons/weapon-instances';
export * from './weapons/weapon-manager';

// Alias AssaultRifle to WeaponManager for complete backward compatibility
import { WeaponManager } from './weapons/weapon-manager';
export const AssaultRifle = WeaponManager;
export type AssaultRifle = WeaponManager;
