import * as THREE from 'three';
import { WeaponType } from '../weapons/types';
import { WeaponManager } from '../weapons/weapon-manager';
import { sounds } from '../weapons/sound-manager';
import type { FPSController } from '../fps-controller';
import type { BotManager } from '../ai/bot-manager';

export type LootType = 'health' | 'ammo' | 'weapon';

export interface LootItemDef {
  id: string;
  type: LootType;
  position: THREE.Vector3;
  weaponType?: WeaponType;
  name: string;
  respawnTime: number; // 45 seconds
}

export class WorldLootCrate {
  public def: LootItemDef;
  public group: THREE.Group;
  public haloRing: THREE.Mesh;
  public haloLight: THREE.PointLight;
  public pickupMesh: THREE.Group;
  public isAvailable = true;
  public cooldownTimer = 0;
  public scene: THREE.Scene;

  private basePosY: number;
  private animTimer = 0;

  constructor(def: LootItemDef, scene: THREE.Scene) {
    this.def = def;
    this.scene = scene;
    this.basePosY = def.position.y;

    this.group = new THREE.Group();
    this.group.position.copy(def.position);

    // 1. Glowing Pedestal Base
    const baseGeo = new THREE.CylinderGeometry(0.7, 0.85, 0.15, 24);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.8,
    });
    const pedestal = new THREE.Mesh(baseGeo, baseMat);
    pedestal.position.set(0, 0.075, 0);
    this.group.add(pedestal);

    // 2. Rotating Glowing Halo Ring
    const haloColor = this.getHaloColor();
    const ringGeo = new THREE.RingGeometry(0.65, 0.85, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: haloColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.haloRing = new THREE.Mesh(ringGeo, ringMat);
    this.haloRing.position.set(0, 0.16, 0);
    this.group.add(this.haloRing);

    // 3. Point Light Halo Glow
    this.haloLight = new THREE.PointLight(haloColor, 2.5, 4.5);
    this.haloLight.position.set(0, 0.6, 0);
    this.group.add(this.haloLight);

    // 4. Floating 3D Pickup Mesh
    this.pickupMesh = this.buildPickupModel();
    this.pickupMesh.position.set(0, 0.75, 0);
    this.group.add(this.pickupMesh);

    this.scene.add(this.group);
  }

  private getHaloColor(): number {
    switch (this.def.type) {
      case 'health':
        return 0x10b981; // Emerald Green
      case 'ammo':
        return 0xf59e0b; // Amber Gold
      case 'weapon':
        if (this.def.weaponType === 'sniper') return 0xa855f7; // Void Purple
        if (this.def.weaponType === 'shotgun') return 0xf97316; // Fiery Orange
        if (this.def.weaponType === 'rpg') return 0xef4444; // Tactical Red
        return 0x06b6d4; // Cyan
    }
  }

  private buildPickupModel(): THREE.Group {
    const group = new THREE.Group();

    if (this.def.type === 'health') {
      // Health Medkit Box
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
      const greenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.22), boxMat);
      group.add(box);

      // Green Cross
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.23), greenMat);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.23), greenMat);
      group.add(crossV);
      group.add(crossH);
    } else if (this.def.type === 'ammo') {
      // Military Ammo Resupply Crate
      const ammoMat = new THREE.MeshStandardMaterial({ color: 0xca8a04, roughness: 0.4, metalness: 0.8 });
      const blackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });

      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.26), ammoMat);
      group.add(crate);

      const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.27), blackMat);
      group.add(band);
    } else if (this.def.type === 'weapon') {
      // Holographic Weapon Crate / Weapon Replica
      const crateMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.9 });
      const glowMat = new THREE.MeshBasicMaterial({ color: this.getHaloColor() });

      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.3), crateMat);
      group.add(pod);

      const holoBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.25, 0.4, 16), glowMat);
      holoBeam.position.set(0, 0.25, 0);
      group.add(holoBeam);

      // Miniature weapon floating inside beam
      const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.45);
      const gunMesh = new THREE.Mesh(gunGeo, glowMat);
      gunMesh.position.set(0, 0.35, 0);
      group.add(gunMesh);
    }

    return group;
  }

  public update(delta: number): void {
    this.animTimer += delta;

    if (!this.isAvailable) {
      this.cooldownTimer -= delta;
      if (this.cooldownTimer <= 0) {
        this.respawn();
      }
      return;
    }

    // Smooth Floating Bobbing & Rotation
    this.pickupMesh.position.y = 0.75 + Math.sin(this.animTimer * 2.8) * 0.12;
    this.pickupMesh.rotation.y += delta * 1.8;
    this.haloRing.rotation.z += delta * 1.2;

    // Pulsing Light
    this.haloLight.intensity = 2.0 + Math.sin(this.animTimer * 4.0) * 0.8;
  }

  public consume(): void {
    this.isAvailable = false;
    this.cooldownTimer = this.def.respawnTime; // 45s respawn
    this.pickupMesh.visible = false;
    this.haloLight.intensity = 0.2;
    (this.haloRing.material as THREE.MeshBasicMaterial).opacity = 0.2;
  }

  public respawn(): void {
    this.isAvailable = true;
    this.pickupMesh.visible = true;
    this.haloLight.intensity = 2.5;
    (this.haloRing.material as THREE.MeshBasicMaterial).opacity = 0.85;
    sounds.playHealthPickup();
  }

  public destroy(): void {
    this.scene.remove(this.group);
  }
}

