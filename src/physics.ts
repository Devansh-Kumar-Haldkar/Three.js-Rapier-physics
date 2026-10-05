import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface PhysicsSyncItem {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
}

export class PhysicsSystem {
  public world!: RAPIER.World;
  public syncList: PhysicsSyncItem[] = [];
  public initialized = false;

  async init(): Promise<void> {
    await RAPIER.init();
    // Use an authentic FPS snappy gravity
    const gravity = { x: 0.0, y: -24.0, z: 0.0 };
    this.world = new RAPIER.World(gravity);
    this.initialized = true;
  }

  step(delta: number): void {
    if (!this.initialized) return;

    // Use fixed timestep or delta with sub-stepping for numerical stability
    const maxSubSteps = 3;
    const fixedTimeStep = 1 / 60;
    
    // Clamp delta to avoid physics explosion during lag spikes
    const clampedDelta = Math.min(delta, 0.1);
    this.world.timestep = fixedTimeStep;

    const subSteps = Math.min(Math.max(1, Math.round(clampedDelta / fixedTimeStep)), maxSubSteps);
    for (let i = 0; i < subSteps; i++) {
      this.world.step();
    }

    // Sync dynamic physics bodies to Three.js meshes
    for (let i = 0; i < this.syncList.length; i++) {
      const { mesh, body } = this.syncList[i];
      if (body.isDynamic()) {
        const translation = body.translation();
        const rotation = body.rotation();
        mesh.position.set(translation.x, translation.y, translation.z);
        mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      }
    }
  }

  registerSync(mesh: THREE.Object3D, body: RAPIER.RigidBody): void {
    this.syncList.push({ mesh, body });
  }

  unregisterSync(body: RAPIER.RigidBody): void {
    this.syncList = this.syncList.filter((item) => item.body !== body);
  }
}

export const physics = new PhysicsSystem();
export { RAPIER };
