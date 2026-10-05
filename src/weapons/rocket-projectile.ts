import * as THREE from 'three';
import { RAPIER, physics } from '../physics';
import { FXManager } from './fx-manager';
import { sounds } from './sound-manager';
import { scoreManager } from '../scoring/score-manager';
import { threatManager } from '../ai/threat-manager';
import type { DummyManager } from '../target-dummy';
import type { NetworkManager } from '../network/network-manager';
import type { BotManager } from '../ai/bot-manager';

export class RocketProjectile {
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public speed = 45.0; // 45 m/s
  public radius = 5.0; // 5m explosion radius
  public maxDamage = 150;
  public isDead = false;
  public flightTime = 0;
  private lifeTimer = 0;
  private maxLife = 5.0; // Seconds

  private scene: THREE.Scene;
  private fx: FXManager;
  private dummyManager?: DummyManager;
  private networkManager?: NetworkManager;
  private botManager?: BotManager;
  public shooterId: string;
  public shooterName: string;
  private excludeCollider?: RAPIER.Collider;
  private excludeBody?: RAPIER.RigidBody;

  constructor(
    startPos: THREE.Vector3,
    direction: THREE.Vector3,
    scene: THREE.Scene,
    fx: FXManager,
    shooterId = 'local_player',
    shooterName = 'Player',
    dummyManager?: DummyManager,
    networkManager?: NetworkManager,
    botManager?: BotManager,
    excludeCollider?: RAPIER.Collider,
    excludeBody?: RAPIER.RigidBody
  ) {
    this.scene = scene;
    this.fx = fx;
    this.shooterId = shooterId;
    this.shooterName = shooterName;
    this.dummyManager = dummyManager;
    this.networkManager = networkManager;
    this.botManager = botManager;
    this.excludeCollider = excludeCollider;
    this.excludeBody = excludeBody;

    this.position = startPos.clone();
    this.velocity = direction.clone().normalize().multiplyScalar(this.speed);

    // 3D Rocket Model
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.position);

