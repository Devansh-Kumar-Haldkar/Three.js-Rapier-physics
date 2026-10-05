import * as YUKA from 'yuka';
import * as THREE from 'three';
import { BotEntity } from './bot-entity';
import { threatManager } from './threat-manager';
import { gameState } from '../game-state';

// ==================== 1. PATROL STATE (ACTIVE SWEEPING & THREAT SCANNING) ====================
export class PatrolState extends YUKA.State<BotEntity> {
  private waitTimer = 0;
  private sweepTimer = 0;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 4.8; // Controlled tactical patrol walk speed
    bot.isCrouching = false;
    bot.findPathToNextPatrolWaypoint();
    this.waitTimer = 0;
    this.sweepTimer = Math.random() * Math.PI * 2;
    bot.showStatusAlert('PATROL (ACTIVE SWEEP)');
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    // Do NOT transition to combat or run attack logic if game state is not PLAYING
    if (!gameState.isPlaying()) {
      // In MENU / LOBBY, bots just wander harmlessly
      if (bot.hasReachedCurrentPath()) {
        this.waitTimer += delta;
        if (this.waitTimer >= 3.0) {
          this.waitTimer = 0;
          bot.findPathToNextPatrolWaypoint();
        }
      }
      return;
    }

    // 1. Check if HP is below 25% and target is NOT low HP -> Seek Cover!
    if (bot.health < 25 && !bot.isTargetLowHP()) {
      bot.stateMachine.changeTo('FLEE');
      return;
    }

    // 2. Active Sweeping: Pan head & weapon left and right ±45° (±0.78 rad) while walking
    this.sweepTimer += delta * 2.2;
    const sweepOffset = Math.sin(this.sweepTimer) * 0.785; // ±45 degrees
    bot.applyPatrolSweep(sweepOffset);

    // 3. Scan for enemy target in 40m / 110-degree FOV Line of Sight
    const visibleEnemy = bot.getVisibleEnemy();
    if (visibleEnemy && visibleEnemy.distance <= 40.0) {
      // Call for Backup: Alert all allied bots within 20m to converge on player
      threatManager.callForBackup(bot, visibleEnemy.target, 20.0);

      if (bot.isTargetLowHP()) {
        bot.stateMachine.changeTo('RUSH_FLANK');
      } else {
        bot.stateMachine.changeTo('COMBAT');
      }
      return;
    }

    // 4. Waypoint Navigation
    if (bot.hasReachedCurrentPath()) {
      this.waitTimer += delta;
      if (this.waitTimer >= 2.0) {
        this.waitTimer = 0;
        bot.findPathToNextPatrolWaypoint();
      }
    }
  }

  public exit(bot: BotEntity): void {
    bot.resetPatrolSweep();
  }
}

// ==================== 2. INVESTIGATING STATE (HEARING & NOISE REACTION) ====================
export class InvestigatingState extends YUKA.State<BotEntity> {
  private investigateTimer = 0;
  private scanTimer = 0;
  private hasArrived = false;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 6.2; // Cautious rapid advance with weapon drawn
    bot.isCrouching = false;
    this.investigateTimer = 0;
    this.scanTimer = 0;
    this.hasArrived = false;

    // Face the noise vector immediately and set path toward it
    if (bot.investigatePosition) {
      bot.setPathToTarget(new YUKA.Vector3(bot.investigatePosition.x, bot.investigatePosition.y, bot.investigatePosition.z));
      bot.smoothAimAt(bot.investigatePosition, 0.05);
    }
    bot.showStatusAlert('🔍 INVESTIGATING NOISE');
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    if (!gameState.isPlaying()) {
      bot.stateMachine.changeTo('PATROL');
      return;
    }

    // 1. Priority Scan for enemy target while investigating
    const visibleEnemy = bot.getVisibleEnemy();
    if (visibleEnemy && visibleEnemy.distance <= 40.0) {
      // Call for Backup!
      threatManager.callForBackup(bot, visibleEnemy.target, 20.0);

      if (bot.isTargetLowHP()) {
        bot.stateMachine.changeTo('RUSH_FLANK');
      } else {
        bot.stateMachine.changeTo('COMBAT');
      }
      return;
    }

    // 2. Health check
    if (bot.health < 25 && !bot.isTargetLowHP()) {
      bot.stateMachine.changeTo('FLEE');
      return;
    }

    // 3. Navigation to Noise Origin
    if (!this.hasArrived) {
      if (bot.investigatePosition) {
        bot.smoothAimAt(bot.investigatePosition, delta);
      }
      if (bot.hasReachedCurrentPath()) {
        this.hasArrived = true;
        bot.clearPath();
        bot.showStatusAlert('👁️ SCANNING AREA');
      }
    } else {
      // 4. Once at noise location, sweep and scan for 3.5 seconds
      this.scanTimer += delta;
      const sweepAngle = Math.sin(this.scanTimer * 3.0) * 1.0;
      bot.applyPatrolSweep(sweepAngle);

      if (this.scanTimer >= 3.5) {
        // No threat detected, resume normal patrol route
        bot.investigatePosition = null;
        bot.stateMachine.changeTo('PATROL');
      }
    }

