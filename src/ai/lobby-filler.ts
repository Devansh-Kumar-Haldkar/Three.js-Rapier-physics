import * as THREE from 'three';
import { GameModeType } from '../gamemodes/types';
import { GameModeManager } from '../gamemodes/game-mode-manager';
import { NetworkManager } from '../network/network-manager';
import { BotManager } from './bot-manager';

export interface LobbySlotInfo {
  mode: GameModeType;
  requiredPlayers: number;
  isTeamBased: boolean;
  humanCountTotal: number;
  humanCountBlue: number;
  humanCountRed: number;
  botsNeededBlue: number;
  botsNeededRed: number;
  botsNeededFFA: number;
  totalBots: number;
}

/**
 * LobbyFiller Controller:
 * - Reads required player counts for active match modes (8 for 4v4 TDM/Clash, 10 for BR).
 * - Counts connected human peers from NetworkManager.
 * - Fills all open slots with BotEntity instances assigned to corresponding teams.
 * - Provides Offline Practice support to immediately start populated matches.
 */
export class LobbyFiller {
  private networkManager: NetworkManager;
  private gameModeManager: GameModeManager;
  private botManager: BotManager;
  public isOfflinePractice = false;

  constructor(
    networkManager: NetworkManager,
    gameModeManager: GameModeManager,
    botManager: BotManager
  ) {
    this.networkManager = networkManager;
    this.gameModeManager = gameModeManager;
    this.botManager = botManager;
  }

  /**
   * Calculates the required open slot filling for the active game mode.
   */
  public calculateSlots(modeType?: GameModeType): LobbySlotInfo {
    const mode = modeType || this.gameModeManager.activeMode?.id || 'tdm';
    const activeGameMode = this.gameModeManager.activeMode;
    const requiredPlayers = activeGameMode?.requiredPlayerCount || (mode === 'br' ? 10 : 8);
    const isTeamBased = activeGameMode ? activeGameMode.isTeamBased : (mode !== 'br');

    // Count connected human peers
    const connectedPeers = this.networkManager.peers.size;
    const localHumanCount = 1; // Local player
    const humanCountTotal = this.isOfflinePractice ? 1 : (localHumanCount + connectedPeers);

    let humanCountBlue = 0;
    let humanCountRed = 0;
    let botsNeededBlue = 0;
    let botsNeededRed = 0;
    let botsNeededFFA = 0;

    if (isTeamBased) {
      const teamSize = activeGameMode?.teamSize || 4; // 4v4 default
      // Host is Blue (Team A)
      humanCountBlue = 1;
      // Remote peers join Red (Team B) or balance
      humanCountRed = this.isOfflinePractice ? 0 : Math.min(teamSize, connectedPeers);

      botsNeededBlue = Math.max(0, teamSize - humanCountBlue);
      botsNeededRed = Math.max(0, teamSize - humanCountRed);
    } else {
      // FFA Battle Royale
      botsNeededFFA = Math.max(0, requiredPlayers - humanCountTotal);
    }

    const totalBots = isTeamBased ? (botsNeededBlue + botsNeededRed) : botsNeededFFA;

    return {
      mode,
      requiredPlayers,
      isTeamBased,
      humanCountTotal,
      humanCountBlue,
      humanCountRed,
      botsNeededBlue,
      botsNeededRed,
      botsNeededFFA,
      totalBots,
    };
  }

  /**
   * Fills all open slots with BotEntity instances assigned to their corresponding teams.
   */
  public fillLobby(modeType?: GameModeType, isOfflinePractice = false): void {
    this.isOfflinePractice = isOfflinePractice;
    const slots = this.calculateSlots(modeType);

    console.log(`[LOBBY-FILLER] Populating lobby for ${slots.mode.toUpperCase()}:`, slots);

    // Clear existing bots
    this.botManager.cleanup();

    if (slots.isTeamBased) {
      // Team Spawns: Blue base (South Z: +20..+30), Red base (North Z: -20..-30)
      const blueSpawns = [
        new THREE.Vector3(-14, 0.05, 20),
        new THREE.Vector3(0, 0.05, 26),
        new THREE.Vector3(14, 0.05, 20),
        new THREE.Vector3(-8, 0.05, 30),
      ];

      const redSpawns = [
        new THREE.Vector3(-14, 0.05, -20),
        new THREE.Vector3(0, 0.05, -26),
        new THREE.Vector3(14, 0.05, -20),
        new THREE.Vector3(8, 0.05, -30),
      ];

      const blueBotNames = ['BLUE-TITAN', 'BLUE-ECHO', 'BLUE-GHOST', 'BLUE-CIPHER'];
      const redBotNames = ['RED-VORTEX', 'RED-PHANTOM', 'RED-SPECTRE', 'RED-NEXUS'];

      // Spawn Blue Bots
      for (let i = 0; i < slots.botsNeededBlue; i++) {
        const spawn = blueSpawns[i % blueSpawns.length].clone();
        spawn.x += (Math.random() - 0.5) * 2;
        const botName = blueBotNames[i % blueBotNames.length];
        this.botManager.spawnSingleBot(`bot-blue-${i + 1}`, botName, spawn, 'blue');
      }

      // Spawn Red Bots
      for (let i = 0; i < slots.botsNeededRed; i++) {
        const spawn = redSpawns[i % redSpawns.length].clone();
        spawn.x += (Math.random() - 0.5) * 2;
        const botName = redBotNames[i % redBotNames.length];
        this.botManager.spawnSingleBot(`bot-red-${i + 1}`, botName, spawn, 'red');
      }
    } else {
      // FFA Battle Royale Spawns around perimeter
      const ffaSpawns = [
        new THREE.Vector3(-22, 0.05, -22),
        new THREE.Vector3(22, 0.05, -22),
        new THREE.Vector3(-22, 0.05, 22),
        new THREE.Vector3(22, 0.05, 22),
        new THREE.Vector3(0, 0.05, -30),
        new THREE.Vector3(0, 0.05, 30),
        new THREE.Vector3(-30, 0.05, 0),
        new THREE.Vector3(30, 0.05, 0),
        new THREE.Vector3(-15, 0.05, -15),
        new THREE.Vector3(15, 0.05, 15),
      ];

      const ffaBotNames = [
        'BOT-PHANTOM', 'BOT-SPECTRE', 'BOT-VORTEX', 'BOT-NEXUS',
        'BOT-RAZOR', 'BOT-VIPER', 'BOT-TITAN', 'BOT-SHADOW', 'BOT-STORM'
      ];

      for (let i = 0; i < slots.botsNeededFFA; i++) {
        const spawn = ffaSpawns[i % ffaSpawns.length].clone();
        spawn.x += (Math.random() - 0.5) * 2;
        spawn.z += (Math.random() - 0.5) * 2;
        const botName = ffaBotNames[i % ffaBotNames.length];
        this.botManager.spawnSingleBot(`bot-ffa-${i + 1}`, botName, spawn, 'ffa');
      }
    }

    // Announce lobby roster filling
    const teamMsg = slots.isTeamBased
      ? `Auto-Filled ${slots.botsNeededBlue} Blue & ${slots.botsNeededRed} Red Bots (${slots.requiredPlayers} Slots Total)`
      : `Auto-Filled ${slots.botsNeededFFA} FFA Bots (${slots.requiredPlayers} Operatives Total)`;

    this.networkManager.showRoundBanner(`🤖 ${teamMsg}`);
  }
}
