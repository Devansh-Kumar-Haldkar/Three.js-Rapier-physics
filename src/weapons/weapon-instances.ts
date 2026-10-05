import * as THREE from 'three';
import { RAPIER, physics } from '../physics';
import { WeaponStats, WEAPON_PRESETS, WeaponType } from './types';
import { FXManager } from './fx-manager';
import { sounds } from './sound-manager';
import { RocketProjectile } from './rocket-projectile';
import { threatManager } from '../ai/threat-manager';
import type { DummyManager } from '../target-dummy';
import type { NetworkManager } from '../network/network-manager';
import type { BotManager } from '../ai/bot-manager';

export interface WeaponShootContext {
  playerSpeed: number;
  isGrounded: boolean;
  excludeCollider?: RAPIER.Collider;
  excludeBody?: RAPIER.RigidBody;
  isScoped?: boolean;
}

export abstract class BaseWeaponInstance {
  public stats: WeaponStats;
  public rootGroup: THREE.Group;
  public weaponModel!: THREE.Group;
  public camera: THREE.PerspectiveCamera;
  public scene: THREE.Scene;
  public fx: FXManager;

  public dummyManager?: DummyManager;
  public networkManager?: NetworkManager;
  public botManager?: BotManager;

  // Ammo & State
  public ammoInMag: number;
  public totalReserve: number;
  public isReloading = false;
  public isTriggerDown = false;
  public currentSpread = 0;
  protected fireTimer = 0;
  protected reloadTimer = 0;
  protected reloadFailsafeTimer = 0;
  protected continuousHeat = 0;

  // Visual Spring Transforms
  public recoilPos = new THREE.Vector3();
  public recoilRot = new THREE.Vector3();
  public cameraRecoil = new THREE.Vector2(0, 0);

  // Muzzle Flash
  protected muzzleFlashSprite!: THREE.Sprite;
  protected muzzleLight!: THREE.PointLight;
  protected muzzlePoint = new THREE.Vector3();

  // Positioning
  public defaultPos = new THREE.Vector3(0.24, -0.22, -0.48);
  public defaultRot = new THREE.Euler(0.02, -0.04, 0);
  public adsPos = new THREE.Vector3(0, -0.165, -0.38);

  constructor(stats: WeaponStats, camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    this.stats = { ...stats };
    this.camera = camera;
    this.scene = scene;
    this.fx = fx;

    this.ammoInMag = this.stats.magSize;
    this.totalReserve = this.stats.reserveAmmo;
    this.currentSpread = this.stats.baseSpread;

    this.rootGroup = new THREE.Group();
    this.camera.add(this.rootGroup);

    this.buildModel();
    this.createMuzzleFlash();
  }

  protected abstract buildModel(): void;

