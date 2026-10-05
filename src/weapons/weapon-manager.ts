import * as THREE from 'three';
import { RAPIER } from '../physics';
import { WeaponSlotKey, WeaponType, WEAPON_PRESETS } from './types';
import { FXManager } from './fx-manager';
import { sounds } from './sound-manager';
import {
  BaseWeaponInstance,
  AssaultRifleInstance,
  SniperRifleInstance,
  PumpShotgunInstance,
  TacticalPistolInstance,
  RPGLauncherInstance,
  WeaponShootContext,
} from './weapon-instances';
import type { DummyManager } from '../target-dummy';
import type { NetworkManager } from '../network/network-manager';
import type { BotManager } from '../ai/bot-manager';

export class WeaponManager {
  public camera: THREE.PerspectiveCamera;
  public scene: THREE.Scene;
  public fx: FXManager;

  // 3 Weapon Slots
  public slots: Record<WeaponSlotKey, BaseWeaponInstance>;
  public activeSlot: WeaponSlotKey = 1;

  // Scope Overlay Canvas & ADS state
  public isScoped = false;
  private scopeCanvas!: HTMLCanvasElement;
  private scopeCtx!: CanvasRenderingContext2D;
  private defaultFOV = 75;
  public baseMouseSensitivity = 0.0022;

  // Managers
  public dummyManager?: DummyManager;
  public networkManager?: NetworkManager;
  public botManager?: BotManager;

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.camera = camera;
    this.scene = scene;
    this.fx = new FXManager(scene);

    // Initialize default loadout
    this.slots = {
      1: new AssaultRifleInstance(this.camera, this.scene, this.fx),
      2: new TacticalPistolInstance(this.camera, this.scene, this.fx),
      3: new RPGLauncherInstance(this.camera, this.scene, this.fx),
    };