export class WorldLootManager {
  public crates: WorldLootCrate[] = [];
  public scene: THREE.Scene;
  public controller: FPSController;
  public botManager?: BotManager;

  // Active interaction candidate
  public currentInteractableCrate: WorldLootCrate | null = null;
  private promptElement: HTMLElement | null = null;

  constructor(scene: THREE.Scene, controller: FPSController, botManager?: BotManager) {
    this.scene = scene;
    this.controller = controller;
    this.botManager = botManager;

    this.initHUDPrompt();
    this.spawnDefaultLootNodes();
    this.initInteractionListeners();
  }

  private initHUDPrompt(): void {
    this.promptElement = document.getElementById('loot-prompt');
    if (!this.promptElement) {
      this.promptElement = document.createElement('div');
      this.promptElement.id = 'loot-prompt';
      this.promptElement.className = 'loot-prompt-banner hidden';
      document.getElementById('hud')?.appendChild(this.promptElement);
    }
  }

  private initInteractionListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.currentInteractableCrate && this.currentInteractableCrate.isAvailable) {
        this.interactWithCrate(this.currentInteractableCrate);
      }
    });
  }

  private spawnDefaultLootNodes(): void {
    // Standard Arena Resupply Crates (Respawn every 45 seconds)
    const nodes: LootItemDef[] = [
      // 1. Health Packs (North & South flanks)
      { id: 'hp-1', type: 'health', name: 'NANO-MEDKIT (+50 HP)', position: new THREE.Vector3(-18, 0.05, 0), respawnTime: 45 },
      { id: 'hp-2', type: 'health', name: 'NANO-MEDKIT (+50 HP)', position: new THREE.Vector3(18, 0.05, 0), respawnTime: 45 },

      // 2. Ammo Boxes (East & West bases)
      { id: 'ammo-1', type: 'ammo', name: 'AMMO RESUPPLY CRATE', position: new THREE.Vector3(0, 0.05, 20), respawnTime: 45 },
      { id: 'ammo-2', type: 'ammo', name: 'AMMO RESUPPLY CRATE', position: new THREE.Vector3(0, 0.05, -20), respawnTime: 45 },

      // 3. World Weapon Crates
      { id: 'wep-sniper', type: 'weapon', weaponType: 'sniper', name: 'AWP-50 VOID SNIPER', position: new THREE.Vector3(0, 3.05, 0), respawnTime: 45 }, // Central high deck
      { id: 'wep-shotgun', type: 'weapon', weaponType: 'shotgun', name: 'SPAS-12 STRIKER', position: new THREE.Vector3(-12, 0.05, -12), respawnTime: 45 },
      { id: 'wep-rpg', type: 'weapon', weaponType: 'rpg', name: 'TITAN-RPG HEAVY', position: new THREE.Vector3(12, 0.05, 12), respawnTime: 45 },
    ];

    for (const def of nodes) {
      const crate = new WorldLootCrate(def, this.scene);
      this.crates.push(crate);
    }
  }

  public update(delta: number): void {
    const playerPos = this.controller.camera.position;
    let closestCrate: WorldLootCrate | null = null;
    let minDistance = 1.5; // 1.5m pickup radius

    for (const crate of this.crates) {
      crate.update(delta);

      if (!crate.isAvailable) continue;

      // Distance to local player
      const dist = crate.group.position.distanceTo(new THREE.Vector3(playerPos.x, 0.05, playerPos.z));

      if (dist <= 1.5) {
        if (crate.def.type === 'health') {
          // Automatic Health Pickup if not full HP
          const currentHP = this.controller.networkManager?.localHealth ?? 100;
          if (currentHP < 100) {
            this.pickupHealth(crate);
          }
        } else if (crate.def.type === 'ammo') {
          // Automatic Ammo Pickup
          this.pickupAmmo(crate);
        } else if (crate.def.type === 'weapon') {
          // Weapon Crate requires prompt [E] Swap Weapon
          if (dist < minDistance) {
            minDistance = dist;
            closestCrate = crate;
          }
        }
      }

      // Check Bot Pickups
      if (this.botManager?.bots) {
        for (const bot of this.botManager.bots) {
          if (!bot.isDead && crate.isAvailable) {
            const botDist = crate.group.position.distanceTo(new THREE.Vector3(bot.position.x, 0.05, bot.position.z));
            if (botDist <= 1.5) {
              if (crate.def.type === 'health' && bot.health < 100) {
                bot.health = Math.min(100, bot.health + 50);
                bot.updateHealthHUD();
                crate.consume();
              } else if (crate.def.type === 'ammo') {
                crate.consume();
              }
            }
          }
        }
      }
    }

    // Update HUD Prompt for Weapon Swap
    this.currentInteractableCrate = closestCrate;
    if (this.promptElement) {
      if (closestCrate && closestCrate.isAvailable) {
        this.promptElement.innerHTML = `
          <span class="prompt-key">[E]</span>
          <span class="prompt-text">SWAP WEAPON: <strong>${closestCrate.def.name}</strong></span>
        `;
        this.promptElement.classList.remove('hidden');
      } else {
        this.promptElement.classList.add('hidden');
      }
    }
  }

  private pickupHealth(crate: WorldLootCrate): void {
    if (this.controller.networkManager) {
      this.controller.networkManager.localHealth = Math.min(100, this.controller.networkManager.localHealth + 50);
      const healthElem = document.getElementById('stat-health');
      const healthBar = document.getElementById('health-bar-fill');
      if (healthElem) healthElem.textContent = `${Math.round(this.controller.networkManager.localHealth)}`;
      if (healthBar) healthBar.style.width = `${Math.max(0, this.controller.networkManager.localHealth)}%`;
    }
    sounds.playHealthPickup();
    crate.consume();

    // Flash green screen vignette
    const flash = document.getElementById('damage-flash');
    if (flash) {
      flash.style.background = 'radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(0,0,0,0) 70%)';
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 250);
    }
  }

  private pickupAmmo(crate: WorldLootCrate): void {
    if ((this.controller.weapon as any).replenishAllAmmo) {
      (this.controller.weapon as any).replenishAllAmmo();
    }
    crate.consume();
  }

  private interactWithCrate(crate: WorldLootCrate): void {
    if (crate.def.weaponType) {
      if ((this.controller.weapon as any).equipWeapon) {
        (this.controller.weapon as any).equipWeapon(crate.def.weaponType);
      }
      sounds.playWeaponSwap();
      crate.consume();
      if (this.promptElement) this.promptElement.classList.add('hidden');
    }
  }

  public destroy(): void {
    for (const crate of this.crates) {
      crate.destroy();
    }
    this.crates = [];
  }
}