  protected createMuzzleFlash(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(0, 240, 255, 0.9)');
    grad.addColorStop(0.6, 'rgba(0, 150, 255, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.muzzleFlashSprite = new THREE.Sprite(spriteMat);
    this.muzzleFlashSprite.scale.set(0, 0, 0);
    this.weaponModel.add(this.muzzleFlashSprite);

    this.muzzleLight = new THREE.PointLight(0x00f0ff, 0, 8);
    this.weaponModel.add(this.muzzleLight);
  }

  public shoot(context: WeaponShootContext): boolean {
    if (this.isReloading) return false;

    if (this.ammoInMag <= 0) {
      sounds.playEmptyClick();
      this.reload();
      return false;
    }

    const interval = 60.0 / this.stats.fireRate;
    if (this.fireTimer < interval) return false;
    this.fireTimer = 0;

    this.ammoInMag--;
    this.applyRecoil(context.isScoped);
    this.executeFire(context);
    return true;
  }

  public applyRecoil(isScoped = false): void {
    const scopeFactor = isScoped ? 0.6 : 1.0;
    this.recoilPos.z += this.stats.recoilKickBack * scopeFactor;
    this.recoilPos.y += (this.stats.recoilKickBack * 0.4) * scopeFactor;
    this.recoilRot.x += this.stats.recoilPitch * scopeFactor;
    this.recoilRot.y += (Math.random() - 0.5) * this.stats.recoilYaw * scopeFactor;

    this.cameraRecoil.x += this.stats.recoilPitch * 0.45 * scopeFactor;
    this.cameraRecoil.y += (Math.random() - 0.5) * this.stats.recoilYaw * 0.5 * scopeFactor;
  }

  public reload(): void {
    if (this.isReloading || this.ammoInMag === this.stats.magSize || this.totalReserve <= 0) return;
    this.isReloading = true;
    this.reloadTimer = this.stats.reloadDuration;
    this.reloadFailsafeTimer = this.stats.reloadDuration + 0.5; // reloadTime + 500ms failsafe
    sounds.playEmptyClick();
  }

  public cancelReload(): void {
    if (this.isReloading) {
      this.isReloading = false;
      this.reloadTimer = 0;
      this.reloadFailsafeTimer = 0;
    }
  }

  public replenishAmmo(magAmount = this.stats.magSize, reserveAmount = this.stats.magSize * 3): void {
    this.totalReserve = Math.min(this.stats.maxReserve, this.totalReserve + reserveAmount);
    this.ammoInMag = this.stats.magSize;
  }

  protected abstract executeFire(context: WeaponShootContext): void;

  public update(delta: number, context: WeaponShootContext): void {
    this.fireTimer += delta;

    // Reloading State Machine with 500ms failsafe timeout
    if (this.isReloading) {
      this.reloadTimer -= delta;
      this.reloadFailsafeTimer -= delta;
      if (this.reloadTimer <= 0 || this.reloadFailsafeTimer <= 0) {
        this.isReloading = false;
        this.reloadTimer = 0;
        this.reloadFailsafeTimer = 0;
        const needed = this.stats.magSize - this.ammoInMag;
        const toLoad = Math.min(needed, this.totalReserve);
        this.ammoInMag += toLoad;
        this.totalReserve -= toLoad;
      }
    }

    // Auto Firing
    if (this.stats.isAutomatic && this.isTriggerDown) {
      this.shoot(context);
    }

    // Spread Recovery
    if (this.isTriggerDown) {
      this.continuousHeat = Math.min(this.stats.continuousSpreadMax, this.continuousHeat + delta * 0.15);
    } else {
      this.continuousHeat = Math.max(0, this.continuousHeat - delta * this.stats.spreadRecoverySpeed);
    }

    const moveSpread = context.playerSpeed * this.stats.moveSpreadFactor;
    this.currentSpread = this.stats.baseSpread + moveSpread + this.continuousHeat;
    if (context.isScoped) {
      this.currentSpread *= 0.15;
    }

    // Recoil Recovery
    const recSpeed = this.stats.recoilRecovery * delta;
    this.recoilPos.lerp(new THREE.Vector3(), Math.min(1.0, recSpeed));
    this.recoilRot.lerp(new THREE.Vector3(), Math.min(1.0, recSpeed));
    this.cameraRecoil.lerp(new THREE.Vector2(), Math.min(1.0, recSpeed * 0.8));

    // Muzzle Flash Decay
    if (this.muzzleFlashSprite.scale.x > 0.01) {
      this.muzzleFlashSprite.scale.lerp(new THREE.Vector3(0, 0, 0), delta * 35);
      this.muzzleLight.intensity = THREE.MathUtils.lerp(this.muzzleLight.intensity, 0, delta * 35);
    }

    // Position & Rotation Sync
    const targetBasePos = context.isScoped ? this.adsPos : this.defaultPos;
    this.weaponModel.position.set(
      targetBasePos.x + this.recoilPos.x,
      targetBasePos.y + this.recoilPos.y,
      targetBasePos.z + this.recoilPos.z
    );

    this.weaponModel.rotation.set(
      this.defaultRot.x + this.recoilRot.x,
      this.defaultRot.y + this.recoilRot.y,
      this.defaultRot.z + this.recoilRot.z
    );
  }

  public setVisible(visible: boolean): void {
    this.rootGroup.visible = visible;
  }

  public destroy(): void {
    this.camera.remove(this.rootGroup);
  }
}

// ==================== 1. ASSAULT RIFLE ====================
export class AssaultRifleInstance extends BaseWeaponInstance {
  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    super(WEAPON_PRESETS.rifle, camera, scene, fx);
  }

