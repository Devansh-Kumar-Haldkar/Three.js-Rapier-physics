import * as THREE from 'three';
import { BaseGameMap, MapId, MAP_METADATA } from './types';
import { DesertOutpostMap } from './desert-outpost';
import { OvergrownJungleMap } from './overgrown-jungle';
import { NeonCityMap } from './neon-city';
import type { BotManager } from '../ai/bot-manager';
import type { FPSController } from '../fps-controller';
import type { WorldLootManager } from '../world-loot/loot-manager';

export class MapManager {
  public scene: THREE.Scene;
  public controller: FPSController;
  public botManager?: BotManager;
  public lootManager?: WorldLootManager;

  public activeMapId: MapId = 'desert';
  public activeMap!: BaseGameMap;

  constructor(
    scene: THREE.Scene,
    controller: FPSController,
    botManager?: BotManager,
    lootManager?: WorldLootManager,
    initialMapId: MapId = 'desert'
  ) {
    this.scene = scene;
    this.controller = controller;
    this.botManager = botManager;
    this.lootManager = lootManager;

    this.loadMap(initialMapId);
  }

  public loadMap(mapId: MapId): BaseGameMap {
    console.log(`[MAP-MANAGER] Loading map environment: ${mapId.toUpperCase()} (${MAP_METADATA[mapId].name})`);

    // 1. Clean up old map
    if (this.activeMap) {
      this.activeMap.destroy();
    }

    this.activeMapId = mapId;

    // 2. Instantiate new map
    switch (mapId) {
      case 'jungle':
        this.activeMap = new OvergrownJungleMap(this.scene);
        break;
      case 'neon':
        this.activeMap = new NeonCityMap(this.scene);
        break;
      case 'desert':
      default:
        this.activeMap = new DesertOutpostMap(this.scene);
        break;
    }

    // 3. Build map geometry, lighting, physics, and NavMesh
    this.activeMap.build();

    // 4. Update BotManager NavMesh & Waypoints
    if (this.botManager) {
      this.botManager.navMesh = this.activeMap.navMesh;
      for (const bot of this.botManager.bots) {
        bot.navMesh = this.activeMap.navMesh;
        bot.patrolWaypoints = [...this.activeMap.spawns.patrolWaypoints];
        bot.coverWaypoints = [...this.activeMap.spawns.coverWaypoints];
      }
    }

    // 5. Teleport player to map spawn point
    const pSpawn = this.activeMap.spawns.playerSpawn;
    if (this.controller.body) {
      this.controller.body.setTranslation({ x: pSpawn.x, y: pSpawn.y, z: pSpawn.z }, true);
      this.controller.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.controller.camera.position.copy(pSpawn);

    // 6. Update Lobby Map Selector UI Cards
    this.updateLobbyUI();

    return this.activeMap;
  }

  public update(delta: number): void {
    if (this.activeMap) {
      this.activeMap.update(delta);
    }
  }

  private updateLobbyUI(): void {
    const mapCards = document.querySelectorAll('.map-card');
    mapCards.forEach((card) => {
      const cardMapId = card.getAttribute('data-map');
      if (cardMapId === this.activeMapId) {
        card.classList.add('active');
        const badge = card.querySelector('.map-badge');
        if (badge) badge.textContent = 'ACTIVE';
      } else {
        card.classList.remove('active');
        const badge = card.querySelector('.map-badge');
        if (badge) badge.textContent = 'SELECT';
      }
    });
  }

  public destroy(): void {
    if (this.activeMap) {
      this.activeMap.destroy();
    }
  }
}
