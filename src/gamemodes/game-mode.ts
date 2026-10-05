import { GameModeType, GameModeContext, GameModeHUDState } from './types';

export abstract class BaseGameMode {
  public abstract readonly id: GameModeType;
  public abstract readonly title: string;
  public abstract readonly description: string;
  public abstract readonly requiredPlayerCount: number;
  public abstract readonly teamSize?: number;
  public abstract readonly isTeamBased: boolean;

  protected context!: GameModeContext;
  protected isRunning = false;

  public init(context: GameModeContext): void {
    this.context = context;
  }

  public abstract start(): void;
  public abstract update(delta: number): void;
  public abstract onPlayerKill(killerName: string, victimName: string, isHeadshot: boolean, isLocalKiller: boolean): void;
  public abstract onLocalPlayerDeath(): void;
  public abstract onRemotePeerDeath(peerId: string): void;
  public abstract cleanup(): void;
  public abstract getHUDState(): GameModeHUDState;
}