  protected buildModel(): void {
    this.weaponModel = new THREE.Group();
    this.weaponModel.position.copy(this.defaultPos);
    this.weaponModel.rotation.copy(this.defaultRot);

    const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x181e29, roughness: 0.35, metalness: 0.85 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.1 });
    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.25, metalness: 0.6 });

    // Receiver
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.42), darkMetalMat);
    this.weaponModel.add(rec);

    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 12), darkMetalMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.02, -0.45);
    this.weaponModel.add(barrel);

    // Sight & Magazine
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), darkMetalMat);
    sight.position.set(0, 0.09, -0.05);
    this.weaponModel.add(sight);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), blueMat);
    mag.position.set(0, -0.12, -0.06);
    this.weaponModel.add(mag);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.015, 0.26), cyanMat);
    stripe.position.set(0, 0.03, -0.06);
    this.weaponModel.add(stripe);

    this.rootGroup.add(this.weaponModel);
  }

  protected executeFire(context: WeaponShootContext): void {
    sounds.playGunshot();
    this.muzzleFlashSprite.scale.set(0.65, 0.65, 1);
    this.muzzleLight.intensity = 5.0;

    const muzzlePos = new THREE.Vector3();
    this.weaponModel.localToWorld(this.muzzlePoint.set(0, 0.02, -0.65));
    muzzlePos.copy(this.muzzlePoint);

    this.fireRaycastBullet(muzzlePos, this.currentSpread, this.stats.damage, this.stats.headshotMultiplier, context);
  }

  protected fireRaycastBullet(
    muzzlePos: THREE.Vector3,
    spread: number,
    baseDamage: number,
    headMult: number,
    context: WeaponShootContext
  ): void {
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

    const theta = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;
    const shootDir = camDir.clone()
      .addScaledVector(right, Math.cos(theta) * r)
      .addScaledVector(up, Math.sin(theta) * r)
      .normalize();

    const maxDist = 150.0;
    const rayOrigin = this.camera.position.clone();

    // Propagate gunshot sound alert to all bots within 35 meters
    threatManager.emitAudioAlert(rayOrigin, 35.0, 'local_player');

    const rapierRay = new RAPIER.Ray(
      { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z },
      { x: shootDir.x, y: shootDir.y, z: shootDir.z }
    );

    const hit = physics.world.castRayAndGetNormal(
      rapierRay,
      maxDist,
      true,
      undefined,
      undefined,
      context.excludeCollider,
      context.excludeBody
    );

    const peerRaycaster = new THREE.Raycaster(rayOrigin, shootDir, 0, maxDist);
    const meshHit = this.networkManager?.checkMeshIntersection(peerRaycaster);
    const botMeshHit = this.botManager?.checkMeshIntersection(peerRaycaster);

    let hitPoint = rayOrigin.clone().addScaledVector(shootDir, hit ? hit.timeOfImpact : maxDist);

    if (botMeshHit && (!hit || botMeshHit.point.distanceTo(rayOrigin) <= hit.timeOfImpact + 0.5)) {
      const isHead = botMeshHit.hitboxType === 'head';
      const damage = Math.round(baseDamage * (isHead ? headMult : botMeshHit.hitboxType === 'torso' ? 1.0 : 0.7));
      botMeshHit.bot.takeDamage(damage, 'local_player', botMeshHit.point, shootDir, botMeshHit.hitboxType);
      this.dummyManager?.spawnFloatingText(botMeshHit.point, damage, isHead);
      this.dummyManager?.triggerHitmarker(isHead);
      this.fx.addSparksOnly(botMeshHit.point, shootDir.clone().negate());
      hitPoint = botMeshHit.point;
    } else if (meshHit && (!hit || meshHit.point.distanceTo(rayOrigin) <= hit.timeOfImpact + 0.5)) {
      const isHead = meshHit.hitboxType === 'head';
      const damage = Math.round(baseDamage * (isHead ? headMult : 1.0));
      this.dummyManager?.spawnFloatingText(meshHit.point, damage, isHead);
      this.dummyManager?.triggerHitmarker(isHead);
      this.networkManager?.notifyDamageDealt(meshHit.hitboxType, damage, meshHit.point, shootDir);
      this.fx.addSparksOnly(meshHit.point, shootDir.clone().negate());
      hitPoint = meshHit.point;
    } else if (hit) {
      const hitNormal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      this.fx.addImpact(hitPoint, hitNormal);
    }

    this.fx.addTracer(muzzlePos, hitPoint);
  }
}

