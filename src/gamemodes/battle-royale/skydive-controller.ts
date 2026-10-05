import * as THREE from 'three';
import { CargoPlane } from './cargo-plane';
import { FPSController } from '../../fps-controller';
import { sounds } from '../../weapons/sound-manager';
import type { BotManager } from '../../ai/bot-manager';

export type DropState = 'IN_PLANE' | 'FREEFALL' | 'PARACHUTE' | 'LANDED';

export class WindAudioSynthesizer {
  private ctx: AudioContext | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;

  private initCtx(): void {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public start(): void {
    this.initCtx();
    if (!this.ctx || this.isPlaying) return;

    // Generate seamless looping pink noise
    const bufferSize = this.ctx.sampleRate * 2.0;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(400, this.ctx.currentTime);

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.setValueAtTime(0.01, this.ctx.currentTime);

    this.noiseNode.connect(this.filterNode);
    this.filterNode.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    this.noiseNode.start();
    this.isPlaying = true;
  }

  public update(speed: number, isParachute: boolean): void {
    if (!this.ctx || !this.filterNode || !this.gainNode) return;
    const t = this.ctx.currentTime;

    if (isParachute) {
      // Gentle gliding breeze
      this.filterNode.frequency.setTargetAtTime(650, t, 0.1);
      this.gainNode.gain.setTargetAtTime(0.18, t, 0.1);
    } else {
      // High-speed roaring freefall wind (scales up to 60 m/s)
      const speedNorm = Math.min(1.0, Math.max(0, (speed - 20) / 40.0));
      const targetFreq = THREE.MathUtils.lerp(500, 3200, speedNorm);
      const targetGain = THREE.MathUtils.lerp(0.15, 0.65, speedNorm);

      this.filterNode.frequency.setTargetAtTime(targetFreq, t, 0.05);
      this.gainNode.gain.setTargetAtTime(targetGain, t, 0.05);
    }
  }

  public stop(): void {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.15);
      setTimeout(() => {
        try {
          this.noiseNode?.stop();
          this.noiseNode?.disconnect();
        } catch {
          // ignore
        }
        this.isPlaying = false;
      }, 200);
    }
  }
}

export interface BotSkydiveAgent {
  bot: any;
  ejected: boolean;
  ejectProgress: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  parachuteDeployed: boolean;
  parachuteMesh?: THREE.Group;
  hasLanded: boolean;
}

export class SkydiveController {
  public state: DropState = 'IN_PLANE';
  public cargoPlane: CargoPlane;
  public controller: FPSController;
  public scene: THREE.Scene;
  public botManager?: BotManager;

  // Skydive Transform
  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public currentAirspeed = 65.0; // m/s
  public currentDescentSpeed = 0.0; // m/s

  // Parachute 3D Model
  public parachuteMesh!: THREE.Group;

  // Audio
  public windAudio = new WindAudioSynthesizer();

  // Camera Pitch / Roll during skydive
  public divePitch = 0.0; // -89° to +89°
  public diveRoll = 0.0;
  public diveYaw = 0.0;

  // Landing Shake Animation State
  private landingShakeTimer = 0.0;
  private landingShakeDuration = 0.65; // Seconds

  // Bot Skydivers
  public botSkydivers: BotSkydiveAgent[] = [];

  // Callback
  public onLandingComplete?: () => void;