    // 1. Rocket Body Tube
    const bodyGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 12);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.3,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(bodyMesh);

    // 2. Warhead Cone
    const coneGeo = new THREE.ConeGeometry(0.05, 0.14, 12);
    coneGeo.rotateX(-Math.PI / 2);
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Red tactical warhead
      metalness: 0.5,
      roughness: 0.4,
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.position.set(0, 0, -0.26);
    this.mesh.add(coneMesh);

    // 3. Rocket Stabilizer Fins
    const finGeo = new THREE.BoxGeometry(0.18, 0.01, 0.08);
    const finMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 });
    const fin1 = new THREE.Mesh(finGeo, finMat);
    fin1.position.set(0, 0, 0.16);
    this.mesh.add(fin1);

    const fin2 = new THREE.Mesh(finGeo, finMat);
    fin2.position.set(0, 0, 0.16);
    fin2.rotation.z = Math.PI / 2;
    this.mesh.add(fin2);

    // 4. Glowing Rocket Thruster
    const flameGeo = new THREE.ConeGeometry(0.035, 0.16, 8);
    flameGeo.rotateX(Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(0, 0, 0.28);
    this.mesh.add(flameMesh);

    // Look at velocity direction
    this.mesh.lookAt(this.position.clone().add(this.velocity));
    this.scene.add(this.mesh);

    sounds.playRocketLaunch();
  }

  public update(delta: number): boolean {
    if (this.isDead) return false;

    this.flightTime += delta;
    this.lifeTimer += delta;
    if (this.lifeTimer >= this.maxLife) {
      this.explode(this.position);
      return false;
    }

    const stepDist = this.speed * delta;
    const moveStep = this.velocity.clone().multiplyScalar(delta);
    const nextPos = this.position.clone().add(moveStep);
    const dir = this.velocity.clone().normalize();

    // 1. Particle Smoke & Flame Trails
    this.fx.emitSparks(
      this.position.clone().addScaledVector(dir, -0.2),
      dir.clone().negate(),
      2,
      false
    );

    // 2. Collision Raycast against arena geometry (excluding shooter colliders)
    const rapierRay = new RAPIER.Ray(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );

    const hit = physics.world.castRayAndGetNormal(
      rapierRay,
      stepDist + 0.15,
      true,
      undefined,
      undefined,
      this.excludeCollider,
      this.excludeBody,
      (collider) => {
        // Ignore shooter's own collider for first 0.25 seconds of flight
        if (this.flightTime < 0.25 && this.excludeCollider && collider.handle === this.excludeCollider.handle) {
          return false;
        }
        return true;
      }
    );

    if (hit && hit.timeOfImpact <= stepDist + 0.1) {
      const impactPoint = this.position.clone().addScaledVector(dir, hit.timeOfImpact);
      this.explode(impactPoint);
      return false;
    }

    // 3. Proximity Check against Dummies, Bots, and Players
    let hitEntity = false;

    // Bots
    if (this.botManager?.bots) {
      for (const bot of this.botManager.bots) {
        if (!bot.isDead) {
          // If shooter is this bot and flightTime < 0.25s, ignore
          if (this.flightTime < 0.25 && this.shooterId === bot.id) continue;

          const dist = bot.position.distanceTo(nextPos as any);
          if (dist < 1.2) {
            this.explode(nextPos);
            hitEntity = true;
            break;
          }
        }
      }
    }

    // Remote Peers
    if (!hitEntity && this.networkManager?.peers) {
      for (const peer of this.networkManager.peers.values()) {
        if (!peer.isDead) {
          if (this.flightTime < 0.25 && this.shooterId === peer.id) continue;

          const dist = peer.currentPos.distanceTo(nextPos);
          if (dist < 1.4) {
            this.explode(nextPos);
            hitEntity = true;
            break;
          }
        }
      }
    }

    // Target Dummies
    if (!hitEntity && this.dummyManager?.dummies) {
      for (const dummy of this.dummyManager.dummies) {
        if (!dummy.isDead) {
          const dist = dummy.group.position.distanceTo(nextPos);
          if (dist < 1.4) {
            this.explode(nextPos);
            hitEntity = true;
            break;
          }
        }
      }
    }

    if (hitEntity) return false;

    this.position.copy(nextPos);
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.position.clone().add(this.velocity));
    return true;
  }

  /**
   * Radial splash explosion (5m radius, 150 damage max)
   */
  public explode(center: THREE.Vector3): void {
    if (this.isDead) return;
    this.isDead = true;

    // Visual & Sound
    this.fx.addExplosionEffect(center, this.radius);
    sounds.playExplosion();

    // Propagate explosion noise alert (50m radius)
    threatManager.emitAudioAlert(center, 50.0, this.shooterId);

    // 1. Radial Splash Damage to AI Bots
    if (this.botManager?.bots) {
      for (const bot of this.botManager.bots) {
        if (!bot.isDead) {
          const botPos = new THREE.Vector3(bot.position.x, bot.position.y + 0.9, bot.position.z);
          const dist = botPos.distanceTo(center);
          if (dist <= this.radius) {
            // Linear splash falloff
            const damageFactor = 1.0 - (dist / this.radius);
            const splashDamage = Math.round(this.maxDamage * damageFactor);
            const hitNormal = botPos.clone().sub(center).normalize();

            bot.takeDamage(splashDamage, this.shooterId, 'torso');
            this.dummyManager?.spawnFloatingText(botPos, splashDamage, false);
            this.dummyManager?.triggerHitmarker(false);

            if (bot.health <= 0) {
              scoreManager.registerKill(this.shooterId, bot.id, 'TITAN-RPG', false);
            }
          }
        }
      }
    }

    // 2. Radial Splash Damage to Local Player (Only if player is near explosion center)
    if (this.networkManager) {
      const playerPos = (this.networkManager as any).controller?.camera?.position;
      if (playerPos) {
        const dist = playerPos.distanceTo(center);
        if (dist <= this.radius) {
          const damageFactor = 1.0 - (dist / this.radius);
          const splashDamage = Math.round(this.maxDamage * damageFactor * 0.7); // Slight self-damage mitigation
          if (splashDamage > 0) {
            this.networkManager.applyDirectDamage(splashDamage, 'torso', this.shooterName);
          }
        }
      }
    }

    // 3. Radial Splash Damage to Target Dummies
    if (this.dummyManager?.dummies) {
      for (const dummy of this.dummyManager.dummies) {
        if (!dummy.isDead) {
          const dPos = dummy.group.position.clone().add(new THREE.Vector3(0, 1.0, 0));
          const dist = dPos.distanceTo(center);
          if (dist <= this.radius) {
            const damageFactor = 1.0 - (dist / this.radius);
            const splashDamage = Math.round(this.maxDamage * damageFactor);
            const hitNormal = dPos.clone().sub(center).normalize();
            dummy.takeDamage(splashDamage, 'torso', dPos, hitNormal, this.dummyManager);
            this.dummyManager.spawnFloatingText(dPos, splashDamage, false);
            this.dummyManager.triggerHitmarker(false);
          }
        }
      }
    }

    // Remove mesh from scene
    this.scene.remove(this.mesh);
  }

  public destroy(): void {
    this.isDead = true;
    this.scene.remove(this.mesh);
  }
}