// ==================== 2. SNIPER RIFLE (4X SCOPE & 2.5X HEADSHOT) ====================
export class SniperRifleInstance extends AssaultRifleInstance {
  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    super(camera, scene, fx);
    this.stats = { ...WEAPON_PRESETS.sniper };
    this.ammoInMag = this.stats.magSize;
    this.totalReserve = this.stats.reserveAmmo;
  }

  protected buildModel(): void {
    this.weaponModel = new THREE.Group();
    this.weaponModel.position.copy(this.defaultPos);
    this.weaponModel.rotation.copy(this.defaultRot);

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.9 });
    const purpleMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.2, metalness: 0.7 });
    const glowPurple = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

    // Long Sniper Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 16), darkMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.02, -0.55);
    this.weaponModel.add(barrel);

    // Heavy Receiver
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.45), darkMat);
    rec.position.set(0, 0, 0);
    this.weaponModel.add(rec);

    // Large 4x Scope Tube
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 16), purpleMat);
    scopeTube.geometry.rotateX(Math.PI / 2);
    scopeTube.position.set(0, 0.12, -0.05);
    this.weaponModel.add(scopeTube);

    // Glowing Scope Rings
    const ring1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), glowPurple);
    ring1.geometry.rotateX(Math.PI / 2);
    ring1.position.set(0, 0.12, 0.06);
    this.weaponModel.add(ring1);

    const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), glowPurple);
    ring2.geometry.rotateX(Math.PI / 2);
    ring2.position.set(0, 0.12, -0.16);
    this.weaponModel.add(ring2);

    this.rootGroup.add(this.weaponModel);
  }

  protected executeFire(context: WeaponShootContext): void {
    sounds.playSniperShot();
    this.muzzleFlashSprite.scale.set(0.9, 0.9, 1);
    this.muzzleLight.intensity = 8.0;

    const muzzlePos = new THREE.Vector3();
    this.weaponModel.localToWorld(this.muzzlePoint.set(0, 0.02, -0.92));
    muzzlePos.copy(this.muzzlePoint);

    this.fireRaycastBullet(muzzlePos, this.currentSpread, this.stats.damage, this.stats.headshotMultiplier, context);
  }
}

