import * as THREE from 'three';
import { BaseGameMode } from './game-mode';
import { GameModeType, GameModeHUDState } from './types';
import { CargoPlane } from './battle-royale/cargo-plane';
import { SkydiveController } from './battle-royale/skydive-controller';
import { BRMinimap } from './battle-royale/minimap';

export class BattleRoyaleMode extends BaseGameMode {
  public readonly id: GameModeType = 'br';
  public readonly title = 'BATTLE ROYALE';
  public readonly description = 'Cargo Plane Drop • 45 m/s Skydive • Shrinking Storm Zone • Last Survivor Wins';
  public readonly requiredPlayerCount = 10;
  public readonly teamSize = 1;
  public readonly isTeamBased = false;

  // Drop Sequence Entities
  public cargoPlane!: CargoPlane;
  public skydiveController!: SkydiveController;
  public minimap!: BRMinimap;

  // Storm Zone State
  public zoneCenter = new THREE.Vector2(0, 0);
  public currentRadius = 55.0;
  public targetRadius = 55.0;
  public startRadius = 55.0;
  public shrinkDuration = 20.0;
  public shrinkElapsed = 0.0;
  public isShrinking = false;
  public phaseNumber = 1;
  public phaseWaitTimer = 15.0;

  // Storm Damage
  public readonly STORM_DPS = 8.0;
  private stormDmgAccumulator = 0;
  public isPlayerInStorm = false;

  // Match State
  public alivePlayers = 2;
  public matchFinished = false;

  // Three.js Shader Ring Mesh
  private stormMesh!: THREE.Mesh;
  private stormMaterial!: THREE.ShaderMaterial;

  public start(): void {
    this.currentRadius = 55.0;
    this.targetRadius = 55.0;
    this.startRadius = 55.0;
    this.phaseNumber = 1;
    this.phaseWaitTimer = 15.0;
    this.isShrinking = false;
    this.shrinkElapsed = 0;
    this.alivePlayers = 2;
    this.matchFinished = false;
    this.isRunning = true;

    // 1. Cleanup old drop entities if any
    this.cleanupDropEntities();

    // 2. Spawn Transport Cargo Plane at Y=350 along randomized flight vector
    this.cargoPlane = new CargoPlane(this.context.scene);

    // 3. Initialize Skydive Controller (Freefall physics, parachute deploy, landing transition)
    this.skydiveController = new SkydiveController(
      this.cargoPlane,
      this.context.controller,
      this.context.scene,
      (this.context.controller as any).botManager
    );

    // 4. Initialize Tactical Minimap Radar
    this.minimap = new BRMinimap(
      this.context.controller,
      this.cargoPlane,
      this.skydiveController,
      (this.context.controller as any).botManager,
      (this.context as any).lootManager
    );

    // 5. Build Storm Barrier Shader Cylinder
    this.createStormShaderCylinder();

    // 6. Display Initial Drop Prompt
    this.context.networkManager.showRoundBanner('✈️ IN CARGO PLANE — PRESS [SPACE] TO DROP!');

    // When landed, display tactical confirmation
    this.skydiveController.onLandingComplete = () => {
      this.context.networkManager.showRoundBanner('🪂 LANDED! LOOT WEAPONS & SURVIVE THE STORM!');
    };
  }

