import * as THREE from 'three';
import { BaseGameMode } from './game-mode';
import { GameModeType, GameModeHUDState } from './types';

export class ClashSquadMode extends BaseGameMode {
  public readonly id: GameModeType = 'clash';
  public readonly title = 'CLASH SQUAD';
  public readonly description = 'Rounds to Win (First to 4) • 15s Pre-Round Freeze • No Mid-Round Respawns';
  public readonly requiredPlayerCount = 8;
  public readonly teamSize = 4;
  public readonly isTeamBased = true;

  public blueRoundsWon = 0;
  public redRoundsWon = 0;
  public targetRounds = 4;
  public currentRoundNumber = 1;

  // Phase State: 'FREEZE' | 'COMBAT' | 'ROUND_END' | 'MATCH_END'
  public phase: 'FREEZE' | 'COMBAT' | 'ROUND_END' | 'MATCH_END' = 'FREEZE';
  public freezeTimer = 15.0; // 15 seconds pre-round freeze
  private freezeBarrierMesh!: THREE.Mesh;

  public start(): void {
    this.blueRoundsWon = 0;
    this.redRoundsWon = 0;
    this.currentRoundNumber = 1;
    this.isRunning = true;
    this.createFreezeBarrier();
    this.startFreezePhase();
  }

  private createFreezeBarrier(): void {
    if (this.freezeBarrierMesh) {
      this.context.scene.remove(this.freezeBarrierMesh);
    }

    // Glowing cyan cyber barrier across the arena center during freeze phase
    const barrierGeo = new THREE.PlaneGeometry(80, 20);
    const barrierMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.freezeBarrierMesh = new THREE.Mesh(barrierGeo, barrierMat);
    this.freezeBarrierMesh.position.set(0, 10, 0);
    this.context.scene.add(this.freezeBarrierMesh);
    this.freezeBarrierMesh.visible = false;
  }

  public startFreezePhase(): void {
    this.phase = 'FREEZE';
    this.freezeTimer = 15.0; // 15 seconds pre-round freeze timer

    if (this.freezeBarrierMesh) {
      this.freezeBarrierMesh.visible = true;
    }

    // Reset player to opposing base spawns
    const hostSpawn = { pos: { x: 0, y: 1.5, z: -32 }, yaw: 0 };
    const guestSpawn = { pos: { x: 0, y: 1.5, z: 32 }, yaw: Math.PI };
    const mySpawn = this.context.networkManager.isHost ? hostSpawn : guestSpawn;

    this.context.networkManager.resetPlayerToSpawn(mySpawn.pos, mySpawn.yaw);
    this.context.controller.triggerRespawn();
    for (const peer of this.context.networkManager.peers.values()) {
      peer.triggerRespawn();
    }

    this.context.networkManager.showRoundBanner(`ROUND ${this.currentRoundNumber} — BUY & PREP PHASE`);
  }

  public update(delta: number): void {
    if (!this.isRunning) return;

    if (this.phase === 'FREEZE') {
      this.freezeTimer -= delta;

      // Lock player velocity during pre-round freeze
      if (this.context.controller?.body) {
        this.context.controller.body.setLinvel({ x: 0, y: this.context.controller.body.linvel().y, z: 0 }, true);
      }

      // Barrier pulsation
      if (this.freezeBarrierMesh) {
        const mat = this.freezeBarrierMesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.2 + Math.sin(performance.now() * 0.008) * 0.15;
      }

      if (this.freezeTimer <= 0) {
        this.phase = 'COMBAT';
        if (this.freezeBarrierMesh) {
          this.freezeBarrierMesh.visible = false;
        }
        this.context.networkManager.showRoundBanner(`ROUND ${this.currentRoundNumber} — FIGHT!`);
      }
    }
  }

  public onPlayerKill(_killerName: string, _victimName: string, _isHeadshot: boolean, isLocalKiller: boolean): void {
    if (this.phase !== 'COMBAT') return;

    // In Clash Squad: No mid-round respawns. Elimination ends the round!
    this.phase = 'ROUND_END';

    if (isLocalKiller) {
      if (this.context.networkManager.isHost) {
        this.blueRoundsWon++;
      } else {
        this.redRoundsWon++;
      }
    } else {
      if (this.context.networkManager.isHost) {
        this.redRoundsWon++;
      } else {
        this.blueRoundsWon++;
      }
    }

    const roundWinner = isLocalKiller ? 'YOU WON THE ROUND' : 'OPPONENT WON THE ROUND';
    this.context.networkManager.showRoundBanner(`ROUND ${this.currentRoundNumber} OVER — ${roundWinner}!`);

    // Check Match Win Condition (First to 4 rounds)
    if (this.blueRoundsWon >= this.targetRounds || this.redRoundsWon >= this.targetRounds) {
      this.phase = 'MATCH_END';
      const blueWon = this.blueRoundsWon >= this.targetRounds;
      const isLocalWinner = (this.context.networkManager.isHost && blueWon) || (!this.context.networkManager.isHost && !blueWon);

      setTimeout(() => {
        this.context.networkManager.showRoundBanner(
          isLocalWinner ? '🏆 MATCH VICTORY! 4 ROUNDS SECURED!' : '💀 MATCH DEFEAT! OPPONENT WON 4 ROUNDS'
        );
      }, 1500);

      setTimeout(() => {
        this.start();
      }, 6000);
      return;
    }

    // Schedule next round with 15s freeze timer after 3.5s review
    setTimeout(() => {
      this.currentRoundNumber++;
      this.startFreezePhase();
    }, 3500);
  }

  public onLocalPlayerDeath(): void {
    // No mid-round respawns in Clash Squad
  }

  public onRemotePeerDeath(_peerId: string): void {
    // No mid-round respawns in Clash Squad
  }

  public cleanup(): void {
    this.isRunning = false;
    if (this.freezeBarrierMesh) {
      this.context.scene.remove(this.freezeBarrierMesh);
    }
  }

  public getHUDState(): GameModeHUDState {
    const extra = this.phase === 'FREEZE' 
      ? `⏳ FREEZE TIMER: ${Math.ceil(this.freezeTimer)}s` 
      : `ROUND ${this.currentRoundNumber} • FIRST TO ${this.targetRounds}`;

    return {
      title: 'CLASH SQUAD',
      subHeader: `FIRST TO ${this.targetRounds} ROUNDS`,
      scoreLeftLabel: 'BLUE ROUNDS',
      scoreLeftValue: `${this.blueRoundsWon} / ${this.targetRounds}`,
      scoreRightLabel: 'RED ROUNDS',
      scoreRightValue: `${this.redRoundsWon} / ${this.targetRounds}`,
      centerBadge: this.phase === 'FREEZE' ? `PREP ${Math.ceil(this.freezeTimer)}s` : `RD ${this.currentRoundNumber}`,
      extraInfo: extra,
    };
  }
}
