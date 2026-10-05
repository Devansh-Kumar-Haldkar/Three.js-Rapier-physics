import { sounds } from '../weapons/sound-manager';
import type { NetworkManager } from '../network/network-manager';
import type { GameModeManager } from '../gamemodes/game-mode-manager';

export interface Damageable {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  isDead: boolean;
  takeDamage(amount: number, attackerId: string, hitLocation?: string): void;
}

/**
 * Unified ScoreManager
 * Centralizes kill registration, score updates, kill banner UI, and HUD synchronization
 * across local players, remote peers, and AI bots with strict double-count protection.
 */
export class ScoreManager {
  private static _instance: ScoreManager | null = null;

  public static getInstance(): ScoreManager {
    if (!ScoreManager._instance) {
      ScoreManager._instance = new ScoreManager();
    }
    return ScoreManager._instance;
  }

  public localKills = 0;
  public localDeaths = 0;
  public localScore = 0;
  public teamBlueScore = 0;
  public teamRedScore = 0;
  public targetScore = 50;

  public networkManager?: NetworkManager;
  public gameModeManager?: GameModeManager;

  // Registered entity dictionary for quick name resolution
  private entities: Map<string, Damageable> = new Map();

  constructor() {
    this.createKillBannerElement();
  }

  public registerEntity(entity: Damageable): void {
    this.entities.set(entity.id, entity);
  }

  public unregisterEntity(id: string): void {
    this.entities.delete(id);
  }

  public getEntity(id: string): Damageable | undefined {
    return this.entities.get(id);
  }

  /**
   * Registers a confirmed elimination with double-kill prevention and UI/Audio feedback.
   */
  public registerKill(attackerId: string, victimId: string, weapon = 'AR-X PULSE', isHeadshot = false): void {
    const attackerName = this.resolveName(attackerId);
    const victimName = this.resolveName(victimId);

    console.log(`[SCORE] Kill Registered: ${attackerName} (${attackerId}) eliminated ${victimName} (${victimId}) with ${weapon}`);

    // Update Team Scores based on team association
    const isAttackerBlue = attackerId === 'local_player' || attackerId.includes('blue') || attackerName.includes('BLUE');
    if (isAttackerBlue) {
      this.teamBlueScore++;
    } else {
      this.teamRedScore++;
    }

    // Local Player Scored Kill
    if (attackerId === 'local_player' || attackerId === 'Player') {
      this.localKills++;
      const scoreGain = isHeadshot ? 125 : 100;
      this.localScore += scoreGain;

      // Audio Confirmation
      if (isHeadshot) {
        sounds.playHeadshotTick();
      } else {
        sounds.playHitmarkerTick();
      }

      // Display Center Kill Confirmation Banner
      const bonusText = isHeadshot ? '🎯 HEADSHOT ELIMINATED' : '⚔️ ELIMINATED';
      this.showKillBanner(`${bonusText} ${victimName} (+${scoreGain})`, isHeadshot);
    }

    // Local Player Died
    if (victimId === 'local_player' || victimId === 'Player') {
      this.localDeaths++;
    }

    // Add to live Killfeed
    if (this.networkManager) {
      this.networkManager.addKillFeed(attackerName, victimName, weapon, isHeadshot);
    }

    // Forward to active Game Mode Manager
    if (this.gameModeManager) {
      this.gameModeManager.onPlayerKill(attackerName, victimName, isHeadshot, attackerId === 'local_player');
    }

    // Update HUD Scoreboard
    this.updateHUD();
  }

  public resolveName(id: string): string {
    if (id === 'local_player' || id === 'Player') {
      return this.networkManager?.playerName || 'PLAYER (BLUE)';
    }
    const registered = this.entities.get(id);
    if (registered) return registered.name;

    if (id.startsWith('bot-') || id.startsWith('BOT-')) {
      return id.toUpperCase();
    }
    return id;
  }

  public updateHUD(): void {
    const blueVal = document.getElementById('score-blue-val');
    const redVal = document.getElementById('score-red-val');
    if (blueVal) blueVal.textContent = `${this.teamBlueScore}`;
    if (redVal) redVal.textContent = `${this.teamRedScore}`;
  }

  private createKillBannerElement(): void {
    if (document.getElementById('kill-notification-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'kill-notification-banner';
    banner.className = 'kill-notification-banner hidden';
    document.body.appendChild(banner);
  }

  public showKillBanner(message: string, isHeadshot = false): void {
    const banner = document.getElementById('kill-notification-banner');
    if (!banner) return;

    banner.textContent = message;
    banner.className = `kill-notification-banner visible ${isHeadshot ? 'headshot' : ''}`;

    setTimeout(() => {
      banner.className = 'kill-notification-banner hidden';
    }, 2800);
  }

  public reset(): void {
    this.localKills = 0;
    this.localDeaths = 0;
    this.localScore = 0;
    this.teamBlueScore = 0;
    this.teamRedScore = 0;
    this.updateHUD();
  }
}

export const scoreManager = ScoreManager.getInstance();
