import * as THREE from 'three';

export interface TransformSnapshot {
  time: number;
  pos: [number, number, number];
  rotY: number;
  pitch: number;
  isShooting: boolean;
}

export interface InterpolatedTransform {
  pos: THREE.Vector3;
  quaternion: THREE.Quaternion;
  pitch: number;
  isShooting: boolean;
}

/**
 * SnapshotInterpolator
 * Buffers opponent transform packets and applies Cubic Hermite Spline (Catmull-Rom tangent)
 * interpolation for 3D position and rotation angles to eliminate jitter on fluctuating networks.
 */
export class SnapshotInterpolator {
  private buffer: TransformSnapshot[] = [];
  public interpolationDelay = 45; // 45ms buffer window
  private maxBufferSize = 40; // Maintain ~1.2s of history
  private targetEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  public pushSnapshot(snapshot: TransformSnapshot): void {
    // Ensure chronological order
    if (this.buffer.length > 0 && snapshot.time <= this.buffer[this.buffer.length - 1].time) {
      // Small adjustment if clocks or packet arrival timestamps match
      snapshot.time = this.buffer[this.buffer.length - 1].time + 0.5;
    }

    this.buffer.push(snapshot);

    // Limit buffer length
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  public getSnapshotCount(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }

  /**
   * Samples the interpolated transform state at the delayed render time (currentTime - 45ms)
   * using Cubic Hermite Spline interpolation.
   */
  public sample(now: number): InterpolatedTransform | null {
    if (this.buffer.length === 0) return null;

    const renderTime = now - this.interpolationDelay;

    // If only 1 snapshot or render time is before oldest snapshot
    if (this.buffer.length === 1 || renderTime <= this.buffer[0].time) {
      const snap = this.buffer[0];
      this.targetEuler.set(0, snap.rotY, 0);
      const quat = new THREE.Quaternion().setFromEuler(this.targetEuler);
      return {
        pos: new THREE.Vector3(snap.pos[0], snap.pos[1], snap.pos[2]),
        quaternion: quat,
        pitch: snap.pitch,
        isShooting: snap.isShooting,
      };
    }

    const lastIdx = this.buffer.length - 1;

    // If renderTime is ahead of newest snapshot (extrapolate up to 150ms)
    if (renderTime >= this.buffer[lastIdx].time) {
      const p1 = this.buffer[lastIdx - 1];
      const p2 = this.buffer[lastIdx];
      const dt = Math.max(1, p2.time - p1.time);
      const overdue = Math.min(150, renderTime - p2.time);
      const factor = overdue / dt;

      // Linear extrapolation with dampening
      const extX = p2.pos[0] + (p2.pos[0] - p1.pos[0]) * factor * 0.8;
      const extY = p2.pos[1] + (p2.pos[1] - p1.pos[1]) * factor * 0.8;
      const extZ = p2.pos[2] + (p2.pos[2] - p1.pos[2]) * factor * 0.8;

      const angleDiff = this.shortestAngleDiff(p2.rotY, p1.rotY);
      const extRotY = p2.rotY + angleDiff * factor * 0.8;
      const extPitch = p2.pitch + (p2.pitch - p1.pitch) * factor * 0.8;

      this.targetEuler.set(0, extRotY, 0);
      const quat = new THREE.Quaternion().setFromEuler(this.targetEuler);

      return {
        pos: new THREE.Vector3(extX, extY, extZ),
        quaternion: quat,
        pitch: extPitch,
        isShooting: p2.isShooting,
      };
    }

    // Find bounding snapshots [i, i+1] where buffer[i].time <= renderTime <= buffer[i+1].time
    let i = 0;
    for (let k = 0; k < this.buffer.length - 1; k++) {
      if (this.buffer[k].time <= renderTime && renderTime <= this.buffer[k + 1].time) {
        i = k;
        break;
      }
    }

    const p0 = i > 0 ? this.buffer[i - 1] : this.buffer[i];
    const p1 = this.buffer[i];
    const p2 = this.buffer[i + 1];
    const p3 = i + 2 < this.buffer.length ? this.buffer[i + 2] : p2;

    const span = Math.max(1, p2.time - p1.time);
    const u = Math.min(1.0, Math.max(0.0, (renderTime - p1.time) / span));

    // Hermite Basis Functions
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;

    // Calculate Catmull-Rom / Finite Difference tangents scaled to segment duration
    const dt02 = Math.max(1, p2.time - p0.time);
    const dt13 = Math.max(1, p3.time - p1.time);

    // Tangents for position
    const m1x = ((p2.pos[0] - p0.pos[0]) / dt02) * span;
    const m1y = ((p2.pos[1] - p0.pos[1]) / dt02) * span;
    const m1z = ((p2.pos[0] - p0.pos[0]) / dt02) * span;

    const m2x = ((p3.pos[0] - p1.pos[0]) / dt13) * span;
    const m2y = ((p3.pos[1] - p1.pos[1]) / dt13) * span;
    const m2z = ((p3.pos[2] - p1.pos[2]) / dt13) * span;

    // Cubic Hermite Spline evaluation for position
    const posX = h00 * p1.pos[0] + h10 * m1x + h01 * p2.pos[0] + h11 * m2x;
    const posY = h00 * p1.pos[1] + h10 * m1y + h01 * p2.pos[1] + h11 * m2y;
    const posZ = h00 * p1.pos[2] + h10 * m1z + h01 * p2.pos[2] + h11 * m2z;

    // Continuous Hermite angle interpolation for Yaw (rotY)
    const y0 = p1.rotY - this.shortestAngleDiff(p1.rotY, p0.rotY);
    const y1 = p1.rotY;
    const y2 = p1.rotY + this.shortestAngleDiff(p2.rotY, p1.rotY);
    const y3 = y2 + this.shortestAngleDiff(p3.rotY, p2.rotY);

    const m1Rot = ((y2 - y0) / dt02) * span;
    const m2Rot = ((y3 - y1) / dt13) * span;
    const rotY = h00 * y1 + h10 * m1Rot + h01 * y2 + h11 * m2Rot;

    // Hermite angle interpolation for Pitch
    const m1Pitch = ((p2.pitch - p0.pitch) / dt02) * span;
    const m2Pitch = ((p3.pitch - p1.pitch) / dt13) * span;
    const pitch = h00 * p1.pitch + h10 * m1Pitch + h01 * p2.pitch + h11 * m2Pitch;

    this.targetEuler.set(0, rotY, 0);
    const quat = new THREE.Quaternion().setFromEuler(this.targetEuler);

    return {
      pos: new THREE.Vector3(posX, posY, posZ),
      quaternion: quat,
      pitch,
      isShooting: u > 0.5 ? p2.isShooting : p1.isShooting,
    };
  }

  private shortestAngleDiff(target: number, source: number): number {
    let diff = (target - source) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  }
}
