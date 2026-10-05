import * as THREE from 'three';
import * as YUKA from 'yuka';
import { PatrolState, PursueState, CombatState, RushFlankState, FleeState, InvestigatingState } from './bot-states';
import { FXManager, sounds } from '../weapon-system';
import { RAPIER, physics } from '../physics';
import { FPSController } from '../fps-controller';
import { Damageable, scoreManager } from '../scoring/score-manager';
import { threatManager } from './threat-manager';
import { gameState } from '../game-state';

export class BotEntity extends YUKA.Vehicle implements Damageable {
  public name: string;
  public id: string;
  public health = 100;
  public maxHealth = 100;
  public isDead = false;
  public attackRange = 22.0;
  public team: 'blue' | 'red' | 'ffa' = 'red';
  public botManager?: any;

  // Threat & Noise Investigation
  public investigatePosition: THREE.Vector3 | null = null;

  // Weapon & Combat Configuration
  public weaponType: 'rifle' | 'shotgun' | 'smg' = 'rifle';
  public isCrouching = false;
  public crouchOffset = 0.0;

  public stateMachine: YUKA.StateMachine<BotEntity>;
  public navMesh: YUKA.NavMesh;
  public scene: THREE.Scene;
  public targetPlayer: FPSController;
  public fx: FXManager;

  // 3D Visual Mesh Components
  public meshGroup: THREE.Group;
  public torsoMesh!: THREE.Mesh;
  public headMesh!: THREE.Mesh;
  public visorMesh!: THREE.Mesh;
  public leftLegMesh!: THREE.Mesh;
  public rightLegMesh!: THREE.Mesh;
  public weaponMesh!: THREE.Mesh;
  public muzzleFlashSprite!: THREE.Sprite;
  public nameplateSprite!: THREE.Sprite;
  public statusSprite!: THREE.Sprite;
  public statusContext!: CanvasRenderingContext2D;
  public statusTexture!: THREE.CanvasTexture;

  // Rapier Colliders for Head, Torso, and Limbs
  public headCollider!: RAPIER.Collider;
  public torsoCollider!: RAPIER.Collider;
  public limbCollider!: RAPIER.Collider;
  public headBody!: RAPIER.RigidBody;
  public torsoBody!: RAPIER.RigidBody;
  public limbBody!: RAPIER.RigidBody;
  public hitMeshes: THREE.Mesh[] = [];

  // Pathfinding & Behaviors
  public followPathBehavior: YUKA.FollowPathBehavior;
  public onPathBehavior: YUKA.OnPathBehavior;
  public currentPath: YUKA.Path;

  // Waypoints
  public patrolWaypoints: YUKA.Vector3[] = [];
  public currentPatrolIndex = 0;
  public coverWaypoints: YUKA.Vector3[] = [];

  // Raycaster for Line of Sight
  private visionRaycaster = new THREE.Raycaster();

  constructor(
    id: string,
    name: string,
    spawnPos: THREE.Vector3,
    scene: THREE.Scene,
    navMesh: YUKA.NavMesh,
    targetPlayer: FPSController,
    fx: FXManager,
    team: 'blue' | 'red' | 'ffa' = 'red',
    botManager?: any
  ) {
    super();

    this.id = id;
    this.name = name;
    this.scene = scene;
    this.navMesh = navMesh;
    this.targetPlayer = targetPlayer;
    this.fx = fx;
    this.team = team;
    this.botManager = botManager;

    // Yuka Setup
    this.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    this.maxSpeed = 6.0;
    this.maxForce = 150.0;
    this.boundingRadius = 0.6;

    this.currentPath = new YUKA.Path();
    this.followPathBehavior = new YUKA.FollowPathBehavior(this.currentPath, 1.5);
    this.onPathBehavior = new YUKA.OnPathBehavior(this.currentPath, 0.8, 1.2);

    this.steering.add(this.followPathBehavior);
    this.steering.add(this.onPathBehavior);

    // Initialize Waypoints
    this.initWaypoints();

    // 3D Visual Mesh
    this.meshGroup = new THREE.Group();
    this.meshGroup.position.copy(spawnPos);
    this.scene.add(this.meshGroup);
    this.buildBotModel();
    this.createNameplate();
    this.initHitboxPhysics();

    // Setup FSM with aggressive combat & threat detection states
    this.stateMachine = new YUKA.StateMachine<BotEntity>(this);
    this.stateMachine.add('PATROL', new PatrolState());
    this.stateMachine.add('INVESTIGATING', new InvestigatingState());
    this.stateMachine.add('COMBAT', new CombatState());
    this.stateMachine.add('ATTACK', new CombatState()); // Alias
    this.stateMachine.add('RUSH_FLANK', new RushFlankState());
    this.stateMachine.add('PURSUE', new PursueState());
    this.stateMachine.add('FLEE', new FleeState());
    this.stateMachine.changeTo('PATROL');

    // Register with ThreatManager
    threatManager.registerBot(this);
  }