  constructor(cargoPlane: CargoPlane, controller: FPSController, scene: THREE.Scene, botManager?: BotManager) {
    this.cargoPlane = cargoPlane;
    this.controller = controller;
    this.scene = scene;
    this.botManager = botManager;

    this.buildParachuteModel();
    this.initBotSkydivers();

    // Start in plane
    this.position.copy(this.cargoPlane.currentPos);
    this.diveYaw = Math.atan2(-this.cargoPlane.direction.x, -this.cargoPlane.direction.z);
    this.state = 'IN_PLANE';

    // Lock controller physics while dropping
    if (this.controller.body) {
      this.controller.body.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z }, true);
      this.controller.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.initInputListeners();
  }

  private initBotSkydivers(): void {
    if (!this.botManager?.bots) return;

    this.botSkydivers = [];
    let delayStep = 0.15;

    for (const bot of this.botManager.bots) {
      // Eject bots at randomized staggered intervals along plane flight path (0.15 - 0.85 progress)
      const ejectProgress = Math.min(0.85, delayStep + Math.random() * 0.12);
      delayStep += 0.12;

      this.botSkydivers.push({
        bot,
        ejected: false,
        ejectProgress,
        position: new THREE.Vector3(0, 350, 0),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 15,
          -35,
          (Math.random() - 0.5) * 15
        ),
        parachuteDeployed: false,
        hasLanded: false,
      });

      // Temporarily hide bot mesh until ejected
      bot.meshGroup.position.set(0, -999, 0);
    }
  }

  private buildParachuteModel(): void {
    this.parachuteMesh = new THREE.Group();

    // 1. Aerodynamic Arched Parachute Canopy
    const canopyGeo = new THREE.SphereGeometry(3.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    canopyGeo.scale(1.2, 0.6, 1.0);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // Tactical Blue Canopy
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 3.8, 0);
    this.parachuteMesh.add(canopy);

    // Accent Stripes
    const stripeGeo = new THREE.RingGeometry(1.8, 2.6, 24);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 4.2, 0);
    this.parachuteMesh.add(stripe);

    // 2. Suspension Rigging Lines
    const cordMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.7 });
    const lineCount = 8;
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2;
      const topPos = new THREE.Vector3(Math.cos(angle) * 3.2, 3.8, Math.sin(angle) * 3.2);
      const bottomPos = new THREE.Vector3(0, 0.9, 0);

      const cordGeo = new THREE.BufferGeometry().setFromPoints([topPos, bottomPos]);
      const cord = new THREE.Line(cordGeo, cordMat);
      this.parachuteMesh.add(cord);
    }

    this.parachuteMesh.visible = false;
    this.scene.add(this.parachuteMesh);
  }

  private initInputListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        if (this.state === 'IN_PLANE') {
          this.ejectPlayer();
        } else if (this.state === 'FREEFALL') {
          this.deployParachute();
        }
      }
    });
  }

  public ejectPlayer(): void {
    if (this.state !== 'IN_PLANE') return;

    this.state = 'FREEFALL';
    this.position.copy(this.cargoPlane.currentPos);
    // Forward plane momentum + initial downward gravity
    this.velocity.copy(this.cargoPlane.direction).multiplyScalar(35.0);
    this.velocity.y = -24.0;

    this.windAudio.start();
    sounds.playRocketLaunch();
  }

  public deployParachute(): void {
    if (this.state !== 'FREEFALL') return;

    this.state = 'PARACHUTE';
    this.parachuteMesh.visible = true;
    this.parachuteMesh.position.copy(this.position);

    // Rapid deceleration to 8 m/s descent
    this.velocity.y = -8.0;
    this.velocity.x *= 0.45;
    this.velocity.z *= 0.45;

    sounds.playGunshot();
  }

  public update(delta: number): void {
    if (this.state === 'LANDED') return;

    // 1. In Cargo Plane
    if (this.state === 'IN_PLANE') {
      this.position.copy(this.cargoPlane.currentPos);

      // Auto-eject if plane reaches end of flight path
      if (this.cargoPlane.progress >= 0.92) {
        this.ejectPlayer();
        return;
      }

      // Chase Camera view locked to plane
      const chaseCam = this.cargoPlane.getChaseCameraPosition(28.0, 9.0);
      this.controller.camera.position.copy(chaseCam);
      this.controller.camera.lookAt(this.cargoPlane.currentPos.clone().add(new THREE.Vector3(0, 1.5, 0)));

      this.updateBotsInPlane();
      return;
    }

    // 2. Freefall Mechanics (WASD pitch/roll, looking down increases dive speed up to 60 m/s)
    if (this.state === 'FREEFALL') {
      // Mouse Pitch controls terminal dive velocity
      const pitch = this.controller.pitch; // -1.5 (looking straight down) to +1.5 (up)
      const lookDownFactor = Math.min(1.0, Math.max(0, -pitch / 1.4)); // 0 (horizon) to 1.0 (straight down)

      // Looking down increases downward velocity up to 60 m/s!
      const targetTerminalVy = THREE.MathUtils.lerp(-26.0, -60.0, lookDownFactor);
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, targetTerminalVy, delta * 3.5);

      // WASD directional glide control
      const camDir = new THREE.Vector3();
      this.controller.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.controller.camera.quaternion);
      right.y = 0;
      right.normalize();

      const moveDir = new THREE.Vector3();
      if (this.controller.keys.forward) moveDir.add(camDir);
      if (this.controller.keys.backward) moveDir.addScaledVector(camDir, -0.6);
      if (this.controller.keys.left) moveDir.addScaledVector(right, -0.7);
      if (this.controller.keys.right) moveDir.addScaledVector(right, 0.7);

      const horizontalSpeed = THREE.MathUtils.lerp(38.0, 18.0, lookDownFactor);
      if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveDir.x * horizontalSpeed, delta * 2.8);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveDir.z * horizontalSpeed, delta * 2.8);
      } else {
        // Natural forward glide
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, camDir.x * (horizontalSpeed * 0.65), delta * 1.5);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, camDir.z * (horizontalSpeed * 0.65), delta * 1.5);
      }

      this.currentDescentSpeed = Math.abs(this.velocity.y);
      this.currentAirspeed = this.velocity.length();
      this.windAudio.update(this.currentAirspeed, false);

      // Auto-deploy parachute at altitude Y <= 50
      if (this.position.y <= 50.0) {
        this.deployParachute();
      }
    }

    // 3. Parachute Gliding Mechanics (Descent 8 m/s, smooth gliding)
    if (this.state === 'PARACHUTE') {
      // Constant gentle descent speed: 8 m/s
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, -8.0, delta * 4.5);

      const camDir = new THREE.Vector3();
      this.controller.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.controller.camera.quaternion);
      right.y = 0;
      right.normalize();

      const moveDir = new THREE.Vector3();
      if (this.controller.keys.forward) moveDir.add(camDir);
      if (this.controller.keys.backward) moveDir.addScaledVector(camDir, -0.4);
      if (this.controller.keys.left) moveDir.addScaledVector(right, -0.6);
      if (this.controller.keys.right) moveDir.addScaledVector(right, 0.6);

      const glideSpeed = 14.0;
      if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveDir.x * glideSpeed, delta * 3.0);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveDir.z * glideSpeed, delta * 3.0);
      } else {
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, camDir.x * 8.0, delta * 2.0);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, camDir.z * 8.0, delta * 2.0);
      }

      this.currentDescentSpeed = 8.0;
      this.currentAirspeed = this.velocity.length();
      this.windAudio.update(this.currentAirspeed, true);

      // Sync Parachute Model Transform
      this.parachuteMesh.position.copy(this.position);
      this.parachuteMesh.rotation.y = this.controller.yaw;
    }

    // Apply Velocity to Position
    this.position.addScaledVector(this.velocity, delta);

    // Sync Camera & Rapier Controller Transform
    this.controller.camera.position.copy(this.position);
    if (this.controller.body) {
      this.controller.body.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z }, true);
      this.controller.body.setLinvel({ x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }, true);
    }

    // 4. Landing Impact Detection
    if (this.position.y <= 0.65) {
      this.executeLanding();
    }

    // Update Bot Skydivers
    this.updateBotSkydivers(delta);
  }

  private updateBotsInPlane(): void {
    for (const skydiver of this.botSkydivers) {
      if (!skydiver.ejected && this.cargoPlane.progress >= skydiver.ejectProgress) {
        skydiver.ejected = true;
        skydiver.position.copy(this.cargoPlane.currentPos).add(new THREE.Vector3(
          (Math.random() - 0.5) * 8.0,
          -4.0,
          (Math.random() - 0.5) * 8.0
        ));
        skydiver.bot.meshGroup.position.copy(skydiver.position);
      }
    }
  }

  private updateBotSkydivers(delta: number): void {
    for (const skydiver of this.botSkydivers) {
      if (!skydiver.ejected) {
        if (this.cargoPlane.progress >= skydiver.ejectProgress) {
          skydiver.ejected = true;
          skydiver.position.copy(this.cargoPlane.currentPos);
          skydiver.bot.meshGroup.position.copy(skydiver.position);
        }
        continue;
      }

      if (skydiver.hasLanded) continue;

      if (!skydiver.parachuteDeployed) {
        // Bot Freefall
        skydiver.velocity.y = THREE.MathUtils.lerp(skydiver.velocity.y, -45.0, delta * 3.0);
        if (skydiver.position.y <= 55.0) {
          skydiver.parachuteDeployed = true;
        }
      } else {
        // Bot Parachute Glide
        skydiver.velocity.y = -8.0;
      }

      skydiver.position.addScaledVector(skydiver.velocity, delta);
      skydiver.bot.position.set(skydiver.position.x, skydiver.position.y, skydiver.position.z);
      skydiver.bot.meshGroup.position.copy(skydiver.position);

      // Bot Ground Landing
      if (skydiver.position.y <= 0.5) {
        skydiver.hasLanded = true;
        skydiver.position.y = 0.05;
        skydiver.bot.position.set(skydiver.position.x, 0.05, skydiver.position.z);
        skydiver.bot.meshGroup.position.set(skydiver.position.x, 0.05, skydiver.position.z);
        skydiver.bot.stateMachine.changeTo('PATROL');
      }
    }
  }

  /**
   * Smooth landing impact roll & recovery transition
   */
  public executeLanding(): void {
    this.state = 'LANDED';
    this.position.y = 0.5;

    // Unmount parachute
    this.parachuteMesh.visible = false;
    this.windAudio.stop();

    // Landing Impact Thud & Camera Shake Shockwave
    sounds.playExplosion();
    this.triggerLandingShake();

    // Snap player body to ground level
    if (this.controller.body) {
      this.controller.body.setTranslation({ x: this.position.x, y: 1.5, z: this.position.z }, true);
      this.controller.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Equip Starter Fists / Pistol loadout
    if ((this.controller.weapon as any).selectSlot) {
      (this.controller.weapon as any).selectSlot(2); // Start on Secondary sidearm
    }

    if (this.onLandingComplete) {
      this.onLandingComplete();
    }
  }

  private triggerLandingShake(): void {
    this.landingShakeTimer = this.landingShakeDuration;
    const initialPitch = this.controller.pitch;

    // Quick camera pitch dip (landing roll simulation)
    const interval = setInterval(() => {
      this.landingShakeTimer -= 0.03;
      if (this.landingShakeTimer <= 0) {
        clearInterval(interval);
        this.controller.pitch = initialPitch;
        return;
      }
      const shakeFactor = Math.sin(this.landingShakeTimer * 25.0) * 0.08 * (this.landingShakeTimer / this.landingShakeDuration);
      this.controller.pitch = initialPitch + shakeFactor;
    }, 30);
  }

  public destroy(): void {
    this.windAudio.stop();
    this.scene.remove(this.parachuteMesh);
  }
}