    // Show only active weapon
    this.updateSlotVisibility();
    this.initScopeOverlay();
    this.renderWeaponSlotsHUD();
    this.updateHUD();
  }

  // Getters & Setters for Backwards Compatibility
  public get activeWeapon(): BaseWeaponInstance {
    return this.slots[this.activeSlot];
  }

  public get stats() {
    return this.activeWeapon.stats;
  }

  public get ammoInMag(): number {
    return this.activeWeapon.ammoInMag;
  }

  public set ammoInMag(val: number) {
    this.activeWeapon.ammoInMag = val;
  }

  public get totalReserve(): number {
    return this.activeWeapon.totalReserve;
  }

  public set totalReserve(val: number) {
    this.activeWeapon.totalReserve = val;
  }

  public get isReloading(): boolean {
    return this.activeWeapon.isReloading;
  }

  public get isTriggerDown(): boolean {
    return this.activeWeapon.isTriggerDown;
  }

  public set isTriggerDown(val: boolean) {
    this.activeWeapon.isTriggerDown = val;
  }

  public get currentSpread(): number {
    return this.activeWeapon.currentSpread;
  }

  public get cameraRecoil(): THREE.Vector2 {
    return this.activeWeapon.cameraRecoil;
  }

  public get rootGroup(): THREE.Group {
    return this.activeWeapon.rootGroup;
  }

  public setManagers(dummyManager?: DummyManager, networkManager?: NetworkManager, botManager?: BotManager): void {
    this.dummyManager = dummyManager;
    this.networkManager = networkManager;
    this.botManager = botManager;

    for (const weapon of Object.values(this.slots)) {
      weapon.dummyManager = dummyManager;
      weapon.networkManager = networkManager;
      weapon.botManager = botManager;
    }
  }

  /**
   * Switches active weapon slot (1 = Primary, 2 = Secondary, 3 = Heavy)
   */
  public selectSlot(slot: WeaponSlotKey): void {
    if (this.activeSlot === slot) return;

    if (this.isScoped) {
      this.toggleScope(false);
    }

    // Cancel active reload immediately on weapon swap
    this.activeWeapon.cancelReload();
    this.slots[slot].cancelReload();

    this.activeWeapon.isTriggerDown = false;
    this.activeSlot = slot;
    this.updateSlotVisibility();
    sounds.playWeaponSwap();
    this.renderWeaponSlotsHUD();
    this.updateHUD();
  }

  public cancelReload(): void {
    this.activeWeapon.cancelReload();
    this.updateHUD();
  }

  public cycleSlot(direction: number): void {
    let next = this.activeSlot + direction;
    if (next > 3) next = 1;
    if (next < 1) next = 3;
    this.selectSlot(next as WeaponSlotKey);
  }

  /**
   * Equips a new weapon into a specific slot (e.g. from Loot Crate)
   */
  public equipWeapon(type: WeaponType): void {
    const preset = WEAPON_PRESETS[type];
    const targetSlot = preset.slot as WeaponSlotKey;

    // Remove old instance
    if (this.slots[targetSlot]) {
      this.slots[targetSlot].destroy();
    }

    // Create new instance
    let newInstance: BaseWeaponInstance;
    switch (type) {
      case 'sniper':
        newInstance = new SniperRifleInstance(this.camera, this.scene, this.fx);
        break;
      case 'shotgun':
        newInstance = new PumpShotgunInstance(this.camera, this.scene, this.fx);
        break;
      case 'pistol':
        newInstance = new TacticalPistolInstance(this.camera, this.scene, this.fx);
        break;
      case 'rpg':
        newInstance = new RPGLauncherInstance(this.camera, this.scene, this.fx);
        break;
      case 'rifle':
      default:
        newInstance = new AssaultRifleInstance(this.camera, this.scene, this.fx);
        break;
    }

    newInstance.dummyManager = this.dummyManager;
    newInstance.networkManager = this.networkManager;
    newInstance.botManager = this.botManager;

    this.slots[targetSlot] = newInstance;
    this.selectSlot(targetSlot);
  }

  public replenishAllAmmo(): void {
    for (const weapon of Object.values(this.slots)) {
      weapon.replenishAmmo();
    }
    sounds.playAmmoPickup();
    this.updateHUD();
  }

  private updateSlotVisibility(): void {
    for (const [key, weapon] of Object.entries(this.slots)) {
      weapon.setVisible(Number(key) === this.activeSlot);
    }
  }

  /**
   * Toggle 4x Scope Overlay on Right-Click
   */
  public toggleScope(forceState?: boolean): void {
    const newState = forceState !== undefined ? forceState : !this.isScoped;
    this.isScoped = newState;

    const overlay = document.getElementById('sniper-scope-overlay');
    if (overlay) {
      if (this.isScoped && this.activeWeapon.stats.hasScope) {
        overlay.classList.remove('hidden');
        sounds.playScopeZoom(true);
      } else {
        overlay.classList.add('hidden');
        if (this.activeWeapon.stats.hasScope) {
          sounds.playScopeZoom(false);
        }
      }
    }
  }

  /**
   * Calculates effective mouse sensitivity (reduces by 4x when scoped)
   */
  public getEffectiveSensitivity(): number {
    if (this.isScoped && this.activeWeapon.stats.hasScope) {
      return this.baseMouseSensitivity * (this.activeWeapon.stats.scopeSensitivityMultiplier || 0.25);
    }
    return this.baseMouseSensitivity;
  }

  public shoot(playerSpeed = 0, isGrounded = true, excludeCollider?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody): void {
    const ctx: WeaponShootContext = {
      playerSpeed,
      isGrounded,
      excludeCollider,
      excludeBody,
      isScoped: this.isScoped && !!this.activeWeapon.stats.hasScope,
    };
    this.activeWeapon.shoot(ctx);
    this.updateHUD();
  }

  public reload(): void {
    this.activeWeapon.reload();
    this.updateHUD();
  }

  public update(
    delta: number,
    playerSpeed = 0,
    isGrounded = true,
    _yaw = 0,
    excludeCollider?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody
  ): void {
    const ctx: WeaponShootContext = {
      playerSpeed,
      isGrounded,
      excludeCollider,
      excludeBody,
      isScoped: this.isScoped && !!this.activeWeapon.stats.hasScope,
    };

    // Update active weapon
    this.activeWeapon.update(delta, ctx);

    // Update global FX
    this.fx.update(delta);

    // Dynamic FOV Zoom Lerp
    const targetFOV = (this.isScoped && this.activeWeapon.stats.hasScope)
      ? (this.activeWeapon.stats.scopeZoomFOV || 18.75)
      : this.defaultFOV;

    if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, delta * 18);
      this.camera.updateProjectionMatrix();
    }

    // Render Scope Overlay if active
    if (this.isScoped && this.activeWeapon.stats.hasScope) {
      this.drawScopeCanvas();
    }

    this.updateHUD();
  }

  // ==================== HUD & SCOPE CANVAS ====================

  private initScopeOverlay(): void {
    let container = document.getElementById('sniper-scope-overlay');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sniper-scope-overlay';
      container.className = 'sniper-scope-overlay hidden';

      this.scopeCanvas = document.createElement('canvas');
      this.scopeCanvas.width = window.innerWidth;
      this.scopeCanvas.height = window.innerHeight;
      this.scopeCtx = this.scopeCanvas.getContext('2d')!;

      container.appendChild(this.scopeCanvas);
      document.body.appendChild(container);

      window.addEventListener('resize', () => {
        if (this.scopeCanvas) {
          this.scopeCanvas.width = window.innerWidth;
          this.scopeCanvas.height = window.innerHeight;
        }
      });
    }
  }

  private drawScopeCanvas(): void {
    if (!this.scopeCtx) return;
    const ctx = this.scopeCtx;
    const w = this.scopeCanvas.width;
    const h = this.scopeCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const scopeRadius = Math.min(w, h) * 0.42;

    ctx.clearRect(0, 0, w, h);

    // 1. Dark Vignette Outer Mask
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, scopeRadius, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(5, 7, 12, 0.98)';
    ctx.fill();
    ctx.restore();

    // 2. Scope Outer Ring & Lens Tint
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, scopeRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Mil-Dot Tactical Reticle Crosshairs
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;

    // Crosshair horizontal & vertical lines
    ctx.beginPath();
    ctx.moveTo(cx - scopeRadius, cy);
    ctx.lineTo(cx - 20, cy);
    ctx.moveTo(cx + 20, cy);
    ctx.lineTo(cx + scopeRadius, cy);

    ctx.moveTo(cx, cy - scopeRadius);
    ctx.lineTo(cx, cy - 20);
    ctx.moveTo(cx, cy + 20);
    ctx.lineTo(cx, cy + scopeRadius);
    ctx.stroke();

    // Mil-dots
    ctx.fillStyle = '#00f0ff';
    for (let d = 40; d < scopeRadius - 30; d += 35) {
      // Horizontal dots
      ctx.beginPath();
      ctx.arc(cx + d, cy, 2, 0, Math.PI * 2);
      ctx.arc(cx - d, cy, 2, 0, Math.PI * 2);
      ctx.fill();

      // Vertical dots & hash marks
      ctx.beginPath();
      ctx.arc(cx, cy + d, 2, 0, Math.PI * 2);
      ctx.arc(cx, cy - d, 2, 0, Math.PI * 2);
      ctx.fill();

      // Hash lines
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy + d);
      ctx.lineTo(cx + 8, cy + d);
      ctx.stroke();
    }

    // Center Aim Dot
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // 4. Digital Tactical HUD Overlays
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'left';
    ctx.fillText('4.0x VOID OPTICS', cx - scopeRadius + 30, cy - scopeRadius + 50);
    ctx.fillText(`MAG: ${this.activeWeapon.ammoInMag}/${this.activeWeapon.totalReserve}`, cx - scopeRadius + 30, cy + scopeRadius - 40);

    ctx.textAlign = 'right';
    ctx.fillText('ELEV: 0.00 MIL', cx + scopeRadius - 30, cy - scopeRadius + 50);
    ctx.fillText('RANGE: AUTO-MTR', cx + scopeRadius - 30, cy + scopeRadius - 40);
  }

  public renderWeaponSlotsHUD(): void {
    let slotsContainer = document.getElementById('weapon-slots-hud');
    if (!slotsContainer) {
      slotsContainer = document.createElement('div');
      slotsContainer.id = 'weapon-slots-hud';
      slotsContainer.className = 'weapon-slots-hud';
      const bottomPanel = document.querySelector('.hud-panel.bottom-right');
      if (bottomPanel) {
        bottomPanel.parentElement?.appendChild(slotsContainer);
      } else {
        document.getElementById('hud')?.appendChild(slotsContainer);
      }
    }

    const slot1Name = this.slots[1].stats.name.split(' ')[0];
    const slot2Name = this.slots[2].stats.name.split(' ')[0];
    const slot3Name = this.slots[3].stats.name.split(' ')[0];

    slotsContainer.innerHTML = `
      <div class="slot-badge ${this.activeSlot === 1 ? 'active' : ''}" data-slot="1">
        <span class="slot-num">1</span>
        <span class="slot-label">PRI: ${slot1Name}</span>
      </div>
      <div class="slot-badge ${this.activeSlot === 2 ? 'active' : ''}" data-slot="2">
        <span class="slot-num">2</span>
        <span class="slot-label">SEC: ${slot2Name}</span>
      </div>
      <div class="slot-badge ${this.activeSlot === 3 ? 'active' : ''}" data-slot="3">
        <span class="slot-num">3</span>
        <span class="slot-label">HVY: ${slot3Name}</span>
      </div>
    `;

    // Click to select slot
    slotsContainer.querySelectorAll('.slot-badge').forEach((el) => {
      el.addEventListener('click', () => {
        const slot = Number(el.getAttribute('data-slot')) as WeaponSlotKey;
        this.selectSlot(slot);
      });
    });
  }

  public updateHUD(): void {
    const nameElem = document.querySelector('.weapon-name');
    const typeElem = document.querySelector('.weapon-type');
    const ammoElem = document.getElementById('stat-ammo');
    const reserveElem = document.getElementById('stat-reserve');
    const reloadPrompt = document.getElementById('reload-prompt');

    if (nameElem) nameElem.textContent = this.activeWeapon.stats.name;
    if (typeElem) {
      const mode = this.activeWeapon.stats.isAutomatic ? 'AUTOMATIC' : 'SEMI-AUTO';
      typeElem.textContent = `${mode} • ${this.activeWeapon.stats.fireRate} RPM`;
    }

    if (ammoElem) ammoElem.textContent = `${this.activeWeapon.ammoInMag}`;
    if (reserveElem) reserveElem.textContent = `/ ${this.activeWeapon.totalReserve}`;

    if (reloadPrompt) {
      if (this.activeWeapon.isReloading) {
        reloadPrompt.style.display = 'block';
        reloadPrompt.classList.add('visible');
      } else {
        reloadPrompt.style.display = 'none';
        reloadPrompt.classList.remove('visible');
      }
    }
  }
}
