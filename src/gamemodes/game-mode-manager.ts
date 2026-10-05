import { BaseGameMode } from './game-mode';
import { GameModeType, GameModeContext, GameModeInfo } from './types';
import { TeamDeathmatchMode } from './tdm';
import { ClashSquadMode } from './clash-squad';
import { BattleRoyaleMode } from './battle-royale';

export class GameModeManager {
  private modes: Map<GameModeType, BaseGameMode> = new Map();
  public activeMode!: BaseGameMode;
  private context!: GameModeContext;

  public static readonly AVAILABLE_MODES: GameModeInfo[] = [
    {
      id: 'tdm',
      title: 'TEAM DEATHMATCH',
      tagline: '4v4 • Target 50 Kills • Fast Respawns',
      icon: '🏆',
      details: 'Classic tactical combat. Eliminate opposing operatives. First team to reach 50 kills claims victory.',
    },
    {
      id: 'clash',
      title: 'CLASH SQUAD',
      tagline: 'First to 4 Rounds • 15s Freeze Phase • No Mid-Round Respawns',
      icon: '⚔️',
      details: 'High-stakes round-based duels. Plan during the 15-second freeze phase. Zero mid-round respawns.',
    },
    {
      id: 'br',
      title: 'BATTLE ROYALE',
      tagline: 'Shrinking Storm Zone • Safe Ring • Last Operative Standing',
      icon: '🌀',
      details: 'Survive against opponents and the shrinking cylindrical storm ring. Outside storm deals damage per second.',
    },
  ];

  public init(context: GameModeContext, initialMode: GameModeType = 'tdm'): void {
    this.context = context;

    // Instantiate all game modes
    const tdm = new TeamDeathmatchMode();
    tdm.init(context);
    this.modes.set('tdm', tdm);

    const clash = new ClashSquadMode();
    clash.init(context);
    this.modes.set('clash', clash);

    const br = new BattleRoyaleMode();
    br.init(context);
    this.modes.set('br', br);

    // Set initial active mode
    this.setMode(initialMode, false);
  }

  public setMode(modeId: GameModeType, broadcast = true): void {
    const nextMode = this.modes.get(modeId);
    if (!nextMode) return;

    if (this.activeMode) {
      this.activeMode.cleanup();
    }

    this.activeMode = nextMode;
    this.activeMode.start();

    // Broadcast mode selection to peer
    if (broadcast && this.context.networkManager.isConnected) {
      this.context.networkManager.sendPacket({
        type: 'MODE_SYNC',
        mode: modeId,
      } as unknown as any);
    }

    this.updateLobbyUISelection(modeId);
    this.updateHUD();
  }

  public update(delta: number): void {
    if (this.activeMode) {
      this.activeMode.update(delta);
      this.updateHUD();
    }
  }

  public onPlayerKill(killerName: string, victimName: string, isHeadshot: boolean, isLocalKiller: boolean): void {
    if (this.activeMode) {
      this.activeMode.onPlayerKill(killerName, victimName, isHeadshot, isLocalKiller);
      this.updateHUD();
    }
  }

  public onLocalPlayerDeath(): void {
    if (this.activeMode) {
      this.activeMode.onLocalPlayerDeath();
      this.updateHUD();
    }
  }

  public onRemotePeerDeath(peerId: string): void {
    if (this.activeMode) {
      this.activeMode.onRemotePeerDeath(peerId);
      this.updateHUD();
    }
  }

  private updateHUD(): void {
    if (!this.activeMode) return;
    const hudState = this.activeMode.getHUDState();

    const blueName = document.getElementById('score-blue-name');
    const blueVal = document.getElementById('score-blue-val');
    const redName = document.getElementById('score-red-name');
    const redVal = document.getElementById('score-red-val');
    const targetLabel = document.querySelector('.score-target');
    const roundLabel = document.getElementById('score-round-val');

    if (blueName) blueName.textContent = hudState.scoreLeftLabel;
    if (blueVal) blueVal.textContent = `${hudState.scoreLeftValue}`;
    if (redName) redName.textContent = hudState.scoreRightLabel;
    if (redVal) redVal.textContent = `${hudState.scoreRightValue}`;
    if (targetLabel) targetLabel.textContent = hudState.subHeader.toUpperCase();
    if (roundLabel) roundLabel.textContent = hudState.extraInfo || hudState.centerBadge;
  }

  public updateLobbyUISelection(modeId: GameModeType): void {
    const cards = document.querySelectorAll('.mode-card');
    cards.forEach((card) => {
      if (card.getAttribute('data-mode') === modeId) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }
}
