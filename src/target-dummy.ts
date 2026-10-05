import * as THREE from 'three';
import { RAPIER, physics } from './physics';
import { sounds } from './weapon-system';

export type HitboxType = 'head' | 'torso' | 'limbs';

export interface HitboxInfo {
  dummy: TargetDummy;
  hitboxType: HitboxType;
  multiplier: number;
}

export interface FloatingText {
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  isHeadshot: boolean;
}

export class TargetDummy {
  public id: string;
  public group: THREE.Group;
  public body!: RAPIER.RigidBody;
  public colliders: Map<number, HitboxInfo> = new Map();
  public maxHealth = 100;
  public currentHealth = 100;
  public isDead = false;
  private respawnTimer = 0;
  private readonly RESPAWN_DELAY = 3.5;
  private spawnPos: THREE.Vector3;

  // Visuals
  private meshes: THREE.Mesh[] = [];
  private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
  private hitFlashTimer = 0;
  private healthBarCanvas!: HTMLCanvasElement;
  private healthBarTexture!: THREE.CanvasTexture;
  private healthBarSprite!: THREE.Sprite;

  constructor(id: string, pos: THREE.Vector3, scene: THREE.Scene, dummyManager: DummyManager) {
    this.id = id;
    this.spawnPos = pos.clone();
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);

