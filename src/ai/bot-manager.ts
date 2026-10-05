import * as THREE from 'three';
import * as YUKA from 'yuka';
import { BotEntity } from './bot-entity';
import { createArenaNavMesh } from './navmesh-helper';
import { FPSController } from '../fps-controller';
import { FXManager } from '../weapon-system';
import { scoreManager } from '../scoring/score-manager';

export class BotManager {
  public entityManager: YUKA.EntityManager;
  public navMesh: YUKA.NavMesh;
  public bots: BotEntity[] = [];

  private scene: THREE.Scene;
  private controller: FPSController;
  private fx: FXManager;

  constructor(scene: THREE.Scene, controller: FPSController, fx: FXManager) {
    this.scene = scene;
    this.controller = controller;
    this.fx = fx;

    this.entityManager = new YUKA.EntityManager();
    this.navMesh = createArenaNavMesh();
  }

  public spawnSingleBot(
    id: string,
    name: string,
    pos: THREE.Vector3,
    team: 'blue' | 'red' | 'ffa' = 'red'
  ): BotEntity {
    const bot = new BotEntity(
      id,
      name,
      pos,
      this.scene,
      this.navMesh,
      this.controller,
      this.fx,
      team,
      this
    );

    this.bots.push(bot);
    this.entityManager.add(bot);
    scoreManager.registerEntity(bot);
    return bot;
  }

  public spawnBots(count = 3): void {
    const spawnPoints = [
      new THREE.Vector3(-18, 0.05, -18),
      new THREE.Vector3(18, 0.05, -18),
      new THREE.Vector3(0, 0.05, -28),
      new THREE.Vector3(-20, 0.05, 20),
    ];

    const botNames = ['BOT-PHANTOM', 'BOT-SPECTRE', 'BOT-VORTEX', 'BOT-NEXUS'];

    for (let i = 0; i < Math.min(count, spawnPoints.length); i++) {
      const pos = spawnPoints[i];
      this.spawnSingleBot(`bot-${i + 1}`, botNames[i], pos, 'red');
    }
  }

  public update(delta: number): void {
    // 1. Advance Yuka Simulation
    this.entityManager.update(delta);

    // 2. Update Bots
    for (const bot of this.bots) {
      bot.update(delta);
    }
  }

  public getBotHitboxInfo(colliderHandle: number): { bot: BotEntity; hitboxType: 'head' | 'torso' | 'limb'; multiplier: number } | null {
    for (const bot of this.bots) {
      if (bot.isDead) continue;
      if (bot.headCollider?.handle === colliderHandle) {
        return { bot, hitboxType: 'head', multiplier: 2.5 };
      }
      if (bot.torsoCollider?.handle === colliderHandle) {
        return { bot, hitboxType: 'torso', multiplier: 1.0 };
      }
      if (bot.limbCollider?.handle === colliderHandle) {
        return { bot, hitboxType: 'limb', multiplier: 0.7 };
      }
    }
    return null;
  }

  public checkMeshIntersection(raycaster: THREE.Raycaster): { bot: BotEntity; hitboxType: 'head' | 'torso' | 'limb'; point: THREE.Vector3 } | null {
    for (const bot of this.bots) {
      if (bot.isDead) continue;
      const intersects = raycaster.intersectObjects(bot.hitMeshes, false);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const hitboxType = (hit.object.userData?.hitboxType as 'head' | 'torso' | 'limb') || 'torso';
        return { bot, hitboxType, point: hit.point };
      }
    }
    return null;
  }

  public cleanup(): void {
    for (const bot of this.bots) {
      scoreManager.unregisterEntity(bot.id);
      bot.destroy();
    }
    this.bots = [];
    this.entityManager.clear();
  }
}