// ==================== 3. PUMP SHOTGUN (10 CONICAL RAYCASTS & FALLOFF) ====================
export class PumpShotgunInstance extends BaseWeaponInstance {
  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    super(WEAPON_PRESETS.shotgun, camera, scene, fx);
  }

  protected buildModel(): void {
    this.weaponModel = new THREE.Group();
    this.weaponModel.position.copy(this.defaultPos);
    this.weaponModel.rotation.copy(this.defaultRot);

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.8 });
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.3, metalness: 0.6 });

    // Wide Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.45, 12), darkMat);
    barrel.geometry.rotateX(Math.PI / 2);
    barrel.position.set(0, 0.02, -0.4);
    this.weaponModel.add(barrel);

    // Magazine Tube Below Barrel
    const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 12), darkMat);
    magTube.geometry.rotateX(Math.PI / 2);
    magTube.position.set(0, -0.03, -0.38);
    this.weaponModel.add(magTube);

    // Pump Slide Handle
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), orangeMat);
    pump.position.set(0, -0.01, -0.32);
    this.weaponModel.add(pump);

    // Receiver
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.35), darkMat);
    this.weaponModel.add(rec);

    this.rootGroup.add(this.weaponModel);
  }

  protected executeFire(context: WeaponShootContext): void {
    sounds.playShotgunShot();
    this.muzzleFlashSprite.scale.set(0.85, 0.85, 1);
    this.muzzleLight.intensity = 7.0;

    const muzzlePos = new THREE.Vector3();
    this.weaponModel.localToWorld(this.muzzlePoint.set(0, 0.02, -0.65));
    muzzlePos.copy(this.muzzlePoint);

    // 10 Simultaneous Raycasts in a Conical Spread
    const pelletCount = this.stats.pelletCount || 10;
    const coneAngle = this.stats.pelletSpreadAngle || 0.055;

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

    for (let i = 0; i < pelletCount; i++) {
      const theta = (i / pelletCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r = (0.25 + Math.random() * 0.75) * coneAngle;

      const pelletDir = camDir.clone()
        .addScaledVector(right, Math.cos(theta) * r)
        .addScaledVector(up, Math.sin(theta) * r)
        .normalize();

      this.fireSinglePellet(muzzlePos, pelletDir, context);
    }
  }

  private fireSinglePellet(muzzlePos: THREE.Vector3, pelletDir: THREE.Vector3, context: WeaponShootContext): void {
    const rayOrigin = this.camera.position.clone();
    const maxDist = 50.0;
    const rapierRay = new RAPIER.Ray(
      { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z },
      { x: pelletDir.x, y: pelletDir.y, z: pelletDir.z }
    );

    const hit = physics.world.castRayAndGetNormal(
      rapierRay,
      maxDist,
      true,
      undefined,
      undefined,
      context.excludeCollider,
      context.excludeBody
    );

    const peerRaycaster = new THREE.Raycaster(rayOrigin, pelletDir, 0, maxDist);
    const meshHit = this.networkManager?.checkMeshIntersection(peerRaycaster);
    const botMeshHit = this.botManager?.checkMeshIntersection(peerRaycaster);

    let hitPoint = rayOrigin.clone().addScaledVector(pelletDir, hit ? hit.timeOfImpact : maxDist);
    const distToHit = hitPoint.distanceTo(rayOrigin);

    // Sharp Damage Falloff beyond 12m
    let pelletDamage = this.stats.damage; // 12 base
    if (distToHit > 12.0) {
      const falloffFactor = Math.max(0.15, Math.pow(12.0 / distToHit, 2.2));
      pelletDamage = Math.max(2, Math.round(pelletDamage * falloffFactor));
    }

    if (botMeshHit && (!hit || botMeshHit.point.distanceTo(rayOrigin) <= hit.timeOfImpact + 0.4)) {
      botMeshHit.bot.takeDamage(pelletDamage, 'local_player', botMeshHit.point, pelletDir, botMeshHit.hitboxType);
      this.dummyManager?.spawnFloatingText(botMeshHit.point, pelletDamage, false);
      this.dummyManager?.triggerHitmarker(false);
      this.fx.addSparksOnly(botMeshHit.point, pelletDir.clone().negate());
      hitPoint = botMeshHit.point;
    } else if (meshHit && (!hit || meshHit.point.distanceTo(rayOrigin) <= hit.timeOfImpact + 0.4)) {
      this.dummyManager?.spawnFloatingText(meshHit.point, pelletDamage, false);
      this.dummyManager?.triggerHitmarker(false);
      this.networkManager?.notifyDamageDealt(meshHit.hitboxType, pelletDamage, meshHit.point, pelletDir);
      this.fx.addSparksOnly(meshHit.point, pelletDir.clone().negate());
      hitPoint = meshHit.point;
    } else if (hit) {
      this.fx.addSparksOnly(hitPoint, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z));
    }

    this.fx.addTracer(muzzlePos, hitPoint, 0xffaa00);
  }
}