    this.buildHumanoidModel();
    this.initPhysics(dummyManager);
    this.createHealthBar();
  }

  private buildHumanoidModel(): void {
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.3,
    });

    const bodyFrameMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.5,
      roughness: 0.6,
    });

    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.2,
    });

    const glowVisorMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
    });

    // 1. Torso / Chest
    const torsoGeo = new THREE.BoxGeometry(0.55, 0.65, 0.3);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.group.add(torso);
    this.registerMesh(torso);

    // Core light
    const coreGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16);
    coreGeo.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(coreGeo, glowVisorMat);
    core.position.set(0, 1.3, 0.16);
    this.group.add(core);
    this.registerMesh(core);

    // 2. Pelvis / Waist
    const pelvisGeo = new THREE.BoxGeometry(0.42, 0.25, 0.26);
    const pelvis = new THREE.Mesh(pelvisGeo, bodyFrameMat);
    pelvis.position.set(0, 0.85, 0);
    pelvis.castShadow = true;
    this.group.add(pelvis);
    this.registerMesh(pelvis);

    // 3. Head
    const headGeo = new THREE.BoxGeometry(0.3, 0.32, 0.3);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 1.8, 0);
    head.castShadow = true;
    this.group.add(head);
    this.registerMesh(head);

    // Glowing Eye Visor
    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.06);
    const visor = new THREE.Mesh(visorGeo, glowVisorMat);
    visor.position.set(0, 1.82, 0.16);
    this.group.add(visor);
    this.registerMesh(visor);

    // 4. Arms (Left & Right)
    const armGeo = new THREE.BoxGeometry(0.16, 0.65, 0.18);

    const leftArm = new THREE.Mesh(armGeo, armorMat);
    leftArm.position.set(-0.4, 1.2, 0);
    leftArm.castShadow = true;
    this.group.add(leftArm);
    this.registerMesh(leftArm);

    const rightArm = new THREE.Mesh(armGeo, armorMat);
    rightArm.position.set(0.4, 1.2, 0);
    rightArm.castShadow = true;
    this.group.add(rightArm);
    this.registerMesh(rightArm);

    // 5. Legs (Left & Right)
    const legGeo = new THREE.BoxGeometry(0.18, 0.75, 0.2);

    const leftLeg = new THREE.Mesh(legGeo, bodyFrameMat);
    leftLeg.position.set(-0.16, 0.38, 0);
    leftLeg.castShadow = true;
    this.group.add(leftLeg);
    this.registerMesh(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, bodyFrameMat);
    rightLeg.position.set(0.16, 0.38, 0);
    rightLeg.castShadow = true;
    this.group.add(rightLeg);
    this.registerMesh(rightLeg);
  }

  private registerMesh(mesh: THREE.Mesh): void {
    this.meshes.push(mesh);
    this.originalMaterials.set(mesh, mesh.material);
  }

  private initPhysics(dummyManager: DummyManager): void {
    // Create fixed/kinematic rigid body for the dummy at spawn location
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      this.spawnPos.x,
      this.spawnPos.y,
      this.spawnPos.z
    );
    this.body = physics.world.createRigidBody(bodyDesc);

    // 1. Head Collider (Multiplier 2.5x)
    const headColliderDesc = RAPIER.ColliderDesc.cuboid(0.18, 0.18, 0.18)
      .setTranslation(0, 1.8, 0);
    const headCollider = physics.world.createCollider(headColliderDesc, this.body);
    const headInfo: HitboxInfo = { dummy: this, hitboxType: 'head', multiplier: 2.5 };
    this.colliders.set(headCollider.handle, headInfo);
    dummyManager.registerHitbox(headCollider.handle, headInfo);

    // 2. Torso Collider (Multiplier 1.0x)
    const torsoColliderDesc = RAPIER.ColliderDesc.cuboid(0.3, 0.45, 0.2)
      .setTranslation(0, 1.15, 0);
    const torsoCollider = physics.world.createCollider(torsoColliderDesc, this.body);
    const torsoInfo: HitboxInfo = { dummy: this, hitboxType: 'torso', multiplier: 1.0 };
    this.colliders.set(torsoCollider.handle, torsoInfo);
    dummyManager.registerHitbox(torsoCollider.handle, torsoInfo);

    // 3. Limbs Colliders (Arms & Legs - Multiplier 0.7x)
    // Left Arm
    const leftArmDesc = RAPIER.ColliderDesc.cuboid(0.1, 0.35, 0.12).setTranslation(-0.4, 1.2, 0);
    const leftArmCollider = physics.world.createCollider(leftArmDesc, this.body);
    const limbsInfo: HitboxInfo = { dummy: this, hitboxType: 'limbs', multiplier: 0.7 };
    this.colliders.set(leftArmCollider.handle, limbsInfo);
    dummyManager.registerHitbox(leftArmCollider.handle, limbsInfo);

    // Right Arm
    const rightArmDesc = RAPIER.ColliderDesc.cuboid(0.1, 0.35, 0.12).setTranslation(0.4, 1.2, 0);
    const rightArmCollider = physics.world.createCollider(rightArmDesc, this.body);
    this.colliders.set(rightArmCollider.handle, limbsInfo);
    dummyManager.registerHitbox(rightArmCollider.handle, limbsInfo);

    // Legs
    const legsDesc = RAPIER.ColliderDesc.cuboid(0.24, 0.4, 0.15).setTranslation(0, 0.4, 0);
    const legsCollider = physics.world.createCollider(legsDesc, this.body);
    this.colliders.set(legsCollider.handle, limbsInfo);
    dummyManager.registerHitbox(legsCollider.handle, limbsInfo);
  }

  private createHealthBar(): void {
    this.healthBarCanvas = document.createElement('canvas');
    this.healthBarCanvas.width = 256;
    this.healthBarCanvas.height = 48;
    this.healthBarTexture = new THREE.CanvasTexture(this.healthBarCanvas);

    const spriteMat = new THREE.SpriteMaterial({
      map: this.healthBarTexture,
      transparent: true,
      depthTest: false,
    });

    this.healthBarSprite = new THREE.Sprite(spriteMat);
    this.healthBarSprite.scale.set(1.4, 0.26, 1.0);
    this.healthBarSprite.position.set(0, 2.2, 0);
    this.group.add(this.healthBarSprite);

    this.drawHealthBar();
  }

  private drawHealthBar(): void {
    const ctx = this.healthBarCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 48);

    if (this.isDead) return;

    // Background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect(4, 8, 248, 32, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill bar
    const healthPercent = Math.max(0, this.currentHealth / this.maxHealth);
    const fillWidth = (248 - 8) * healthPercent;

    const grad = ctx.createLinearGradient(8, 0, 240, 0);
    if (healthPercent > 0.5) {
      grad.addColorStop(0, '#10b981');
      grad.addColorStop(1, '#00f0ff');
    } else if (healthPercent > 0.25) {
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(1, '#fbbf24');
    } else {
      grad.addColorStop(0, '#ef4444');
      grad.addColorStop(1, '#f87171');
    }

    if (fillWidth > 0) {
      ctx.fillStyle = grad;
      ctx.roundRect(8, 12, fillWidth, 24, 4);
      ctx.fill();
    }

    // Health text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(this.currentHealth)} HP`, 128, 25);

    this.healthBarTexture.needsUpdate = true;
  }

  public takeDamage(
    baseDamage: number,
    hitboxType: HitboxType,
    hitPoint: THREE.Vector3,
    hitDir: THREE.Vector3,
    dummyManager: DummyManager
  ): { damage: number; isDead: boolean; isHeadshot: boolean } {
    if (this.isDead) return { damage: 0, isDead: false, isHeadshot: false };

    let multiplier = 1.0;
    if (hitboxType === 'head') multiplier = 2.5;
    else if (hitboxType === 'limbs') multiplier = 0.7;

    const finalDamage = Math.round(baseDamage * multiplier);
    this.currentHealth = Math.max(0, this.currentHealth - finalDamage);

    const isHeadshot = hitboxType === 'head';
    const killed = this.currentHealth <= 0;

    // Visual Hit Flash
    this.hitFlashTimer = 0.12;
    this.flashDamageMaterial(isHeadshot);

    // Update Health Bar
    this.drawHealthBar();

    // Spawn Floating Damage Text
    dummyManager.spawnFloatingText(hitPoint, finalDamage, isHeadshot);

    // Trigger Hitmarker in HUD
    dummyManager.triggerHitmarker(isHeadshot);

    // Check for elimination
    if (killed) {
      this.die(hitDir, dummyManager, isHeadshot, finalDamage);
    }

    return { damage: finalDamage, isDead: killed, isHeadshot };
  }

  private flashDamageMaterial(isHeadshot: boolean): void {
    const flashMat = new THREE.MeshBasicMaterial({
      color: isHeadshot ? 0xff0044 : 0xffffff,
    });

    this.meshes.forEach((mesh) => {
      mesh.material = flashMat;
    });
  }

  private resetMaterials(): void {
    this.meshes.forEach((mesh) => {
      const orig = this.originalMaterials.get(mesh);
      if (orig) mesh.material = orig;
    });
  }

  private die(
    hitDir: THREE.Vector3,
    dummyManager: DummyManager,
    isHeadshot: boolean,
    lastDamage: number
  ): void {
    this.isDead = true;
    this.respawnTimer = this.RESPAWN_DELAY;

    // Collapse animation (tilt backward/down)
    this.group.rotation.x = -Math.PI / 2.2;
    this.group.position.y = this.spawnPos.y + 0.2;
    this.drawHealthBar();

    // Add Killfeed entry
    dummyManager.addKillfeedEntry({
      target: `DUMMY-${this.id}`,
      hitbox: isHeadshot ? 'HEADSHOT' : 'TORSO',
      damage: lastDamage,
      isHeadshot,
    });
  }

  public respawn(): void {
    this.isDead = false;
    this.currentHealth = this.maxHealth;
    this.group.rotation.set(0, 0, 0);
    this.group.position.copy(this.spawnPos);
    this.resetMaterials();
    this.drawHealthBar();
  }

  public update(delta: number): void {
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= delta;
      if (this.hitFlashTimer <= 0) {
        this.resetMaterials();
      }
    }

    if (this.isDead) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
    }
  }
}