  private createStormShaderCylinder(): void {
    if (this.stormMesh) {
      this.context.scene.remove(this.stormMesh);
      this.stormMesh.geometry.dispose();
      this.stormMaterial.dispose();
    }

    const cylinderGeo = new THREE.CylinderGeometry(1.0, 1.0, 45, 64, 1, true);

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;

      void main() {
        // Vertical gradient & scrolling storm scanlines
        float scanline = sin(vUv.y * 50.0 - uTime * 4.0) * 0.5 + 0.5;
        float pulse = sin(uTime * 2.5) * 0.15 + 0.85;

        // Cyber hexagonal/grid pattern simulation
        float gridX = abs(fract(vUv.x * 40.0 + uTime * 0.2) - 0.5);
        float gridY = abs(fract(vUv.y * 12.0) - 0.5);
        float grid = smoothstep(0.04, 0.0, min(gridX, gridY));

        // Edge glow
        float alpha = (0.22 + scanline * 0.15 + grid * 0.35) * pulse;
        
        // Soft top and bottom fade
        float heightFade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        alpha *= heightFade;

        // Bright neon rim color
        vec3 finalColor = uColor + vec3(grid * 0.5, scanline * 0.3, 0.6);
        gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.85));
      }
    `;

    this.stormMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x9900ff) }, // Neon Purple Storm Barrier
      },
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.stormMesh = new THREE.Mesh(cylinderGeo, this.stormMaterial);
    this.stormMesh.position.set(this.zoneCenter.x, 22.5, this.zoneCenter.y);
    this.stormMesh.scale.set(this.currentRadius, 1, this.currentRadius);
    this.context.scene.add(this.stormMesh);
  }

  public update(delta: number): void {
    if (!this.isRunning || this.matchFinished) return;

    // 1. Update Cargo Plane & Skydive Mechanics
    if (this.cargoPlane) {
      this.cargoPlane.update(delta);
    }
    if (this.skydiveController) {
      this.skydiveController.update(delta);
    }

    // 2. Update Tactical Minimap
    if (this.minimap) {
      this.minimap.update(
        this.zoneCenter,
        this.currentRadius,
        this.targetRadius,
        this.phaseWaitTimer,
        this.isShrinking
      );
    }

    // 3. Advance Storm Phases (Only begins countdown once landing is initiated)
    if (this.skydiveController?.state === 'LANDED') {
      if (!this.isShrinking) {
        this.phaseWaitTimer -= delta;
        if (this.phaseWaitTimer <= 0) {
          this.beginShrinkPhase();
        }
      } else {
        this.shrinkElapsed += delta;
        const progress = Math.min(1.0, this.shrinkElapsed / this.shrinkDuration);
        const smoothT = progress * progress * (3 - 2 * progress);
        this.currentRadius = THREE.MathUtils.lerp(this.startRadius, this.targetRadius, smoothT);

        if (progress >= 1.0) {
          this.isShrinking = false;
          this.phaseNumber++;
          this.phaseWaitTimer = 12.0;
        }
      }
    }

    // 4. Update Shader Cylinder Mesh
    if (this.stormMesh && this.stormMaterial) {
      this.stormMaterial.uniforms.uTime.value = performance.now() * 0.001;
      this.stormMesh.scale.set(this.currentRadius, 1, this.currentRadius);
    }

    // 5. Player Distance Check & Storm Damage (only if on ground)
    if (this.skydiveController?.state === 'LANDED' && this.context.controller?.body && !this.context.controller.isDead) {
      const trans = this.context.controller.body.translation();
      const distFromCenter = Math.hypot(trans.x - this.zoneCenter.x, trans.z - this.zoneCenter.y);

      if (distFromCenter > this.currentRadius) {
        this.isPlayerInStorm = true;
        this.stormDmgAccumulator += delta * this.STORM_DPS;

        if (this.stormDmgAccumulator >= 1.0) {
          const dmg = Math.floor(this.stormDmgAccumulator);
          this.stormDmgAccumulator -= dmg;
          
          this.context.networkManager.localHealth = Math.max(0, this.context.networkManager.localHealth - dmg);
          
          const healthElem = document.getElementById('stat-health');
          const healthBar = document.getElementById('health-bar-fill');
          if (healthElem) healthElem.textContent = `${Math.round(this.context.networkManager.localHealth)}`;
          if (healthBar) healthBar.style.width = `${Math.max(0, this.context.networkManager.localHealth)}%`;

          const flash = document.getElementById('damage-flash');
          if (flash) {
            flash.classList.add('active');
            setTimeout(() => flash.classList.remove('active'), 150);
          }

          if (this.context.networkManager.localHealth <= 0) {
            this.context.controller.triggerDeath();
            this.context.networkManager.sendPacket({
              type: 'kill',
              isHeadshot: false,
            });
            this.onLocalPlayerDeath();
          }
        }
      } else {
        this.isPlayerInStorm = false;
        this.stormDmgAccumulator = 0;
      }
    }
  }

  private beginShrinkPhase(): void {
    this.isShrinking = true;
    this.shrinkElapsed = 0;
    this.startRadius = this.currentRadius;

    if (this.phaseNumber === 1) {
      this.targetRadius = 32.0;
      this.shrinkDuration = 25.0;
    } else if (this.phaseNumber === 2) {
      this.targetRadius = 16.0;
      this.shrinkDuration = 20.0;
    } else {
      this.targetRadius = 5.0;
      this.shrinkDuration = 15.0;
    }

    this.context.networkManager.showRoundBanner(`⚠️ STORM IS SHRINKING TO ${this.targetRadius}M!`);
  }

  public onPlayerKill(_killerName: string, _victimName: string, _isHeadshot: boolean, isLocalKiller: boolean): void {
    this.alivePlayers = Math.max(1, this.alivePlayers - 1);

    if (isLocalKiller) {
      this.matchFinished = true;
      this.context.networkManager.showRoundBanner('👑 #1 VICTORY ROYALE — SURVIVED THE STORM!');
      setTimeout(() => {
        this.start();
      }, 6000);
    }
  }

  public onLocalPlayerDeath(): void {
    this.matchFinished = true;
    this.context.networkManager.showRoundBanner('💀 ELIMINATED BY THE STORM — 2ND PLACE');
    setTimeout(() => {
      this.start();
    }, 6000);
  }

  public onRemotePeerDeath(_peerId: string): void {
    this.matchFinished = true;
    this.context.networkManager.showRoundBanner('👑 #1 VICTORY ROYALE — LAST OPERATIVE ALIVE!');
    setTimeout(() => {
      this.start();
    }, 6000);
  }

  private cleanupDropEntities(): void {
    if (this.cargoPlane) {
      this.cargoPlane.destroy();
    }
    if (this.skydiveController) {
      this.skydiveController.destroy();
    }
    if (this.minimap) {
      this.minimap.destroy();
    }
  }

  public cleanup(): void {
    this.isRunning = false;
    this.matchFinished = false;
    this.cleanupDropEntities();

    if (this.stormMesh) {
      this.context.scene.remove(this.stormMesh);
      this.stormMesh.geometry.dispose();
      this.stormMaterial.dispose();
    }
  }

  public getHUDState(): GameModeHUDState {
    let statusText = '';
    if (this.skydiveController) {
      if (this.skydiveController.state === 'IN_PLANE') {
        statusText = '✈️ IN CARGO PLANE — [SPACE] EJECT';
      } else if (this.skydiveController.state === 'FREEFALL') {
        statusText = `🪂 FREEFALL: ${Math.round(this.skydiveController.currentDescentSpeed)} M/S • [SPACE] PARACHUTE`;
      } else if (this.skydiveController.state === 'PARACHUTE') {
        statusText = '🪂 GLIDING (8 M/S) — [WASD] STEER';
      } else {
        statusText = this.isPlayerInStorm 
          ? '⚠️ IN STORM (TAKING DAMAGE)' 
          : (this.isShrinking ? `🌀 SHRINKING TO ${Math.round(this.targetRadius)}M` : `SAFE FOR ${Math.ceil(this.phaseWaitTimer)}s`);
      }
    }

    return {
      title: 'BATTLE ROYALE',
      subHeader: `ZONE RADIUS: ${Math.round(this.currentRadius)}M`,
      scoreLeftLabel: 'ALIVE',
      scoreLeftValue: `${this.alivePlayers}`,
      scoreRightLabel: 'ALTITUDE',
      scoreRightValue: this.skydiveController ? `${Math.round(this.skydiveController.position.y)}M` : '0M',
      centerBadge: `${Math.round(this.currentRadius)}M`,
      extraInfo: statusText,
    };
  }
}