  private initWaypoints(): void {
    // Patrol loops around arena
    this.patrolWaypoints = [
      new YUKA.Vector3(-14, 0.05, -14),
      new YUKA.Vector3(14, 0.05, -14),
      new YUKA.Vector3(0, 3.05, 0), // Central elevated deck
      new YUKA.Vector3(14, 0.05, 14),
      new YUKA.Vector3(-14, 0.05, 14),
      new YUKA.Vector3(0, 0.05, 24),
      new YUKA.Vector3(0, 0.05, -24),
    ];

    // Cover nodes behind obstacle towers & ramps
    this.coverWaypoints = [
      new YUKA.Vector3(-24, 0.05, -24),
      new YUKA.Vector3(24, 0.05, -24),
      new YUKA.Vector3(-24, 0.05, 24),
      new YUKA.Vector3(24, 0.05, 24),
      new YUKA.Vector3(0, 0.05, -34),
      new YUKA.Vector3(0, 0.05, 34),
    ];
  }

  private buildBotModel(): void {
    const armorColor = this.team === 'blue' ? 0x2563eb : this.team === 'red' ? 0xdc2626 : 0xd97706;
    const visorColor = this.team === 'red' ? 0xff4444 : 0x00f0ff;

    const armorMat = new THREE.MeshStandardMaterial({
      color: armorColor, // Team-specific Cyber Armor
      roughness: 0.35,
      metalness: 0.85,
    });

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.7,
      metalness: 0.3,
    });

    const visorMat = new THREE.MeshBasicMaterial({ color: visorColor }); // Team Visor

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.65, 0.3);
    this.torsoMesh = new THREE.Mesh(torsoGeo, armorMat);
    this.torsoMesh.position.set(0, 0.95, 0);
    this.torsoMesh.castShadow = true;
    this.torsoMesh.userData = { hitboxType: 'torso', bot: this };
    this.meshGroup.add(this.torsoMesh);
    this.hitMeshes.push(this.torsoMesh);

    // 2. Head
    const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
    this.headMesh = new THREE.Mesh(headGeo, armorMat);
    this.headMesh.position.set(0, 1.48, 0);
    this.headMesh.castShadow = true;
    this.headMesh.userData = { hitboxType: 'head', bot: this };
    this.meshGroup.add(this.headMesh);
    this.hitMeshes.push(this.headMesh);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.22, 0.08, 0.05);
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 1.5, 0.15);
    this.meshGroup.add(this.visorMesh);

    // 3. Legs
    const legGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
    this.leftLegMesh = new THREE.Mesh(legGeo, bodyMat);
    this.leftLegMesh.position.set(-0.14, 0.32, 0);
    this.leftLegMesh.userData = { hitboxType: 'limb', bot: this };
    this.meshGroup.add(this.leftLegMesh);
    this.hitMeshes.push(this.leftLegMesh);

    const rightLegGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
    this.rightLegMesh = new THREE.Mesh(rightLegGeo, bodyMat);
    this.rightLegMesh.position.set(0.14, 0.32, 0);
    this.rightLegMesh.userData = { hitboxType: 'limb', bot: this };
    this.meshGroup.add(this.rightLegMesh);
    this.hitMeshes.push(this.rightLegMesh);

    // 4. Weapon Mesh
    const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.45);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
    this.weaponMesh = new THREE.Mesh(gunGeo, gunMat);
    this.weaponMesh.position.set(0.25, 0.95, 0.35);
    this.meshGroup.add(this.weaponMesh);

    // Muzzle flash sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(245,158,11,0.9)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();

    const flashTex = new THREE.CanvasTexture(canvas);
    const flashMat = new THREE.SpriteMaterial({
      map: flashTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0, 0, 0);
    this.muzzleFlashSprite.position.set(0.25, 0.95, 0.6);
    this.meshGroup.add(this.muzzleFlashSprite);
  }

  private createNameplate(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    this.statusContext = canvas.getContext('2d')!;
    this.statusTexture = new THREE.CanvasTexture(canvas);

    this.updateNameplateCanvas('PATROL');

    const spriteMat = new THREE.SpriteMaterial({
      map: this.statusTexture,
      transparent: true,
      depthTest: false,
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.scale.set(1.5, 0.45, 1);
    this.nameplateSprite.position.set(0, 2.0, 0);
    this.meshGroup.add(this.nameplateSprite);
  }

  private updateNameplateCanvas(statusText: string): void {
    const ctx = this.statusContext;
    ctx.clearRect(0, 0, 256, 80);

    const teamBorderColor = this.team === 'blue' ? '#3b82f6' : this.team === 'red' ? '#ef4444' : '#f59e0b';
    const teamBadge = this.team === 'blue' ? '[BLUE]' : this.team === 'red' ? '[RED]' : '[SOLO]';

    // Nameplate frame
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.roundRect(4, 4, 248, 72, 8);
    ctx.fill();
    ctx.strokeStyle = teamBorderColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Bot Name & Team
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${teamBadge} ${this.name} [${this.health}HP]`, 128, 28);

    // FSM State Indicator Badge
    ctx.fillStyle = this.health < 25 ? '#ef4444' : teamBorderColor;
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillText(`STATUS: ${statusText}`, 128, 54);

    this.statusTexture.needsUpdate = true;
  }

  public showStatusAlert(status: string): void {
    this.updateNameplateCanvas(status);
  }

  private initHitboxPhysics(): void {
    const headBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.48, 0);
    this.headBody = physics.world.createRigidBody(headBodyDesc);
    const headColliderDesc = RAPIER.ColliderDesc.cuboid(0.18, 0.18, 0.18);
    this.headCollider = physics.world.createCollider(headColliderDesc, this.headBody);

    const torsoBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.95, 0);
    this.torsoBody = physics.world.createRigidBody(torsoBodyDesc);
    const torsoColliderDesc = RAPIER.ColliderDesc.cuboid(0.28, 0.35, 0.18);
    this.torsoCollider = physics.world.createCollider(torsoColliderDesc, this.torsoBody);

    const limbBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.32, 0);
    this.limbBody = physics.world.createRigidBody(limbBodyDesc);
    const limbColliderDesc = RAPIER.ColliderDesc.cuboid(0.24, 0.35, 0.18);
    this.limbCollider = physics.world.createCollider(limbColliderDesc, this.limbBody);
  }

  // ==================== NAVIGATION & PATHFINDING ====================

  public findPathToNextPatrolWaypoint(): void {
    if (this.patrolWaypoints.length === 0) return;

    this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolWaypoints.length;
    const target = this.patrolWaypoints[this.currentPatrolIndex];

    this.setPathToTarget(target);
    this.showStatusAlert('PATROL');
  }

  public findPathToTarget(): void {
    const enemy = this.getVisibleEnemy();
    let targetVec: YUKA.Vector3;

    if (enemy) {
      targetVec = new YUKA.Vector3(enemy.target.x, enemy.target.y, enemy.target.z);
    } else if (this.targetPlayer?.body) {
      const p = this.targetPlayer.body.translation();
      targetVec = new YUKA.Vector3(p.x, p.y, p.z);
    } else {
      return;
    }

    this.setPathToTarget(targetVec);
    this.showStatusAlert('PURSUE');
  }

  public findPathToCover(): void {
    if (this.coverWaypoints.length === 0) return;

    // Pick cover node furthest away from target player
    const playerPos = this.targetPlayer?.body?.translation() || { x: 0, y: 0, z: 0 };
    let bestCover = this.coverWaypoints[0];
    let maxDist = -1;

    for (const cover of this.coverWaypoints) {
      const dist = Math.hypot(cover.x - playerPos.x, cover.z - playerPos.z);
      if (dist > maxDist) {
        maxDist = dist;
        bestCover = cover;
      }
    }

    this.setPathToTarget(bestCover);
  }

  public setPathToTarget(targetVec: YUKA.Vector3): void {
    const from = new YUKA.Vector3(this.position.x, this.position.y, this.position.z);
    const waypoints = (this.navMesh as any).findPath(from, targetVec);

    this.currentPath.clear();
    if (waypoints && waypoints.length > 0) {
      for (const p of waypoints) {
        this.currentPath.add(p);
      }
      this.followPathBehavior.active = true;
      this.onPathBehavior.active = true;
    } else {
      this.currentPath.add(targetVec);
      this.followPathBehavior.active = true;
      this.onPathBehavior.active = true;
    }
  }

  /**
   * Active Patrol Sweeping: Smoothly pan head and weapon left/right (±45°) to scan corners
   */
  public applyPatrolSweep(angleOffset: number): void {
    if (this.headMesh) this.headMesh.rotation.y = angleOffset;
    if (this.visorMesh) this.visorMesh.rotation.y = angleOffset;
    if (this.weaponMesh) this.weaponMesh.rotation.y = angleOffset * 0.7;
  }

  public resetPatrolSweep(): void {
    if (this.headMesh) this.headMesh.rotation.y = 0;
    if (this.visorMesh) this.visorMesh.rotation.y = 0;
    if (this.weaponMesh) this.weaponMesh.rotation.y = 0;
  }

  /**
   * Hearing reaction: When a sound alert is propagated within hearing radius,
   * transition to INVESTIGATING and advance cautiously toward the noise coordinates.
   */
  public onHearNoise(noisePos: THREE.Vector3, distance: number, _emitterId?: string): void {
    if (this.isDead || !gameState.isPlaying()) return;
    const currentState = this.stateMachine.currentState?.constructor.name;
    if (currentState === 'PatrolState' || currentState === 'InvestigatingState') {
      console.log(`[BOT-AI] ${this.name} heard noise at dist ${distance.toFixed(1)}m! Investigating...`);
      this.investigatePosition = noisePos.clone();
      this.stateMachine.changeTo('INVESTIGATING');
    }
  }

  /**
   * Squad Backup: When an allied bot calls for backup within 20m, converge on target position.
   */
  public onBackupRequested(enemyPos: THREE.Vector3, caller: BotEntity): void {
    if (this.isDead || !gameState.isPlaying()) return;
    const currentState = this.stateMachine.currentState?.constructor.name;
    if (currentState === 'PatrolState' || currentState === 'InvestigatingState') {
      console.log(`[BOT-AI] ${this.name} responding to backup call from ${caller.name}!`);
      this.investigatePosition = enemyPos.clone();
      this.stateMachine.changeTo('INVESTIGATING');
    }
  }

  public hasReachedCurrentPath(): boolean {
    if (!this.followPathBehavior.active || this.currentPath.finished()) {
      this.followPathBehavior.active = false;
      this.onPathBehavior.active = false;
      return true;
    }
    return false;
  }

  public clearPath(): void {
    this.currentPath.clear();
    this.followPathBehavior.active = false;
    this.onPathBehavior.active = false;
  }

  // ==================== SENSORS & VISION ====================

  /**
   * Performs raycasts from the bot's eye level (position.y + 1.6) to all opposing entities
   * aimed at center mass (position.y + 1.2) within 40 meters, excluding self colliders.
   */
  public getVisibleEnemy(): { target: THREE.Vector3; distance: number; enemyBot?: BotEntity } | null {
    const botEye = new THREE.Vector3(this.position.x, this.position.y + 1.6, this.position.z);
    
    // Opposing entities candidate list
    const candidates: Array<{ pos: THREE.Vector3; bot?: BotEntity }> = [];

    // Local player team check: Local player is Team Blue (Host)
    const localIsHost = this.targetPlayer?.networkManager?.isHost ?? true;
    const localPlayerTeam = localIsHost ? 'blue' : 'red';

    if (this.targetPlayer?.body && !this.targetPlayer.isDead) {
      if (this.team === 'ffa' || this.team !== localPlayerTeam) {
        const p = this.targetPlayer.body.translation();
        candidates.push({ pos: new THREE.Vector3(p.x, p.y + 1.2, p.z) });
      }
    } else if (this.targetPlayer?.camera && !this.targetPlayer.isDead) {
      if (this.team === 'ffa' || this.team !== localPlayerTeam) {
        const camPos = this.targetPlayer.camera.position;
        candidates.push({ pos: new THREE.Vector3(camPos.x, camPos.y - 0.4, camPos.z) });
      }
    }

    // Remote Peers (Opponents)
    if (this.targetPlayer?.networkManager) {
      const peerTeam = localIsHost ? 'red' : 'blue';
      for (const peer of this.targetPlayer.networkManager.peers.values()) {
        if (!peer.isDead && (this.team === 'ffa' || this.team !== peerTeam)) {
          candidates.push({ pos: new THREE.Vector3(peer.currentPos.x, peer.currentPos.y + 1.2, peer.currentPos.z) });
        }
      }
    }

    // Other Bots in Arena
    if (this.botManager?.bots) {
      for (const otherBot of this.botManager.bots as BotEntity[]) {
        if (otherBot !== this && !otherBot.isDead) {
          if (this.team === 'ffa' || this.team !== otherBot.team) {
            candidates.push({
              pos: new THREE.Vector3(otherBot.position.x, otherBot.position.y + 1.2, otherBot.position.z),
              bot: otherBot,
            });
          }
        }
      }
    }

    // Bot forward direction vector in world space
    const botForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.meshGroup.quaternion);
    botForward.y = 0;
    botForward.normalize();

    // 110-degree FOV total (55 degrees half-angle)
    const fovCosThreshold = Math.cos(THREE.MathUtils.degToRad(110 / 2)); // cos(55°) ≈ 0.573576

    let closestCandidate: { target: THREE.Vector3; distance: number; enemyBot?: BotEntity } | null = null;
    let minDistance = 40.0; // 40-meter combat acquisition range

    for (const item of candidates) {
      const dir = item.pos.clone().sub(botEye);
      const dist = dir.length();

      // 1. Distance check (< 40 meters)
      if (dist > minDistance) continue;

      const flatDir = dir.clone().setY(0).normalize();
      const dot = botForward.dot(flatDir);

      // 2. Field of View check (110 degrees)
      if (dot < fovCosThreshold) continue;

      // 3. Line of Sight Raycast Verification (Excluding bot's own hitbox colliders)
      dir.normalize();
      const rayStart = botEye.clone().addScaledVector(dir, 0.35);
      const remainingDist = Math.max(0.1, dist - 0.45);
      const rapierRay = new RAPIER.Ray(
        { x: rayStart.x, y: rayStart.y, z: rayStart.z },
        { x: dir.x, y: dir.y, z: dir.z }
      );

      const hit = physics.world.castRay(
        rapierRay,
        remainingDist,
        true,
        undefined,
        undefined,
        this.torsoCollider,
        this.torsoBody,
        (collider) => {
          // Explicitly ignore all self-colliders (Head, Torso, Limbs)
          if (
            collider.handle === this.headCollider?.handle ||
            collider.handle === this.torsoCollider?.handle ||
            collider.handle === this.limbCollider?.handle
          ) {
            return false;
          }
          return true;
        }
      );

      // Clear line of sight if no obstacle blocks raycast
      if (!hit) {
        if (dist < minDistance) {
          minDistance = dist;
          closestCandidate = { target: item.pos, distance: dist, enemyBot: item.bot };
        }
      }
    }

    return closestCandidate;
  }

  public canSeeTargetEnemy(): boolean {
    return this.getVisibleEnemy() !== null;
  }

  public getDistanceToTarget(): number {
    const enemy = this.getVisibleEnemy();
    if (enemy) return enemy.distance;
    if (!this.targetPlayer?.body) return 999;
    const p = this.targetPlayer.body.translation();
    return Math.hypot(this.position.x - p.x, this.position.z - p.z);
  }

  // ==================== AIMING & WEAPON SYSTEMS ====================

  /**
   * Smoothly rotates the bot's transform toward the target over 0.2 seconds.
   */
  public smoothAimAt(targetPos: THREE.Vector3, delta: number): void {
    const dir = new THREE.Vector3(targetPos.x - this.position.x, 0, targetPos.z - this.position.z);
    if (dir.lengthSq() < 0.001) return;
    dir.normalize();

    // Target yaw angle
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);

    // Smooth slerp rotation over 0.2 seconds
    const slerpFactor = Math.min(1.0, delta / 0.2);
    this.meshGroup.quaternion.slerp(targetQuaternion, slerpFactor);

    // Synchronize Yuka forward and Euler rotation
    const euler = new THREE.Euler().setFromQuaternion(this.meshGroup.quaternion, 'YXZ');
    this.meshGroup.rotation.y = euler.y;
    this.forward.set(-Math.sin(euler.y), 0, -Math.cos(euler.y)).normalize();
  }

  public lockAimAt(targetPos: THREE.Vector3): void {
    const dir = new THREE.Vector3(targetPos.x - this.position.x, 0, targetPos.z - this.position.z);
    if (dir.lengthSq() < 0.001) return;
    dir.normalize();

    const targetYaw = Math.atan2(-dir.x, -dir.z);
    this.meshGroup.rotation.y = targetYaw;
    this.meshGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
    this.forward.set(-Math.sin(targetYaw), 0, -Math.cos(targetYaw)).normalize();
  }

  public combatCircleStrafe(dirMultiplier: number, targetDistance: number): void {
    const enemy = this.getVisibleEnemy();
    const targetPos = enemy ? enemy.target : (this.targetPlayer?.body ? new THREE.Vector3(this.targetPlayer.body.translation().x, this.targetPlayer.body.translation().y + 1.2, this.targetPlayer.body.translation().z) : null);
    if (!targetPos) return;

    // Vector towards target
    const toTarget = new THREE.Vector3(targetPos.x - this.position.x, 0, targetPos.z - this.position.z);
    if (toTarget.lengthSq() < 0.001) return;
    toTarget.normalize();

    // Perpendicular tangent vector (lateral circle strafe)
    const tangent = new THREE.Vector3(-toTarget.z * dirMultiplier, 0, toTarget.x * dirMultiplier);

    // Distance management: advance if target is far, back up if too close
    let radialFactor = 0;
    if (targetDistance > 16.0) radialFactor = 0.45; // Advance
    else if (targetDistance < 6.5) radialFactor = -0.35; // Step back

    const moveDir = tangent.clone().addScaledVector(toTarget, radialFactor).normalize();
    const speed = this.isCrouching ? 2.6 : 4.5;
    this.velocity.set(moveDir.x * speed, 0, moveDir.z * speed);
  }

  public combatStrafe(dirMultiplier: number): void {
    this.combatCircleStrafe(dirMultiplier, this.getDistanceToTarget());
  }

  public setCrouch(crouched: boolean): void {
    this.isCrouching = crouched;
    this.crouchOffset = crouched ? -0.45 : 0.0;

    const baseTorsoY = 0.95;
    const baseHeadY = 1.48;
    const baseVisorY = 1.5;
    const baseGunY = 0.95;

    if (this.torsoMesh) this.torsoMesh.position.y = baseTorsoY + this.crouchOffset;
    if (this.headMesh) this.headMesh.position.y = baseHeadY + this.crouchOffset;
    if (this.visorMesh) this.visorMesh.position.y = baseVisorY + this.crouchOffset;
    if (this.weaponMesh) this.weaponMesh.position.y = baseGunY + this.crouchOffset;
    if (this.muzzleFlashSprite) this.muzzleFlashSprite.position.y = baseGunY + this.crouchOffset;

    if (this.leftLegMesh && this.rightLegMesh) {
      if (crouched) {
        this.leftLegMesh.scale.set(1.0, 0.55, 1.0);
        this.rightLegMesh.scale.set(1.0, 0.55, 1.0);
        this.leftLegMesh.position.y = 0.18;
        this.rightLegMesh.position.y = 0.18;
      } else {
        this.leftLegMesh.scale.set(1.0, 1.0, 1.0);
        this.rightLegMesh.scale.set(1.0, 1.0, 1.0);
        this.leftLegMesh.position.y = 0.32;
        this.rightLegMesh.position.y = 0.32;
      }
    }
  }

  public isTargetLowHP(): boolean {
    const visible = this.getVisibleEnemy();
    if (visible?.enemyBot) {
      return visible.enemyBot.health <= 40;
    }
    if (this.targetPlayer?.networkManager) {
      const localHealth = this.targetPlayer.networkManager.localHealth ?? 100;
      if (localHealth <= 40) return true;

      if (this.targetPlayer.networkManager.peers) {
        for (const peer of this.targetPlayer.networkManager.peers.values()) {
          if (!peer.isDead && peer.health <= 40) return true;
        }
      }
    }
    return false;
  }

  // Burst firing properties: shoot every 0.3s for 3 rounds, pause 600ms, then repeat
  public burstSize = 3; // 3 rounds
  public burstShotsFired = 0;
  public burstPauseTimer = 0;
  public shotTimer = 0;
  public SHOT_INTERVAL = 0.30; // Shoot every 0.3s
  public BURST_PAUSE_DURATION = 0.60; // 600ms pause
  public aimInaccuracyFactor = 0.03;

  /**
   * Configures burst pattern and delay based on weapon type.
   */
  public configureWeaponPattern(weaponType: 'rifle' | 'shotgun' | 'smg'): void {
    this.weaponType = weaponType;
    if (weaponType === 'rifle') {
      this.burstSize = 3;
      this.SHOT_INTERVAL = 0.30;
      this.BURST_PAUSE_DURATION = 0.60;
    } else if (weaponType === 'shotgun') {
      this.burstSize = 1;
      this.SHOT_INTERVAL = 0.75;
      this.BURST_PAUSE_DURATION = 0.75;
    } else if (weaponType === 'smg') {
      this.burstSize = 5;
      this.SHOT_INTERVAL = 0.12;
      this.BURST_PAUSE_DURATION = 0.45;
    }
  }

  /**
   * Handles weapon burst firing: 3 shots every 0.3s, then 600ms pause.
   */
  public updateBurstFiring(delta: number, targetPos: THREE.Vector3): void {
    if (this.burstPauseTimer > 0) {
      this.burstPauseTimer -= delta;
      if (this.burstPauseTimer <= 0) {
        this.burstShotsFired = 0;
        this.shotTimer = this.SHOT_INTERVAL; // Ready for immediate first shot
      }
      return;
    }

    this.shotTimer += delta;
    if (this.shotTimer >= this.SHOT_INTERVAL) {
      this.shotTimer = 0;
      this.fireWeaponAtTarget(targetPos);
      this.burstShotsFired++;

      if (this.burstShotsFired >= this.burstSize) {
        this.burstPauseTimer = this.BURST_PAUSE_DURATION;
      }
    }
  }

  /**
   * Fires a weapon shot with muzzle flash, bullet tracer mesh, and damage application (15 HP).
   * Raycast origin is at eye height (position.y + 1.5).
   * Target is aimed at player chest (position.y + 1.2) with a ±0.03 spread vector.
   * Ignores bot's own meshes and hitboxes.
   */
  public fireWeaponAtTarget(targetPos?: THREE.Vector3): void {
    const visible = this.getVisibleEnemy();
    const rayOrigin = new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
    
    // Target coordinate: aimed at chest height (y + 1.2)
    let aimTarget: THREE.Vector3 | null = null;
    if (targetPos) {
      aimTarget = targetPos.clone();
    } else if (visible) {
      aimTarget = visible.target.clone();
    } else if (this.targetPlayer?.position) {
      aimTarget = this.targetPlayer.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    } else if (this.targetPlayer?.body) {
      const p = this.targetPlayer.body.translation();
      aimTarget = new THREE.Vector3(p.x, p.y + 1.2, p.z);
    } else if (this.targetPlayer?.camera) {
      aimTarget = this.targetPlayer.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0));
    }

    if (!aimTarget) return;

    // 1. Muzzle Flash & Sound FX
    this.muzzleFlashSprite.scale.set(0.7, 0.7, 1);
    sounds.playGunshot();

    const muzzlePos = new THREE.Vector3();
    this.weaponMesh.getWorldPosition(muzzlePos);
    muzzlePos.y += 0.05;

    // 2. Aim vector with ±0.03 spread vector
    const baseDir = aimTarget.clone().sub(rayOrigin).normalize();
    const spreadX = (Math.random() - 0.5) * 2.0 * 0.03;
    const spreadY = (Math.random() - 0.5) * 2.0 * 0.03;
    const spreadZ = (Math.random() - 0.5) * 2.0 * 0.03;
    const shootDir = baseDir.clone().add(new THREE.Vector3(spreadX, spreadY, spreadZ)).normalize();

    // 3. Collision Raycast against arena geometry (excluding bot's own hitbox colliders)
    const maxDist = 60.0;
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
      this.torsoCollider,
      this.torsoBody,
      (collider) => {
        // Exclude all self-colliders (Head, Torso, Limbs)
        if (
          collider.handle === this.headCollider?.handle ||
          collider.handle === this.torsoCollider?.handle ||
          collider.handle === this.limbCollider?.handle
        ) {
          return false;
        }
        return true;
      }
    );

    const hitDist = hit ? hit.timeOfImpact : maxDist;
    let hitPoint = rayOrigin.clone().addScaledVector(shootDir, hitDist);
    let hitRegistered = false;

    // 4. Raycast Intersection Check against Opponents / Local Player
    if (visible?.enemyBot && !visible.enemyBot.isDead) {
      const enemyChest = new THREE.Vector3(visible.enemyBot.position.x, visible.enemyBot.position.y + 1.2, visible.enemyBot.position.z);
      const toEnemy = enemyChest.clone().sub(rayOrigin);
      const proj = toEnemy.dot(shootDir);
      if (proj > 0 && proj <= hitDist + 0.5) {
        const closestPoint = rayOrigin.clone().addScaledVector(shootDir, proj);
        if (closestPoint.distanceTo(enemyChest) < 0.8) {
          visible.enemyBot.takeDamage(15, this.id, closestPoint, shootDir, 'torso');
          this.fx.addSparksOnly(closestPoint, shootDir.clone().negate());
          hitPoint = closestPoint;
          hitRegistered = true;
        }
      }
    }

    if (!hitRegistered && this.targetPlayer && !this.targetPlayer.isDead) {
      const pChest = this.targetPlayer.position
        ? this.targetPlayer.position.clone().add(new THREE.Vector3(0, 1.2, 0))
        : (this.targetPlayer.body ? new THREE.Vector3(this.targetPlayer.body.translation().x, this.targetPlayer.body.translation().y + 1.2, this.targetPlayer.body.translation().z) : null);

      if (pChest) {
        const toPlayer = pChest.clone().sub(rayOrigin);
        const proj = toPlayer.dot(shootDir);
        if (proj > 0 && proj <= hitDist + 0.5) {
          const closestPoint = rayOrigin.clone().addScaledVector(shootDir, proj);
          if (closestPoint.distanceTo(pChest) < 0.85) {
            // Explicitly invoke player.takeDamage(15, bot.id)
            this.targetPlayer.takeDamage(15, this.id, 'torso');
            this.fx.addSparksOnly(closestPoint, shootDir.clone().negate());
            hitPoint = closestPoint;
            hitRegistered = true;
          }
        }
      }
    }

    if (!hitRegistered && hit) {
      const hitNormal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      this.fx.addImpact(hitPoint, hitNormal);
    }

    // 5. Bullet Tracer Mesh Line from bot gun to final hit location
    this.fx.addTracer(muzzlePos, hitPoint);
  }

  // ==================== DAMAGE & IMMEDIATE RETALIATION ====================

  /**
   * Immediate Retaliation & Damageable interface implementation:
   * When damaged: immediately forces CombatState, turns 180° towards attackerPosition,
   * breaks patrol, and starts firing back.
   */
  public takeDamage(
    amount: number,
    attackerId = 'local_player',
    hitLocationOrPoint?: string | THREE.Vector3,
    shootDirOrLocation?: THREE.Vector3 | string,
    hitLocationParam?: string
  ): void {
    // Completely disable damage in MENU / LOBBY or if invulnerable or dead
    if (!gameState.isDamageAllowed() || this.isDead) return;

    let hitPoint: THREE.Vector3 | undefined;
    let shootDir: THREE.Vector3 | undefined;
    let hitLocation = 'torso';

    if (hitLocationOrPoint instanceof THREE.Vector3) {
      hitPoint = hitLocationOrPoint;
      if (shootDirOrLocation instanceof THREE.Vector3) {
        shootDir = shootDirOrLocation;
      }
      hitLocation = hitLocationParam || (typeof shootDirOrLocation === 'string' ? shootDirOrLocation : 'torso');
    } else if (typeof hitLocationOrPoint === 'string') {
      hitLocation = hitLocationOrPoint;
    }

    this.health = Math.max(0, this.health - amount);
    this.updateNameplateCanvas(this.stateMachine.currentState?.constructor.name.replace('State', '').toUpperCase() || 'COMBAT');

    if (this.health <= 0) {
      this.isDead = true;
      const isHead = hitLocation === 'head';
      scoreManager.registerKill(attackerId, this.id, 'AR-X PULSE', isHead);
      this.die();
      return;
    }

    // Determine attacker position vector
    let attackerPos: THREE.Vector3 | null = null;
    const currentPos = new THREE.Vector3(this.position.x, this.position.y, this.position.z);
    if (shootDir) {
      // Vector pointing back to shooter
      attackerPos = (hitPoint ? hitPoint.clone() : currentPos).sub(shootDir.clone().multiplyScalar(15.0));
    } else if (this.targetPlayer?.camera) {
      attackerPos = this.targetPlayer.camera.position.clone();
    }

    // Call for backup upon receiving damage
    if (attackerPos) {
      threatManager.callForBackup(this, attackerPos, 25.0);
    }

    // Immediate Retaliation Sequence:
    // 1. Break patrol
    this.clearPath();

    // 2. Turn 180° towards attacker position
    if (attackerPos) {
      const dirToAttacker = new THREE.Vector3(attackerPos.x - this.position.x, 0, attackerPos.z - this.position.z).normalize();
      const targetYaw = Math.atan2(-dirToAttacker.x, -dirToAttacker.z);
      this.meshGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
      this.meshGroup.rotation.y = targetYaw;
      this.forward.set(dirToAttacker.x, 0, dirToAttacker.z).normalize();
    }

    // 3. Immediately force bot into CombatState (or Rush/Flank if target is low HP)
    if (this.isTargetLowHP()) {
      this.stateMachine.changeTo('RUSH_FLANK');
    } else {
      this.stateMachine.changeTo('COMBAT');
    }

    this.showStatusAlert('⚡ RETALIATING!');

    // 4. Start firing back immediately
    if (attackerPos) {
      this.fireWeaponAtTarget(attackerPos);
    }
  }

  public updateHealthHUD(): void {
    this.updateNameplateCanvas(this.stateMachine.currentState?.constructor.name.replace('State', '').toUpperCase() || 'IDLE');
  }

  public die(): void {
    this.isDead = true;
    this.clearPath();
    this.velocity.set(0, 0, 0);
    this.updateNameplateCanvas('ELIMINATED');

    // Death tip-over ragdoll animation
    this.meshGroup.rotation.x = -Math.PI / 2.2;
    this.meshGroup.position.y = 0.2;

    // Respawn after 4.5 seconds
    setTimeout(() => {
      this.respawn(new THREE.Vector3((Math.random() - 0.5) * 30, 0.05, (Math.random() - 0.5) * 30));
    }, 4500);
  }

  public respawn(spawnPos: THREE.Vector3): void {
    this.health = 100;
    this.isDead = false;
    this.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    this.meshGroup.position.copy(spawnPos);
    this.meshGroup.rotation.set(0, 0, 0);
    this.burstShotsFired = 0;
    this.burstPauseTimer = 0;
    this.setCrouch(false);
    this.stateMachine.changeTo('PATROL');
    this.updateNameplateCanvas('PATROL');
  }

  public currentDelta = 0.016;

  public update(delta: number): this {
    if (!this.isDead) {
      this.currentDelta = delta;
      this.stateMachine.update();
      super.update(delta);

      // Synchronize Yuka MovingEntity Transform to Three.js MeshGroup
      this.meshGroup.position.set(this.position.x, this.position.y, this.position.z);

      // Sync Kinematic Rapier Hitbox Colliders (with crouch offset)
      this.headBody.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + 1.48 + this.crouchOffset,
        z: this.position.z,
      });
      this.torsoBody.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + 0.95 + this.crouchOffset,
        z: this.position.z,
      });
      this.limbBody.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y + 0.32 + (this.crouchOffset * 0.5),
        z: this.position.z,
      });

      // Decay muzzle flash
      if (this.muzzleFlashSprite.scale.x > 0.01) {
        this.muzzleFlashSprite.scale.lerp(new THREE.Vector3(0, 0, 0), 0.25);
      }
    }

    return this;
  }

  public destroy(): void {
    threatManager.unregisterBot(this);
    this.scene.remove(this.meshGroup);
    if (this.headCollider) physics.world.removeCollider(this.headCollider, false);
    if (this.torsoCollider) physics.world.removeCollider(this.torsoCollider, false);
    if (this.limbCollider) physics.world.removeCollider(this.limbCollider, false);
    if (this.headBody) physics.world.removeRigidBody(this.headBody);
    if (this.torsoBody) physics.world.removeRigidBody(this.torsoBody);
    if (this.limbBody) physics.world.removeRigidBody(this.limbBody);
  }
}
