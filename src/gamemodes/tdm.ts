import { BaseGameMode } from './game-mode';
import { GameModeType, GameModeHUDState } from './types';

export class TeamDeathmatchMode extends BaseGameMode {
  public readonly id: GameModeType = 'tdm';
  public readonly title = 'TEAM DEATHMATCH';
  public readonly description = '4v4 Tactical Skirmish • Fast Respawns • 50-Kill Target Limit';
  public readonly requiredPlayerCount = 8;
  public readonly teamSize = 4;
  public readonly isTeamBased = true;

  public blueScore = 0;
  public redScore = 0;
  public targetKills = 50;
  public matchFinished = false;

  public start(): void {
    this.blueScore = 0;
    this.redScore = 0;
    this.matchFinished = false;
    this.isRunning = true;
    this.context.networkManager.showRoundBanner('TEAM DEATHMATCH — FIRST TO 50 KILLS!');
  }

  public update(_delta: number): void {
    if (!this.isRunning || this.matchFinished) return;
  }

  public onPlayerKill(killerName: string, _victimName: string, isHeadshot: boolean, isLocalKiller: boolean): void {
    if (this.matchFinished) return;

    if (isLocalKiller) {
      if (this.context.networkManager.isHost) {
        this.blueScore++;
      } else {
        this.redScore++;
      }
    } else {
      if (this.context.networkManager.isHost) {
        this.redScore++;
      } else {
        this.blueScore++;
      }
    }

    // Check Win Condition (50 kills)
    if (this.blueScore >= this.targetKills || this.redScore >= this.targetKills) {
      this.matchFinished = true;
      const blueWon = this.blueScore >= this.targetKills;
      const isLocalWinner = (this.context.networkManager.isHost && blueWon) || (!this.context.networkManager.isHost && !blueWon);
      
      this.context.networkManager.showRoundBanner(
        isLocalWinner ? '🏆 VICTORY! 50 KILLS REACHED!' : '💀 DEFEAT! OPPONENT REACHED 50 KILLS'
      );

      setTimeout(() => {
        this.start();
      }, 5000);
    }
  }

  public onLocalPlayerDeath(): void {
    // 3-second rapid respawn
  }

  public onRemotePeerDeath(_peerId: string): void {
    // Remote peer respawns after countdown
  }

  public cleanup(): void {
    this.isRunning = false;
    this.matchFinished = false;
  }

  public getHUDState(): GameModeHUDState {
    return {
      title: 'TEAM DEATHMATCH',
      subHeader: 'TARGET: 50 KILLS',
      scoreLeftLabel: 'BLUE TEAM',
      scoreLeftValue: this.blueScore,
      scoreRightLabel: 'RED TEAM',
      scoreRightValue: this.redScore,
      centerBadge: `${this.targetKills} KILLS`,
      extraInfo: '4v4 • RESPAWNS ACTIVE',
    };
  }
}
