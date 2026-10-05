import * as THREE from 'three';
import { sounds } from './weapons/sound-manager';
import type { FPSController } from './fps-controller';
import type { MapManager } from './maps/map-manager';

export type GameState = 'MENU' | 'WAITING_LOBBY' | 'STARTING' | 'PLAYING' | 'GAME_OVER';

export class GameStateManager {
  private static _instance: GameStateManager | null = null;

  public static getInstance(): GameStateManager {
    if (!GameStateManager._instance) {
      GameStateManager._instance = new GameStateManager();
    }
    return GameStateManager._instance;
  }

  public state: GameState = 'MENU';
  public isInvulnerable = false;
  public controller?: FPSController;
  public mapManager?: MapManager;

  private countdownTimer: number | null = null;
  private invulnerabilityTimer: number | null = null;

  constructor() {
    this.createCountdownBannerElement();
  }

  public isPlaying(): boolean {
    return this.state === 'PLAYING';
  }

  public isDamageAllowed(): boolean {
    return this.state === 'PLAYING' && !this.isInvulnerable;
  }

  public setMenu(): void {
    this.state = 'MENU';
    this.isInvulnerable = false;
    this.clearTimers();
    this.hideCountdownBanner();
    this.hideShieldIndicator();
  }

  public setWaitingLobby(): void {
    this.state = 'WAITING_LOBBY';
    this.isInvulnerable = false;
    this.clearTimers();
    this.hideCountdownBanner();
    this.hideShieldIndicator();
  }

  public setGameOver(): void {
    this.state = 'GAME_OVER';
    this.isInvulnerable = false;
    this.clearTimers();
    this.hideShieldIndicator();
  }

  /**
   * Starts match sequence:
   * 1. Sets state to 'STARTING'
   * 2. Runs 3-second countdown UI ("3... 2... 1... FIGHT!")
   * 3. Teleports player to designated spawn point (NOT 0,0,0)
   * 4. Resets player health to 100, restores full ammo, grants 3-second invulnerability shield
   * 5. Locks mouse pointer and transitions to 'PLAYING' once countdown finishes
   */
  public startMatchSequence(onComplete?: () => void): void {
    this.clearTimers();
    this.state = 'STARTING';
    this.isInvulnerable = true;
    this.showShieldIndicator();

    // 1. Teleport player to map's designated player spawn
    if (this.controller) {
      let spawnPos = new THREE.Vector3(-14, 0.05, 0);
      if (this.mapManager?.activeMap?.spawns?.playerSpawn) {
        spawnPos = this.mapManager.activeMap.spawns.playerSpawn.clone();
      }

      if (this.controller.body) {
        this.controller.body.setTranslation({ x: spawnPos.x, y: spawnPos.y + 0.9, z: spawnPos.z }, true);
        this.controller.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      this.controller.camera.position.set(spawnPos.x, spawnPos.y + 0.65, spawnPos.z);
      this.controller.health = 100;
      this.controller.isDead = false;

      // Restore full ammo on active and reserve slots
      if (this.controller.weapon) {
        if ((this.controller.weapon as any).replenishAllAmmo) {
          (this.controller.weapon as any).replenishAllAmmo();
        } else if ((this.controller.weapon as any).replenishAmmo) {
          (this.controller.weapon as any).replenishAmmo();
        }
      }
    }

    // 2. 3-Second Countdown UI
    let count = 3;
    this.showCountdownBanner(`${count}`);
    sounds.playHitmarkerTick();

    const interval = window.setInterval(() => {
      count--;
      if (count > 0) {
        this.showCountdownBanner(`${count}`);
        sounds.playHitmarkerTick();
      } else if (count === 0) {
        this.showCountdownBanner('⚔️ FIGHT!');
        sounds.playHeadshotTick();
        window.clearInterval(interval);

        // Transition to PLAYING
        this.state = 'PLAYING';
        if (this.controller) {
          this.controller.lock();
        }

        if (onComplete) {
          onComplete();
        }

        setTimeout(() => {
          this.hideCountdownBanner();
        }, 1200);

        // Maintain temporary 3-second invulnerability shield during opening moments
        this.invulnerabilityTimer = window.setTimeout(() => {
          this.isInvulnerable = false;
          this.hideShieldIndicator();
        }, 3000);
      }
    }, 1000);

    this.countdownTimer = interval;
  }

  private clearTimers(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.invulnerabilityTimer !== null) {
      window.clearTimeout(this.invulnerabilityTimer);
      this.invulnerabilityTimer = null;
    }
  }

  private createCountdownBannerElement(): void {
    if (document.getElementById('match-countdown-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'match-countdown-banner';
    banner.className = 'match-countdown-banner hidden';
    document.body.appendChild(banner);

    const shield = document.createElement('div');
    shield.id = 'shield-indicator';
    shield.className = 'shield-indicator hidden';
    shield.innerHTML = '🛡️ SPAWN SHIELD ACTIVE (INVULNERABLE)';
    document.body.appendChild(shield);
  }

  public showCountdownBanner(text: string): void {
    const banner = document.getElementById('match-countdown-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('visible');
  }

  public hideCountdownBanner(): void {
    const banner = document.getElementById('match-countdown-banner');
    if (banner) {
      banner.classList.remove('visible');
      banner.classList.add('hidden');
    }
  }

  public showShieldIndicator(): void {
    const shield = document.getElementById('shield-indicator');
    if (shield) {
      shield.classList.remove('hidden');
      shield.classList.add('visible');
    }
  }

  public hideShieldIndicator(): void {
    const shield = document.getElementById('shield-indicator');
    if (shield) {
      shield.classList.remove('visible');
      shield.classList.add('hidden');
    }
  }
}

export const gameState = GameStateManager.getInstance();
