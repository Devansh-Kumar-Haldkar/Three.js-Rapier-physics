import * as THREE from 'three';
import { RAPIER, physics } from './physics';
import { AssaultRifle } from './weapon-system';
import type { NetworkManager } from './network/network-manager';
import { Damageable } from './scoring/score-manager';
import { sounds } from './weapons/sound-manager';
import { gameState } from './game-state';
import { threatManager } from './ai/threat-manager';

export interface FPSControllerOptions {
  walkSpeed?: number;
  sprintSpeed?: number;
  jumpForce?: number;
  acceleration?: number;
  friction?: number;
  airAcceleration?: number;
  mouseSensitivity?: number;
}

export class FPSController implements Damageable {
  public id = 'local_player';
  public name = 'Player';
  public health = 100;
  public maxHealth = 100;
  public camera: THREE.PerspectiveCamera;
  public domElement: HTMLElement;
  public scene: THREE.Scene;

  public get position(): THREE.Vector3 {
    return this.camera.position;
  }

  // Rapier Physics
  public body!: RAPIER.RigidBody;
  public collider!: RAPIER.Collider;

  // Weapon System
  public weapon!: AssaultRifle;

  // Network Manager (Client-Side Prediction & Reconciliation)
  public networkManager?: NetworkManager;

  // Movement Constants
  public walkSpeed: number;
  public sprintSpeed: number;
  public jumpForce: number;
  public acceleration: number;
  public friction: number;
  public airAcceleration: number;
  public mouseSensitivity: number;

  // State
  public isLocked = false;
  public isGrounded = false;
  public isSprinting = false;
  public stamina = 100;
  private maxStamina = 100;
  public currentSpeed = 0;
  private sprintAlertTimer = 0;

  // Jump Buffers & Coyote Time
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private readonly COYOTE_TIME = 0.12;
  private readonly JUMP_BUFFER = 0.12;