// ==================== 4. TACTICAL PISTOL (SEMI-AUTO SNAPPY) ====================
export class TacticalPistolInstance extends AssaultRifleInstance {
  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    super(camera, scene, fx);
    this.stats = { ...WEAPON_PRESETS.pistol };
    this.ammoInMag = this.stats.magSize;
    this.totalReserve = this.stats.reserveAmmo;
    this.defaultPos.set(0.18, -0.18, -0.38);
    this.adsPos.set(0, -0.12, -0.28);
  }

  protected buildModel(): void {
    this.weaponModel = new THREE.Group();
    this.weaponModel.position.copy(this.defaultPos);
    this.weaponModel.rotation.copy(this.defaultRot);

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.8 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.9 });

    // Compact Slide & Grip
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), silverMat);
    slide.position.set(0, 0.04, -0.06);
    this.weaponModel.add(slide);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.07), darkMat);
    grip.position.set(0, -0.05, 0.02);
    grip.rotation.x = -0.25;
    this.weaponModel.add(grip);

    this.rootGroup.add(this.weaponModel);
  }

  protected executeFire(context: WeaponShootContext): void {
    sounds.playPistolShot();
    this.muzzleFlashSprite.scale.set(0.4, 0.4, 1);
    this.muzzleLight.intensity = 3.5;

    const muzzlePos = new THREE.Vector3();
    this.weaponModel.localToWorld(this.muzzlePoint.set(0, 0.04, -0.2));
    muzzlePos.copy(this.muzzlePoint);

    this.fireRaycastBullet(muzzlePos, this.currentSpread, this.stats.damage, this.stats.headshotMultiplier, context);
  }
}

// ==================== 5. RPG LAUNCHER (PHYSICAL ROCKET 45 M/S & 5M EXPLOSION) ====================
export class RPGLauncherInstance extends BaseWeaponInstance {
  public activeRockets: RocketProjectile[] = [];

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, fx: FXManager) {
    super(WEAPON_PRESETS.rpg, camera, scene, fx);
    this.defaultPos.set(0.26, -0.16, -0.42);
  }

  protected buildModel(): void {
    this.weaponModel = new THREE.Group();
    this.weaponModel.position.copy(this.defaultPos);
    this.weaponModel.rotation.copy(this.defaultRot);

    const oliveMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.6, metalness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.3, metalness: 0.8 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.4 });

    // Main Tube
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.75, 16), oliveMat);
    tube.geometry.rotateX(Math.PI / 2);
    this.weaponModel.add(tube);

    // Front Exhaust Horn
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.12, 16), darkMat);
    horn.geometry.rotateX(Math.PI / 2);
    horn.position.set(0, 0, 0.42);
    this.weaponModel.add(horn);

    // Loaded Warhead Tip
    const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 12), redMat);
    warhead.geometry.rotateX(-Math.PI / 2);
    warhead.position.set(0, 0, -0.46);
    this.weaponModel.add(warhead);

    this.rootGroup.add(this.weaponModel);
  }

  protected executeFire(context: WeaponShootContext): void {
    this.muzzleFlashSprite.scale.set(1.2, 1.2, 1);
    this.muzzleLight.intensity = 10.0;

    const shootDir = new THREE.Vector3();
    this.camera.getWorldDirection(shootDir);

    // Compute spawn position: 1.8m ahead of camera to guarantee spawning outside player bounding box
    const spawnPos = this.camera.position.clone().add(shootDir.clone().multiplyScalar(1.8));

    // Spawn physical 45 m/s rocket projectile
    const rocket = new RocketProjectile(
      spawnPos,
      shootDir,
      this.scene,
      this.fx,
      'local_player',
      'Local Player',
      this.dummyManager,
      this.networkManager,
      this.botManager,
      context.excludeCollider,
      context.excludeBody
    );

    this.activeRockets.push(rocket);
  }

  public update(delta: number, context: WeaponShootContext): void {
    super.update(delta, context);

    // Update active flying rocket projectiles
    for (let i = this.activeRockets.length - 1; i >= 0; i--) {
      const active = this.activeRockets[i].update(delta);
      if (!active) {
        this.activeRockets.splice(i, 1);
      }
    }
  }
}
