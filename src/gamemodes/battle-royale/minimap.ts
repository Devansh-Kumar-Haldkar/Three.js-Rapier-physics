import * as THREE from 'three';
import { FPSController } from '../../fps-controller';
import { CargoPlane } from './cargo-plane';
import { SkydiveController } from './skydive-controller';
import type { BotManager } from '../../ai/bot-manager';
import type { WorldLootManager } from '../../world-loot/loot-manager';

export class BRMinimap {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private container!: HTMLElement;

  private controller: FPSController;
  private cargoPlane?: CargoPlane;
  private skydiveController?: SkydiveController;
  private botManager?: BotManager;
  private lootManager?: WorldLootManager;

  // Radar Constants
  private radarRadius = 85;
  private worldMapScale = 1.4; // 1 meter = 1.4 pixels on radar

  constructor(
    controller: FPSController,
    cargoPlane?: CargoPlane,
    skydiveController?: SkydiveController,
    botManager?: BotManager,
    lootManager?: WorldLootManager
  ) {
    this.controller = controller;
    this.cargoPlane = cargoPlane;
    this.skydiveController = skydiveController;
    this.botManager = botManager;
    this.lootManager = lootManager;

    this.initDOM();
  }

  private initDOM(): void {
    let existing = document.getElementById('br-minimap-container');
    if (existing) existing.remove();

    this.container = document.createElement('div');
    this.container.id = 'br-minimap-container';
    this.container.className = 'br-minimap-container';

    this.canvas = document.createElement('canvas');
    this.canvas.width = 200;
    this.canvas.height = 200;
    this.ctx = this.canvas.getContext('2d')!;

    this.container.appendChild(this.canvas);
    document.getElementById('hud')?.appendChild(this.container);
  }

  public update(
    zoneCenter: THREE.Vector2,
    currentRadius: number,
    targetRadius: number,
    phaseTimer: number,
    isShrinking: boolean
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    const playerPos = this.controller.camera.position;
    const playerYaw = this.controller.yaw;

    // 1. Circular Radar Mask & Cyber Frame
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, this.radarRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.clip();

    // Radar Grid Rings
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
    ctx.lineWidth = 1;
    [30, 55, 80].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Radar Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx, cy - this.radarRadius);
    ctx.lineTo(cx, cy + this.radarRadius);
    ctx.moveTo(cx - this.radarRadius, cy);
    ctx.lineTo(cx + this.radarRadius, cy);
    ctx.stroke();

    // Coordinate conversion helper (World to Radar local pixels)
    const worldToRadar = (wx: number, wz: number): { x: number; y: number } => {
      const dx = (wx - playerPos.x) * this.worldMapScale;
      const dz = (wz - playerPos.z) * this.worldMapScale;
      return { x: cx + dx, y: cy + dz };
    };

    // 2. Render Cargo Plane Flight Path (Dotted line)
    if (this.cargoPlane) {
      const pStart = worldToRadar(this.cargoPlane.startPos.x, this.cargoPlane.startPos.z);
      const pEnd = worldToRadar(this.cargoPlane.endPos.x, this.cargoPlane.endPos.z);
      const pPlane = worldToRadar(this.cargoPlane.currentPos.x, this.cargoPlane.currentPos.z);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Plane Icon
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(pPlane.x, pPlane.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Render World Loot Crates
    if (this.lootManager?.crates) {
      for (const crate of this.lootManager.crates) {
        if (!crate.isAvailable) continue;
        const pCrate = worldToRadar(crate.group.position.x, crate.group.position.z);
        ctx.fillStyle = crate.def.type === 'health' ? '#10b981' : crate.def.type === 'ammo' ? '#f59e0b' : '#a855f7';
        ctx.beginPath();
        ctx.arc(pCrate.x, pCrate.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Render Safe-Zone Rings
    const pZone = worldToRadar(zoneCenter.x, zoneCenter.y);

    // Shrinking Storm Ring (Purple)
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pZone.x, pZone.y, currentRadius * this.worldMapScale, 0, Math.PI * 2);
    ctx.stroke();

    // Next Target Circle (White Dotted)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(pZone.x, pZone.y, targetRadius * this.worldMapScale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 5. Render Enemy Bots
    if (this.botManager?.bots) {
      for (const bot of this.botManager.bots) {
        if (!bot.isDead) {
          const pBot = worldToRadar(bot.position.x, bot.position.z);
          ctx.fillStyle = '#ef4444'; // Red Dot
          ctx.beginPath();
          ctx.arc(pBot.x, pBot.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 6. Render Local Player Icon (Center Arrow)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-playerYaw);

    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Restore clip

    // Radar Outer Border
    ctx.strokeStyle = 'var(--accent-cyan, #00f0ff)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radarRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 7. Tactical Digital Header / Telemetry Text
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'center';

    if (this.skydiveController && this.skydiveController.state !== 'LANDED') {
      const alt = Math.round(this.skydiveController.position.y);
      const spd = Math.round(this.skydiveController.currentAirspeed);
      ctx.fillText(`ALT: ${alt}M • SPD: ${spd}M/S`, cx, 14);
    } else {
      const timerText = isShrinking ? 'SHRINKING' : `SAFE: ${Math.ceil(phaseTimer)}s`;
      ctx.fillText(timerText, cx, 14);
    }
  }

  public setVisible(visible: boolean): void {
    if (this.container) {
      this.container.style.display = visible ? 'block' : 'none';
    }
  }

  public destroy(): void {
    if (this.container) {
      this.container.remove();
    }
  }
}