  // Input states
  public keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
  };

  // Rotation Euler
  public yaw = 0;
  public pitch = 0;

  // Death State & Ragdoll Camera Effect
  public isDead = false;
  private deathCamTilt = 0;
  private deathCamDrop = 0;

  public triggerDeath(): void {
    if (this.isDead) return;
    this.isDead = true;
    this.weapon.isTriggerDown = false;
    (this.weapon as any).cancelReload?.();
    if (this.body) {
      this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
    }
  }

  public triggerRespawn(): void {
    this.isDead = false;
    this.deathCamTilt = 0;
    this.deathCamDrop = 0;
    this.keys.forward = false;
    this.keys.backward = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.sprint = false;
    this.keys.jump = false;
    (this.weapon as any).cancelReload?.();
  }

  public takeDamage(amount: number, attackerId = 'BOT', hitLocation = 'torso'): void {
    // Disable damage in MENU/LOBBY or while invulnerable
    if (!gameState.isDamageAllowed() || this.isDead) return;

    // Play player hurt sound
    sounds.playPlayerHurt();

    // Trigger Screen Shake (impact recoil kick)
    const shakeYaw = (Math.random() - 0.5) * 0.04;
    const shakePitch = -(0.015 + Math.random() * 0.025);
    this.yaw += shakeYaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch + shakePitch));

    if (this.networkManager) {
      this.networkManager.applyDirectDamage(amount, hitLocation as any, attackerId);
    }
  }

  // Camera Settings & Bobbing
  private playerHeight = 1.75;
  private eyeHeightOffset = 0.65;
  private bobTimer = 0;
  private defaultFOV = 75;
  private sprintFOV = 84;

  // Callbacks
  public onSpawnPhysicsBox?: () => void;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene, options: FPSControllerOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;

    this.walkSpeed = options.walkSpeed ?? 8.0;
    this.sprintSpeed = options.sprintSpeed ?? 14.5;
    this.jumpForce = options.jumpForce ?? 11.5;
    this.acceleration = options.acceleration ?? 45.0;
    this.friction = options.friction ?? 10.0;
    this.airAcceleration = options.airAcceleration ?? 12.0;
    this.mouseSensitivity = options.mouseSensitivity ?? 0.0022;

    this.initPhysicsBody();
    this.initWeapon();
    this.initListeners();
  }

  private initPhysicsBody(): void {
    const capsuleRadius = 0.4;
    const capsuleHalfHeight = 0.55;

    // Create dynamic rigid body with locked rotations
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 2.0, 8.0)
      .lockRotations()
      .setLinearDamping(0.0)
      .setAngularDamping(0.0)
      .setCcdEnabled(true);

    this.body = physics.world.createRigidBody(bodyDesc);

    // Create Capsule Collider
    const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius)
      .setFriction(0.0)
      .setRestitution(0.0)
      .setDensity(1.0);

    this.collider = physics.world.createCollider(colliderDesc, this.body);
  }

  private initWeapon(): void {
    this.weapon = new AssaultRifle(this.camera, this.scene);
  }

  private initListeners(): void {
    // Mouse Look (with 4x scope sensitivity reduction)
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      const currentSens = (this.weapon as any).getEffectiveSensitivity
        ? (this.weapon as any).getEffectiveSensitivity()
        : this.mouseSensitivity;

      this.yaw -= movementX * currentSens;
      this.pitch -= movementY * currentSens;

      // Clamp vertical pitch (-89° to +89°)
      const maxPitch = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });

    // Mouse Shoot triggers (Left click) & Scope Toggle (Right click)
    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      if (e.button === 0) {
        this.weapon.isTriggerDown = true;
        // Fire initial tap immediately excluding player's collider & body
        this.weapon.shoot(this.currentSpeed, this.isGrounded, this.collider, this.body);
      } else if (e.button === 2) {
        // Right Click: Toggle 4x Scope Overlay / ADS
        if ((this.weapon as any).toggleScope) {
          (this.weapon as any).toggleScope();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.weapon.isTriggerDown = false;
      }
    });

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse Wheel to cycle weapon slots
    window.addEventListener('wheel', (e) => {
      if (!this.isLocked) return;
      if ((this.weapon as any).cycleSlot) {
        (this.weapon as any).cycleSlot(e.deltaY > 0 ? 1 : -1);
      }
    });

    // Keyboard Input
    window.addEventListener('keydown', (e) => {
      if (!this.isLocked) return;
      this.handleKey(e.code, true);

      // Weapon Slot Keybindings (1: Primary, 2: Secondary, 3: Heavy)
      if (e.code === 'Digit1' && (this.weapon as any).selectSlot) {
        (this.weapon as any).selectSlot(1);
      } else if (e.code === 'Digit2' && (this.weapon as any).selectSlot) {
        (this.weapon as any).selectSlot(2);
      } else if (e.code === 'Digit3' && (this.weapon as any).selectSlot) {
        (this.weapon as any).selectSlot(3);
      }

      // Key shortcut for reloading weapon
      if (e.code === 'KeyR') {
        this.weapon.reload();
      }

      // Key shortcut for spawning dynamic box
      if (e.code === 'KeyF' && this.onSpawnPhysicsBox) {
        this.onSpawnPhysicsBox();
      }

      // Reset position
      if (e.code === 'KeyT') {
        this.resetPosition();
      }

      // Toggle HUD controls
      if (e.code === 'KeyH') {
        const controls = document.getElementById('controls-panel');
        if (controls) controls.classList.toggle('hidden');
      }
    });

    window.addEventListener('keyup', (e) => {
      this.handleKey(e.code, false);
    });

    // Pointer Lock change listener
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
      const blocker = document.getElementById('blocker');
      if (blocker) {
        if (this.isLocked) {
          blocker.classList.add('hidden');
        } else {
          blocker.classList.remove('hidden');
          this.weapon.isTriggerDown = false;
        }
      }
    });
  }

  public lock(): void {
    this.domElement.requestPointerLock();
  }

  public unlock(): void {
    document.exitPointerLock();
  }

  public setRotation(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.y = this.yaw;
    euler.x = this.pitch;
    this.camera.quaternion.setFromEuler(euler);
  }

  private handleKey(code: string, isDown: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = isDown;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = isDown;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = isDown;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = isDown;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = isDown;
        break;
      case 'Space':
        if (isDown && !this.keys.jump) {
          this.jumpBufferTimer = this.JUMP_BUFFER;
        }
        this.keys.jump = isDown;
        break;
    }
  }

  private checkGrounded(): boolean {
    const pos = this.body.translation();
    
    // Cast ray downward from center of player body
    const rayOrigin = { x: pos.x, y: pos.y, z: pos.z };
    const rayDir = { x: 0.0, y: -1.0, z: 0.0 };
    const ray = new RAPIER.Ray(rayOrigin, rayDir);

    // Max distance: capsule halfHeight (0.55) + radius (0.4) = 0.95m from center to bottom.
    // Allow +0.15m margin for stairs, uneven ground and slopes.
    const maxToi = 1.12;

    // Filter to exclude player's own collider
    const hit = physics.world.castRay(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      this.collider
    );

    return hit !== null && hit.timeOfImpact <= maxToi;
  }

  public resetPosition(): void {
    this.body.setTranslation({ x: 0, y: 3.0, z: 8.0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  public update(delta: number): void {
    if (!this.body) return;

    if (this.isDead) {
      // Death camera drops to ground and tilts sideways
      this.deathCamDrop = THREE.MathUtils.lerp(this.deathCamDrop, -1.1, delta * 7.0);
      this.deathCamTilt = THREE.MathUtils.lerp(this.deathCamTilt, 0.48, delta * 6.0);
      
      const updatedPos = this.body.translation();
      this.camera.position.set(
        updatedPos.x,
        updatedPos.y + this.eyeHeightOffset + this.deathCamDrop,
        updatedPos.z
      );

      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.y = this.yaw;
      euler.x = this.pitch;
      euler.z = this.deathCamTilt;
      this.camera.quaternion.setFromEuler(euler);

      this.weapon.update(delta, 0, true, 0, this.collider, this.body);
      this.updateHUD(updatedPos);
      return;
    }

    // 1. Ground detection & Timers
    const groundedNow = this.checkGrounded();
    if (groundedNow) {
      this.isGrounded = true;
      this.coyoteTimer = this.COYOTE_TIME;
    } else {
      this.coyoteTimer -= delta;
      if (this.coyoteTimer <= 0) {
        this.isGrounded = false;
      }
    }

    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    // 2. Sprint & Stamina Mechanics
    const isMoving = this.keys.forward || this.keys.backward || this.keys.left || this.keys.right;
    const canSprint = this.keys.sprint && this.keys.forward && this.stamina > 10;

    if (canSprint && isMoving) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - 28 * delta);
    } else {
      this.isSprinting = false;
      this.stamina = Math.min(this.maxStamina, this.stamina + 35 * delta);
    }

    // 3. Compute Wish Direction in Camera Yaw Space
    const moveX = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const moveZ = (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0);

    const wishDir = new THREE.Vector3(moveX, 0, -moveZ);
    if (wishDir.lengthSq() > 0) {
      wishDir.normalize();
      // Rotate by camera yaw
      wishDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    }

    // 4. Custom Crisp Acceleration & Ground Friction
    const currentLinvel = this.body.linvel();
    const currentHorizVel = new THREE.Vector3(currentLinvel.x, 0, currentLinvel.z);
    const targetMaxSpeed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

    let targetHorizVel = new THREE.Vector3();

    if (this.isGrounded) {
      // Ground Friction: Snappy deceleration when stopping
      if (wishDir.lengthSq() === 0) {
        const drop = this.friction * delta;
        currentHorizVel.multiplyScalar(Math.max(0, 1.0 - drop));
      } else {
        // Accelerate sharply towards wish direction
        const targetVel = wishDir.clone().multiplyScalar(targetMaxSpeed);
        currentHorizVel.lerp(targetVel, Math.min(1.0, this.acceleration * delta));
      }
      targetHorizVel.copy(currentHorizVel);
    } else {
      // Air Control: Smooth strafing without instant stops
      if (wishDir.lengthSq() > 0) {
        const airAccelVec = wishDir.clone().multiplyScalar(this.airAcceleration * delta);
        currentHorizVel.add(airAccelVec);
        // Clamp air velocity to avoid infinite speed
        if (currentHorizVel.length() > targetMaxSpeed) {
          currentHorizVel.normalize().multiplyScalar(targetMaxSpeed);
        }
      }
      targetHorizVel.copy(currentHorizVel);
    }

    // 5. Jump Execution (Buffered & Coyote Checked)
    let newVy = currentLinvel.y;

    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      newVy = this.jumpForce;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.isGrounded = false;
    }

    // 6. Jump Pad Check (Launch pad at x ~ 0, z ~ -18)
    const currentPos = this.body.translation();
    const distToJumpPad = Math.hypot(currentPos.x - 0, currentPos.z - (-18));
    if (distToJumpPad < 2.0 && currentPos.y < 1.0) {
      newVy = 20.0; // Mega Super Jump!
      targetHorizVel.multiplyScalar(1.3);
      this.isGrounded = false;
    }

    // 7. Apply updated velocity to Rapier RigidBody
    this.body.setLinvel(
      {
        x: targetHorizVel.x,
        y: newVy,
        z: targetHorizVel.z,
      },
      true
    );

    // Calculate current scalar speed for HUD and camera bobbing
    this.currentSpeed = targetHorizVel.length();

    // 8. Sync Three.js Camera Transform
    const updatedPos = this.body.translation();

    // Head Bobbing calculation
    if (this.isGrounded && this.currentSpeed > 0.5) {
      this.bobTimer += delta * (this.isSprinting ? 16 : 10);
    } else {
      this.bobTimer = 0;
    }
    const bobOffset = Math.sin(this.bobTimer) * 0.04 * (this.currentSpeed / this.sprintSpeed);

    this.camera.position.set(
      updatedPos.x,
      updatedPos.y + this.eyeHeightOffset + bobOffset,
      updatedPos.z
    );

    // Apply Euler rotation: Base Yaw/Pitch + Spring Camera Recoil (Visual offset only)
    const maxPitch = Math.PI / 2 - 0.02;
    const finalPitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch + this.weapon.cameraRecoil.x));
    const finalYaw = this.yaw + this.weapon.cameraRecoil.y;

    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.y = finalYaw;
    euler.x = finalPitch;
    this.camera.quaternion.setFromEuler(euler);

    // Dynamic FOV adjustment (Smooth transition on sprint)
    const targetFOV = this.isSprinting && isMoving ? this.sprintFOV : this.defaultFOV;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, delta * 8.0);
    this.camera.updateProjectionMatrix();

    // 9. Update Weapon System (Recoil kickback, continuous fire, tracers, sparks, reload)
    this.weapon.update(delta, this.currentSpeed, this.isGrounded, bobOffset, this.collider, this.body);

    // 10. Sprint Audio Alert Propagation (Bots within 18m can hear sprinting footsteps)
    if (this.isSprinting && this.isGrounded && this.currentSpeed > 6.0) {
      this.sprintAlertTimer += delta;
      if (this.sprintAlertTimer >= 0.45) {
        this.sprintAlertTimer = 0;
        threatManager.emitAudioAlert(this.camera.position, 18.0, 'local_player');
      }
    } else {
      this.sprintAlertTimer = 0;
    }

    // 11. Update HUD Elements
    this.updateHUD(updatedPos);
  }

  private updateHUD(pos: { x: number; y: number; z: number }): void {
    const speedElem = document.getElementById('stat-speed');
    const groundedElem = document.getElementById('stat-grounded');
    const posElem = document.getElementById('stat-pos');
    const staminaBar = document.getElementById('stamina-bar');

    if (speedElem) {
      speedElem.textContent = `${this.currentSpeed.toFixed(2)} m/s`;
    }

    if (groundedElem) {
      if (this.isGrounded) {
        groundedElem.textContent = 'GROUNDED';
        groundedElem.className = 'stat-value badge-grounded';
      } else {
        groundedElem.textContent = 'AIRBORNE';
        groundedElem.className = 'stat-value badge-airborne';
      }
    }

    if (posElem) {
      posElem.textContent = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
    }

    if (staminaBar) {
      staminaBar.style.width = `${(this.stamina / this.maxStamina) * 100}%`;
    }
  }
}