// ==================== DUMMY & FLOATING TEXT MANAGER ====================

export interface KillfeedItem {
  target: string;
  hitbox: string;
  damage: number;
  isHeadshot: boolean;
}

export class DummyManager {
  public dummies: TargetDummy[] = [];
  public hitboxMap: Map<number, HitboxInfo> = new Map();
  public floatingTexts: FloatingText[] = [];
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }

  public registerHitbox(handle: number, info: HitboxInfo): void {
    this.hitboxMap.set(handle, info);
  }

  public getHitboxInfo(handle: number): HitboxInfo | undefined {
    return this.hitboxMap.get(handle);
  }

  public spawnDummies(): void {
    const spawnLocations = [
      new THREE.Vector3(0, 0, -10),
      new THREE.Vector3(-10, 0, -6),
      new THREE.Vector3(10, 0, -6),
      new THREE.Vector3(-14, 0, 6),
      new THREE.Vector3(14, 0, 6),
      new THREE.Vector3(0, 3.0, 0), // Elevated on central deck
    ];

    spawnLocations.forEach((pos, idx) => {
      const dummy = new TargetDummy(`0${idx + 1}`, pos, this.scene, this);
      this.dummies.push(dummy);
    });
  }

  public spawnFloatingText(pos: THREE.Vector3, damage: number, isHeadshot: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const text = isHeadshot ? `CRIT ${damage}` : `${damage}`;
    const textColor = isHeadshot ? '#ff2a5f' : '#00f0ff';
    const strokeColor = '#000000';

    ctx.fillStyle = textColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 6;
    ctx.font = isHeadshot ? '900 48px "JetBrains Mono", sans-serif' : '800 42px "JetBrains Mono", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeText(text, 128, 64);
    ctx.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMat);
    const baseScale = isHeadshot ? 1.5 : 1.1;
    sprite.scale.set(baseScale, baseScale * 0.5, 1);

    // Initial position slightly offset with jitter
    const spawnP = pos.clone().add(
      new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4)
    );
    sprite.position.copy(spawnP);
    this.scene.add(sprite);

    this.floatingTexts.push({
      sprite,
      pos: spawnP,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8),
      life: 0,
      maxLife: 0.85,
      scale: baseScale,
      isHeadshot,
    });
  }

  public triggerHitmarker(isHeadshot: boolean): void {
    // Play sound
    if (isHeadshot) {
      sounds.playHeadshotTick();
    } else {
      sounds.playHitmarkerTick();
    }

    // UI crosshair tick
    const hitmarker = document.getElementById('hitmarker');
    if (hitmarker) {
      hitmarker.className = isHeadshot ? 'active headshot' : 'active';
      setTimeout(() => {
        hitmarker.className = '';
      }, 90);
    }
  }

  public addKillfeedEntry(item: KillfeedItem): void {
    const feed = document.getElementById('killfeed');
    if (!feed) return;

    const entry = document.createElement('div');
    entry.className = `killfeed-item ${item.isHeadshot ? 'headshot-kill' : ''}`;
    entry.innerHTML = `
      <span class="kill-icon">🎯</span>
      <span class="kill-target">ELIMINATED ${item.target}</span>
      <span class="kill-badge ${item.isHeadshot ? 'badge-crit' : 'badge-body'}">[${item.hitbox} ${item.damage} DMG]</span>
    `;

    feed.prepend(entry);

    // Animate in and remove after 3.5s
    setTimeout(() => {
      entry.classList.add('fade-out');
      setTimeout(() => entry.remove(), 400);
    }, 3200);
  }

  public update(delta: number): void {
    // 1. Update Dummies
    this.dummies.forEach((d) => d.update(delta));

    // 2. Update Floating Text animations
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += delta;

      if (ft.life >= ft.maxLife) {
        this.scene.remove(ft.sprite);
        ft.sprite.material.dispose();
        this.floatingTexts.splice(i, 1);
        continue;
      }

      // Physics float upward & scale pop
      ft.pos.addScaledVector(ft.vel, delta);
      ft.sprite.position.copy(ft.pos);

      const progress = ft.life / ft.maxLife;
      // Scale pop on start, gentle fade out at end
      const scaleMultiplier = progress < 0.2 ? 1.0 + (progress / 0.2) * 0.3 : 1.3 - progress * 0.4;
      ft.sprite.scale.set(ft.scale * scaleMultiplier, ft.scale * scaleMultiplier * 0.5, 1);

      if (progress > 0.5) {
        ft.sprite.material.opacity = (1.0 - progress) / 0.5;
      }
    }
  }
}