    // Failsafe timeout for investigating
    this.investigateTimer += delta;
    if (this.investigateTimer > 10.0) {
      bot.investigatePosition = null;
      bot.stateMachine.changeTo('PATROL');
    }
  }

  public exit(bot: BotEntity): void {
    bot.resetPatrolSweep();
  }
}

// ==================== 3. COMBAT STATE (AGGRESSIVE BURST ATTACK & STRAFE) ====================
export class CombatState extends YUKA.State<BotEntity> {
  private strafeTimer = 0;
  private strafeSwitchInterval = 2.0;
  private strafeDir = 1;

  private crouchTimer = 0;
  private crouchInterval = 3.0;
  private crouchDurationTimer = 0;
  private isCurrentlyCrouching = false;
  private backupCallTimer = 0;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 4.5;
    bot.clearPath(); // Stop roaming immediately
    this.strafeTimer = 0;
    this.strafeSwitchInterval = 1.5 + Math.random() * 1.5;
    this.crouchTimer = 0;
    this.crouchInterval = 2.0 + Math.random() * 2.0;
    this.isCurrentlyCrouching = false;
    this.backupCallTimer = 0;
    bot.burstShotsFired = 0;
    bot.burstPauseTimer = 0;
    bot.shotTimer = bot.SHOT_INTERVAL; // Ready to fire first shot instantly
    bot.showStatusAlert('COMBAT ENGAGED');

    // Call for nearby squad backup immediately
    const enemy = bot.getVisibleEnemy();
    if (enemy) {
      threatManager.callForBackup(bot, enemy.target, 20.0);
    }
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    if (!gameState.isPlaying()) {
      bot.stateMachine.changeTo('PATROL');
      return;
    }

    // 1. Offensive Pressure: If target is below 40 HP, RUSH instead of fleeing!
    if (bot.isTargetLowHP()) {
      bot.stateMachine.changeTo('RUSH_FLANK');
      return;
    }

    // 2. Critical Health -> Flee only if target is healthy (> 40 HP)
    if (bot.health < 25) {
      bot.stateMachine.changeTo('FLEE');
      return;
    }

    // 3. Check Line of Sight within 40 meters
    const visibleEnemy = bot.getVisibleEnemy();
    if (!visibleEnemy || visibleEnemy.distance > 40.0) {
      // Target broke line of sight or moved out of range -> Pursue!
      bot.stateMachine.changeTo('PURSUE');
      return;
    }

    // Periodic squad backup beacon every 4.0s
    this.backupCallTimer += delta;
    if (this.backupCallTimer >= 4.0) {
      this.backupCallTimer = 0;
      threatManager.callForBackup(bot, visibleEnemy.target, 20.0);
    }

    // 4. Lock bot rotation directly toward enemy position
    bot.lockAimAt(visibleEnemy.target);

    // 5. Evasive Combat Circle-Strafing
    this.strafeTimer += delta;
    if (this.strafeTimer >= this.strafeSwitchInterval) {
      this.strafeTimer = 0;
      this.strafeDir *= -1;
      this.strafeSwitchInterval = 1.5 + Math.random() * 1.5;
    }
    bot.combatCircleStrafe(this.strafeDir, visibleEnemy.distance);

    // 6. Random Evasive Crouch (Ducks every 2-4s for 0.6-1.2s)
    if (!this.isCurrentlyCrouching) {
      this.crouchTimer += delta;
      if (this.crouchTimer >= this.crouchInterval) {
        this.crouchTimer = 0;
        this.isCurrentlyCrouching = true;
        this.crouchDurationTimer = 0.6 + Math.random() * 0.6;
        bot.setCrouch(true);
      }
    } else {
      this.crouchDurationTimer -= delta;
      if (this.crouchDurationTimer <= 0) {
        this.isCurrentlyCrouching = false;
        bot.setCrouch(false);
        this.crouchInterval = 2.0 + Math.random() * 2.0;
      }
    }

    // 7. Weapon Burst Cadence: 3 rounds every 0.3s, 600ms pause, 15 damage
    bot.updateBurstFiring(delta, visibleEnemy.target);
  }

  public exit(bot: BotEntity): void {
    bot.setCrouch(false);
  }
}

// Backward-compatible alias
export const AttackState = CombatState;

