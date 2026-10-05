import * as THREE from 'three';
import type { BotEntity } from './bot-entity';

export interface AudioAlertEvent {
  position: THREE.Vector3;
  soundRadius: number;
  emitterId?: string;
  timestamp: number;
}

export class ThreatManager {
  private static _instance: ThreatManager | null = null;

  public static getInstance(): ThreatManager {
    if (!ThreatManager._instance) {
      ThreatManager._instance = new ThreatManager();
    }
    return ThreatManager._instance;
  }

  private bots: Set<BotEntity> = new Set();
  private lastAlertTimestamp = 0;

  public registerBot(bot: BotEntity): void {
    this.bots.add(bot);
  }

  public unregisterBot(bot: BotEntity): void {
    this.bots.delete(bot);
  }

  public clear(): void {
    this.bots.clear();
  }

  /**
   * Whenever a player or bot fires an unsuppressed weapon, sprints, or triggers an explosion,
   * emit an audio alert propagating sound waves in a spherical radius.
   */
  public emitAudioAlert(position: THREE.Vector3, soundRadius = 30.0, emitterId?: string): void {
    const now = performance.now();
    // Throttle duplicate audio events from the same source within 80ms
    if (now - this.lastAlertTimestamp < 80) return;
    this.lastAlertTimestamp = now;

    for (const bot of this.bots) {
      if (bot.isDead) continue;
      if (emitterId && bot.id === emitterId) continue;

      const botPos = new THREE.Vector3(bot.position.x, bot.position.y, bot.position.z);
      const distance = botPos.distanceTo(position);

      if (distance <= soundRadius) {
        bot.onHearNoise(position.clone(), distance, emitterId);
      }
    }
  }

  /**
   * Call for Backup:
   * When a bot spots an enemy or takes fire, alert all nearby allied bots within radius (20m)
   * so they converge on the target coordinates as a tactical squad.
   */
  public callForBackup(caller: BotEntity, enemyPos: THREE.Vector3, radius = 20.0): void {
    const callerPos = new THREE.Vector3(caller.position.x, caller.position.y, caller.position.z);

    for (const bot of this.bots) {
      if (bot === caller || bot.isDead) continue;
      // Must be on the same team (or both non-player in non-FFA)
      if (bot.team !== caller.team && caller.team !== 'ffa') continue;

      const botPos = new THREE.Vector3(bot.position.x, bot.position.y, bot.position.z);
      const dist = botPos.distanceTo(callerPos);

      if (dist <= radius) {
        bot.onBackupRequested(enemyPos.clone(), caller);
      }
    }
  }
}

export const threatManager = ThreatManager.getInstance();
