import * as THREE from 'three';
import * as YUKA from 'yuka';
import { RAPIER, physics } from '../physics';
import { BaseGameMap, MapId, MapMetadata, MapSpawnPoints, MAP_METADATA } from './types';
import { parseNavMeshFromGeometry } from '../ai/navmesh-helper';

export class NeonCityMap implements BaseGameMap {
  public id: MapId = 'neon';
  public metadata: MapMetadata = MAP_METADATA.neon;
  public sceneGroup: THREE.Group;
  public navMesh: YUKA.NavMesh;
  public spawns: MapSpawnPoints;
  public colliders: RAPIER.Collider[] = [];
  public rigidBodies: RAPIER.RigidBody[] = [];
  public lights: THREE.Light[] = [];

  private scene: THREE.Scene;
  private roadTexture!: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sceneGroup = new THREE.Group();
    this.navMesh = new YUKA.NavMesh();

    this.spawns = {
      playerSpawn: new THREE.Vector3(0, 1.5, 20),
      botSpawns: [
        new THREE.Vector3(-16, 0.05, -16),
        new THREE.Vector3(16, 0.05, -16),
        new THREE.Vector3(0, 0.05, -24),
        new THREE.Vector3(-18, 0.05, 12),
        new THREE.Vector3(18, 0.05, 12),
        new THREE.Vector3(-12, 6.05, -12), // Rooftop sniper spawn
        new THREE.Vector3(12, 6.05, 12), // Rooftop sniper spawn
      ],
      lootSpawns: [
        { type: 'health', pos: new THREE.Vector3(-14, 0.05, 0), name: 'CYBER-MEDKIT (+50 HP)' },
        { type: 'health', pos: new THREE.Vector3(14, 0.05, 0), name: 'CYBER-MEDKIT (+50 HP)' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, 16), name: 'CYBER-AMMO CRATE' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, -16), name: 'CYBER-AMMO CRATE' },
        { type: 'weapon', weaponType: 'sniper', pos: new THREE.Vector3(-14, 6.05, -14), name: 'AWP-50 VOID SNIPER' }, // Rooftop loot
        { type: 'weapon', weaponType: 'shotgun', pos: new THREE.Vector3(-8, 0.05, -8), name: 'SPAS-12 STRIKER' },
        { type: 'weapon', weaponType: 'rpg', pos: new THREE.Vector3(14, 6.05, 14), name: 'TITAN-RPG HEAVY' }, // Rooftop loot
      ],
      patrolWaypoints: [
        new YUKA.Vector3(-14, 0.05, -14),
        new YUKA.Vector3(14, 0.05, -14),
        new YUKA.Vector3(0, 0.05, 0),
        new YUKA.Vector3(-14, 6.05, -14), // Rooftop patrol point
        new YUKA.Vector3(14, 6.05, 14), // Rooftop patrol point
        new YUKA.Vector3(14, 0.05, 14),
        new YUKA.Vector3(-14, 0.05, 14),
      ],
      coverWaypoints: [
        new YUKA.Vector3(-18, 0.05, -18),
        new YUKA.Vector3(18, 0.05, -18),
        new YUKA.Vector3(-18, 0.05, 18),
        new YUKA.Vector3(18, 0.05, 18),
        new YUKA.Vector3(0, 0.05, -28),
      ],
    };

    this.createRoadTexture();
  }

  private createRoadTexture(): void {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, size, size);

    // Neon road grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
    ctx.lineWidth = 2;
    const step = size / 8;
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    this.roadTexture = new THREE.CanvasTexture(canvas);
    this.roadTexture.wrapS = THREE.RepeatWrapping;
    this.roadTexture.wrapT = THREE.RepeatWrapping;
    this.roadTexture.repeat.set(20, 20);
  }

  public build(): void {
    // 1. Atmosphere, Cyber Night Sky & Neon Lighting
    this.setupAtmosphere();

    // 2. Asphalt Street Ground
    this.createStreetGround(120, 120);

    // 3. Multi-Story Urban Buildings with Rooftops
    this.createUrbanBuildings();

    // 4. Walkable Exterior Staircases & Rooftop Ramps
    this.createWalkableStaircases();

    // 5. Concrete Barricades & Roadblocks
    this.createConcreteObstacles();

    // 6. Glowing Neon Billboards & Street Lamps
    this.createNeonSigns();

    // 7. Generate NavMesh
    this.buildNavMesh();

    this.scene.add(this.sceneGroup);
  }

  private setupAtmosphere(): void {
    this.scene.fog = new THREE.Fog(this.metadata.fogColor, 15, 100);
    this.scene.background = new THREE.Color(this.metadata.skyColor);

    // Cyber Moon/Neon Key Light
    const dirLight = new THREE.DirectionalLight(0x00e5ff, 1.8);
    dirLight.position.set(-30, 50, 25);
    dirLight.castShadow = true;
    this.scene.add(dirLight);
    this.lights.push(dirLight);

    // Dark Night Ambient
    const ambLight = new THREE.AmbientLight(0x18103c, 1.0);
    this.scene.add(ambLight);
    this.lights.push(ambLight);
  }

  private createStreetGround(width: number, depth: number): void {
    const geo = new THREE.PlaneGeometry(width, depth);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      roughness: 0.4,
      metalness: 0.8,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.sceneGroup.add(mesh);

    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2), body);
    this.rigidBodies.push(body);
    this.colliders.push(col);
  }

  private createUrbanBuildings(): void {
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.9 });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const buildings = [
      // 2-Story Building 1 (NW) - Height 6.0m
      { pos: [-14, 3.0, -14], size: [12, 6.0, 12] },
      // 2-Story Building 2 (SE) - Height 6.0m
      { pos: [14, 3.0, 14], size: [12, 6.0, 12] },
      // 1-Story Commercial Building (NE) - Height 3.6m
      { pos: [14, 1.8, -14], size: [10, 3.6, 10] },
      // 1-Story Commercial Building (SW) - Height 3.6m
      { pos: [-14, 1.8, 14], size: [10, 3.6, 10] },
    ];

    for (const b of buildings) {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.pos[0], b.pos[1], b.pos[2]);

      // Main Block
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mesh = new THREE.Mesh(geo, buildingMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bGroup.add(mesh);

      // Rooftop Safety Railing
      const railGeo = new THREE.BoxGeometry(b.size[0], 0.8, 0.2);
      const railN = new THREE.Mesh(railGeo, trimMat);
      railN.position.set(0, b.size[1] / 2 + 0.4, -b.size[2] / 2);
      bGroup.add(railN);

      // Glowing Window Grids
      for (let f = -b.size[1] / 2 + 1.2; f < b.size[1] / 2; f += 2.2) {
        const winGeo = new THREE.BoxGeometry(b.size[0] + 0.05, 0.6, 1.2);
        const win = new THREE.Mesh(winGeo, windowMat);
        win.position.set(0, f, 0);
        bGroup.add(win);
      }

      this.sceneGroup.add(bGroup);

      // Rapier RigidBody
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.pos[0], b.pos[1], b.pos[2]));
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2), body);
      this.rigidBodies.push(body);
      this.colliders.push(col);
    }
  }

  private createWalkableStaircases(): void {
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 });

    // Staircase 1: Leads to NW 2-Story Rooftop (Height 6.0m)
    const stairLength = 12.0;
    const stairHeight = 6.0;
    const rampGeo = new THREE.BoxGeometry(3.0, 0.3, stairLength);
    const ramp1 = new THREE.Mesh(rampGeo, metalMat);
    ramp1.position.set(-14, 3.0, -3.5);
    ramp1.rotation.x = Math.atan2(stairHeight, stairLength);
    ramp1.castShadow = true;
    ramp1.receiveShadow = true;
    this.sceneGroup.add(ramp1);

    const ramp1Body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(-14, 3.0, -3.5)
        .setRotation({
          x: Math.sin(Math.atan2(stairHeight, stairLength) / 2),
          y: 0,
          z: 0,
          w: Math.cos(Math.atan2(stairHeight, stairLength) / 2),
        })
    );
    const ramp1Col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.15, stairLength / 2), ramp1Body);
    this.rigidBodies.push(ramp1Body);
    this.colliders.push(ramp1Col);

    // Staircase 2: Leads to SE 2-Story Rooftop (Height 6.0m)
    const ramp2 = new THREE.Mesh(rampGeo, metalMat);
    ramp2.position.set(14, 3.0, 3.5);
    ramp2.rotation.x = -Math.atan2(stairHeight, stairLength);
    ramp2.castShadow = true;
    ramp2.receiveShadow = true;
    this.sceneGroup.add(ramp2);

    const ramp2Body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(14, 3.0, 3.5)
        .setRotation({
          x: -Math.sin(Math.atan2(stairHeight, stairLength) / 2),
          y: 0,
          z: 0,
          w: Math.cos(Math.atan2(stairHeight, stairLength) / 2),
        })
    );
    const ramp2Col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.15, stairLength / 2), ramp2Body);
    this.rigidBodies.push(ramp2Body);
    this.colliders.push(ramp2Col);
  }

  private createConcreteObstacles(): void {
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });

    const barriers = [
      { pos: [0, 0.6, 6], size: [6.0, 1.2, 0.8], rot: 0 },
      { pos: [0, 0.6, -6], size: [6.0, 1.2, 0.8], rot: 0 },
      { pos: [-6, 0.6, 0], size: [0.8, 1.2, 6.0], rot: 0 },
      { pos: [6, 0.6, 0], size: [0.8, 1.2, 6.0], rot: 0 },
      { pos: [-22, 0.6, -22], size: [5.0, 1.2, 0.8], rot: 0.4 },
      { pos: [22, 0.6, -22], size: [5.0, 1.2, 0.8], rot: -0.4 },
    ];

    for (const b of barriers) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mesh = new THREE.Mesh(geo, concreteMat);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.rotation.y = b.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.sceneGroup.add(mesh);

      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(b.pos[0], b.pos[1], b.pos[2])
          .setRotation({ x: 0, y: Math.sin(b.rot / 2), z: 0, w: Math.cos(b.rot / 2) })
      );
      const col = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2),
        body
      );
      this.rigidBodies.push(body);
      this.colliders.push(col);
    }
  }

  private createNeonSigns(): void {
    const signs = [
      { pos: [-14, 7.5, -8], size: [6.0, 1.8], color: 0xff0077, text: 'CYBER-CORP' },
      { pos: [14, 7.5, 8], size: [6.0, 1.8], color: 0x00f0ff, text: 'PULSE-X' },
      { pos: [14, 4.8, -9], size: [5.0, 1.5], color: 0xa855f7, text: 'VOID LABS' },
      { pos: [-14, 4.8, 9], size: [5.0, 1.5], color: 0xf59e0b, text: 'SYNTH-BAR' },
    ];

    for (const s of signs) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = `#${s.color.toString(16).padStart(6, '0')}`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 252, 60);

      ctx.fillStyle = `#${s.color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, 128, 32);

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });

      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[1]), mat);
      signMesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      this.sceneGroup.add(signMesh);

      const pointLight = new THREE.PointLight(s.color, 3.5, 12.0);
      pointLight.position.set(s.pos[0], s.pos[1], s.pos[2] + 0.5);
      this.sceneGroup.add(pointLight);
    }
  }

  private buildNavMesh(): void {
    const navGeo = new THREE.PlaneGeometry(100, 100, 16, 16);
    navGeo.rotateX(-Math.PI / 2);
    this.navMesh = parseNavMeshFromGeometry(navGeo);
  }

  public update(_delta: number): void {}

  public destroy(): void {
    this.scene.remove(this.sceneGroup);

    for (const col of this.colliders) {
      try { physics.world.removeCollider(col, false); } catch {}
    }
    for (const body of this.rigidBodies) {
      try { physics.world.removeRigidBody(body); } catch {}
    }
    for (const light of this.lights) {
      this.scene.remove(light);
    }

    this.colliders = [];
    this.rigidBodies = [];
    this.lights = [];
  }
}