// ==================== 4. RUSH / FLANK STATE (OFFENSIVE PRESSURE) ====================
export class RushFlankState extends YUKA.State<BotEntity> {
  private repathTimer = 0;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 9.8; // Maximum assault rush speed
    bot.setCrouch(false);
    this.repathTimer = 0;
    bot.findPathToTarget();
    bot.showStatusAlert('🔥 RUSH/FLANK (TARGET <40HP)');
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    if (!gameState.isPlaying()) {
      bot.stateMachine.changeTo('PATROL');
      return;
    }

    const visibleEnemy = bot.getVisibleEnemy();

    if (visibleEnemy) {
      bot.smoothAimAt(visibleEnemy.target, delta);

      // In close range (< 14m), fire continuous rapid assault bursts
      if (visibleEnemy.distance <= 14.0) {
        bot.combatCircleStrafe(Math.random() < 0.5 ? 1 : -1, visibleEnemy.distance);
        bot.updateBurstFiring(delta, visibleEnemy.target);
      }
    }

    // Repath aggressively toward target position
    this.repathTimer += delta;
    if (this.repathTimer >= 0.4) {
      this.repathTimer = 0;
      bot.findPathToTarget();
    }

    // If target is no longer low HP (or eliminated), return to combat/patrol
    if (!bot.isTargetLowHP()) {
      if (visibleEnemy && visibleEnemy.distance <= bot.attackRange) {
        bot.stateMachine.changeTo('COMBAT');
      } else {
        bot.stateMachine.changeTo('PURSUE');
      }
    }
  }

  public exit(_bot: BotEntity): void {}
}

// ==================== 5. PURSUE STATE ====================
export class PursueState extends YUKA.State<BotEntity> {
  private repathTimer = 0;
  private targetLostTimer = 0;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 8.5; // Pursuit sprint speed
    bot.setCrouch(false);
    this.repathTimer = 0;
    this.targetLostTimer = 0;
    bot.findPathToTarget();
    bot.showStatusAlert('PURSUE');
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    if (!gameState.isPlaying()) {
      bot.stateMachine.changeTo('PATROL');
      return;
    }

    // 1. Offensive Pressure: Target low HP -> Rush!
    if (bot.isTargetLowHP()) {
      bot.stateMachine.changeTo('RUSH_FLANK');
      return;
    }

    // 2. Health check -> Flee if critically low
    if (bot.health < 25) {
      bot.stateMachine.changeTo('FLEE');
      return;
    }

    const visibleEnemy = bot.getVisibleEnemy();

    // 3. If within combat range and line of sight is clear -> Enter CombatState!
    if (visibleEnemy && visibleEnemy.distance <= 40.0) {
      threatManager.callForBackup(bot, visibleEnemy.target, 20.0);
      bot.stateMachine.changeTo('COMBAT');
      return;
    }

    // 4. Track lost target timeout
    if (!visibleEnemy) {
      this.targetLostTimer += delta;
      if (this.targetLostTimer > 6.0) {
        bot.stateMachine.changeTo('PATROL');
        return;
      }
    } else {
      this.targetLostTimer = 0;
      bot.smoothAimAt(visibleEnemy.target, delta);
    }

    // 5. Continually update pathfinding to advance toward target position
    this.repathTimer += delta;
    if (this.repathTimer >= 0.5) {
      this.repathTimer = 0;
      bot.findPathToTarget();
    }
  }

  public exit(_bot: BotEntity): void {}
}

// ==================== 6. FLEE STATE ====================
export class FleeState extends YUKA.State<BotEntity> {
  private healTimer = 0;
  private hasReachedCover = false;

  public enter(bot: BotEntity): void {
    bot.maxSpeed = 10.5; // Emergency sprint to cover
    bot.setCrouch(false);
    this.healTimer = 0;
    this.hasReachedCover = false;
    bot.findPathToCover();
    bot.showStatusAlert('⚠️ FLEEING TO COVER');
  }

  public execute(bot: BotEntity): void {
    const delta = bot.currentDelta || 0.016;

    if (!gameState.isPlaying()) {
      bot.stateMachine.changeTo('PATROL');
      return;
    }

    // If target becomes low HP while fleeing, immediately turn and RUSH!
    if (bot.isTargetLowHP()) {
      bot.stateMachine.changeTo('RUSH_FLANK');
      return;
    }

    if (!this.hasReachedCover) {
      if (bot.hasReachedCurrentPath()) {
        this.hasReachedCover = true;
        bot.clearPath();
      }
    } else {
      // In Cover: Regenerate Health / Armor repair
      this.healTimer += delta;
      if (this.healTimer >= 3.0) {
        bot.health = Math.min(100, bot.health + 45);
        bot.updateHealthHUD();
        bot.showStatusAlert('🛡️ HEALED & REARMED');
        bot.stateMachine.changeTo('PATROL');
      }
    }
  }

  public exit(_bot: BotEntity): void {}
}
