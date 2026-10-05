import * as THREE from 'three';
import * as YUKA from 'yuka';
import { RAPIER, physics } from '../physics';
import { BaseGameMap, MapId, MapMetadata, MapSpawnPoints, MAP_METADATA } from './types';
import { parseNavMeshFromGeometry } from '../ai/navmesh-helper';

export class OvergrownJungleMap implements BaseGameMap {
  public id: MapId = 'jungle';
  public metadata: MapMetadata = MAP_METADATA.jungle;
  public sceneGroup: THREE.Group;
  public navMesh: YUKA.NavMesh;
  public spawns: MapSpawnPoints;
  public colliders: RAPIER.Collider[] = [];
  public rigidBodies: RAPIER.RigidBody[] = [];
  public lights: THREE.Light[] = [];

  private scene: THREE.Scene;
  private grassTexture!: THREE.CanvasTexture;
  private rainPoints!: THREE.Points;
  private rainPositions!: Float32Array;
  private rainCount = 1200;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sceneGroup = new THREE.Group();
    this.navMesh = new YUKA.NavMesh();

    this.spawns = {
      playerSpawn: new THREE.Vector3(0, 1.5, 22),
      botSpawns: [
        new THREE.Vector3(-18, 0.05, -16),
        new THREE.Vector3(18, 0.05, -16),
        new THREE.Vector3(0, 0.05, -26),
        new THREE.Vector3(-20, 0.05, 14),
        new THREE.Vector3(20, 0.05, 14),
        new THREE.Vector3(-12, 0.05, -2),
        new THREE.Vector3(12, 0.05, -2),
      ],
      lootSpawns: [
        { type: 'health', pos: new THREE.Vector3(-16, 0.05, 4), name: 'HERBAL-MEDKIT (+50 HP)' },
        { type: 'health', pos: new THREE.Vector3(16, 0.05, 4), name: 'HERBAL-MEDKIT (+50 HP)' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, 18), name: 'JUNGLE RESUPPLY CRATE' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, -18), name: 'JUNGLE RESUPPLY CRATE' },
        { type: 'weapon', weaponType: 'sniper', pos: new THREE.Vector3(0, 2.5, 0), name: 'AWP-50 VOID SNIPER' },
        { type: 'weapon', weaponType: 'shotgun', pos: new THREE.Vector3(-10, 0.05, -10), name: 'SPAS-12 STRIKER' },
        { type: 'weapon', weaponType: 'rpg', pos: new THREE.Vector3(10, 0.05, 10), name: 'TITAN-RPG HEAVY' },
      ],
      patrolWaypoints: [
        new YUKA.Vector3(-14, 0.05, -14),
        new YUKA.Vector3(14, 0.05, -14),
        new YUKA.Vector3(0, 2.5, 0),
        new YUKA.Vector3(14, 0.05, 14),
        new YUKA.Vector3(-14, 0.05, 14),
        new YUKA.Vector3(0, 0.05, 20),
        new YUKA.Vector3(0, 0.05, -20),
      ],
      coverWaypoints: [
        new YUKA.Vector3(-20, 0.05, -20),
        new YUKA.Vector3(20, 0.05, -20),
        new YUKA.Vector3(-20, 0.05, 20),
        new YUKA.Vector3(20, 0.05, 20),
      ],
    };

    this.createGrassTexture();
  }

  private createGrassTexture(): void {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1e3a1e';
    ctx.fillRect(0, 0, size, size);

    // Moss & grass blade noise
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const alpha = 0.08 + Math.random() * 0.15;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(74, 140, 50, ${alpha})` : `rgba(20, 60, 20, ${alpha})`;
      ctx.fillRect(x, y, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }

    this.grassTexture = new THREE.CanvasTexture(canvas);
    this.grassTexture.wrapS = THREE.RepeatWrapping;
    this.grassTexture.wrapT = THREE.RepeatWrapping;
    this.grassTexture.repeat.set(24, 24);
  }

  public build(): void {
    // 1. Atmosphere, Green Fog & Lighting
    this.setupAtmosphere();

    // 2. Rolling Grassy Terrain
    this.createRollingTerrain(120, 120);

    // 3. Dense Instanced Tree Trunks
    this.createDenseForest();

    // 4. Mossy Rocks & Boulders
    this.createMossyBoulders();

    // 5. Canopy Rain & Mist Particles
    this.createRainParticles();

    // 6. Generate NavMesh
    this.buildNavMesh();

    this.scene.add(this.sceneGroup);
  }

  private setupAtmosphere(): void {
    this.scene.fog = new THREE.Fog(this.metadata.fogColor, 12, 95);
    this.scene.background = new THREE.Color(this.metadata.skyColor);

    // Filtered Green Sunbeams
    const dirLight = new THREE.DirectionalLight(this.metadata.sunColor, 2.2);
    dirLight.position.set(30, 60, 20);
    dirLight.castShadow = true;
    this.scene.add(dirLight);
    this.lights.push(dirLight);

    // Deep Jungle Ambient
    const ambLight = new THREE.AmbientLight(0x2a5c36, 1.4);
    this.scene.add(ambLight);
    this.lights.push(ambLight);
  }

  private createRollingTerrain(width: number, depth: number): void {
    const segs = 64;
    const geo = new THREE.PlaneGeometry(width, depth, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Gentle rolling hill undulations
      const hill1 = Math.sin(vx * 0.08) * Math.cos(vz * 0.08) * 1.8;
      const hill2 = Math.sin(vx * 0.04 + vz * 0.04) * 1.2;
      // Central clearing
      const centerDist = Math.hypot(vx, vz);
      const centerDamp = Math.min(1.0, centerDist / 20.0);

      pos.setY(i, (hill1 + hill2) * centerDamp);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: this.grassTexture,
      roughness: 0.85,
      metalness: 0.1,
    });

    const terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = true;
    this.sceneGroup.add(terrainMesh);

    // Rapier Ground Body
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2);
    const col = physics.world.createCollider(colDesc, body);

    this.rigidBodies.push(body);
    this.colliders.push(col);
  }

  private createDenseForest(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d271d, roughness: 0.9 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.7 });

    const treeCoords = [
      { x: -14, z: 12 }, { x: -22, z: 8 }, { x: -18, z: -14 }, { x: -8, z: -22 },
      { x: 12, z: 16 }, { x: 22, z: 10 }, { x: 18, z: -12 }, { x: 8, z: -20 },
      { x: -24, z: -4 }, { x: 24, z: -6 }, { x: -6, z: 22 }, { x: 6, z: 24 },
      { x: -26, z: 22 }, { x: 26, z: 22 }, { x: -24, z: -24 }, { x: 24, z: -24 },
    ];

    for (const c of treeCoords) {
      const tree = new THREE.Group();
      tree.position.set(c.x, 0, c.z);

      // Heavy Ancient Tree Trunk
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 7.5, 8), trunkMat);
      trunk.position.set(0, 3.75, 0);
      trunk.castShadow = true;
      tree.add(trunk);

      // Massive Canopy Foliage
      const canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(3.6, 1), foliageMat);
      canopy.position.set(0, 7.8, 0);
      canopy.castShadow = true;
      tree.add(canopy);

      this.sceneGroup.add(tree);

      // Rapier Tree Trunk Collider
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, 3.75, c.z));
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3.75, 0.8), body);
      this.rigidBodies.push(body);
      this.colliders.push(col);
    }
  }

  private createMossyBoulders(): void {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 });
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });

    const rocks = [
      { pos: [-6, 1.2, 8], scale: [3.5, 2.4, 3.0], rot: 0.4 },
      { pos: [8, 1.0, 6], scale: [3.0, 2.0, 2.8], rot: -0.5 },
      { pos: [-8, 1.4, -8], scale: [4.0, 2.8, 3.5], rot: 0.8 },
      { pos: [6, 1.2, -10], scale: [3.2, 2.4, 2.8], rot: -0.3 },
      { pos: [0, 1.5, 0], scale: [5.0, 2.8, 4.5], rot: 0.1 }, // Central Ancient Rock
    ];

    for (const r of rocks) {
      const rockGroup = new THREE.Group();
      rockGroup.position.set(r.pos[0], r.pos[1], r.pos[2]);
      rockGroup.rotation.y = r.rot;

      const baseRock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 1), rockMat);
      baseRock.scale.set(r.scale[0], r.scale[1], r.scale[2]);
      baseRock.castShadow = true;
      baseRock.receiveShadow = true;
      rockGroup.add(baseRock);

      // Moss top layer
      const mossCap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 1), mossMat);
      mossCap.scale.set(r.scale[0] * 0.95, r.scale[1] * 0.4, r.scale[2] * 0.95);
      mossCap.position.set(0, r.scale[1] * 0.65, 0);
      rockGroup.add(mossCap);

      this.sceneGroup.add(rockGroup);

      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(r.pos[0], r.pos[1], r.pos[2]));
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(r.scale[0] * 0.8, r.scale[1], r.scale[2] * 0.8), body);
      this.rigidBodies.push(body);
      this.colliders.push(col);
    }
  }

  private createRainParticles(): void {
    const geo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(this.rainCount * 3);

    for (let i = 0; i < this.rainCount; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 80;
      this.rainPositions[i * 3 + 1] = Math.random() * 30;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.12,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    this.rainPoints = new THREE.Points(geo, mat);
    this.sceneGroup.add(this.rainPoints);
  }

  private buildNavMesh(): void {
    const navGeo = new THREE.PlaneGeometry(90, 90, 16, 16);
    navGeo.rotateX(-Math.PI / 2);
    this.navMesh = parseNavMeshFromGeometry(navGeo);
  }

  public update(delta: number): void {
    // Animate falling rain particles
    if (this.rainPositions) {
      for (let i = 0; i < this.rainCount; i++) {
        this.rainPositions[i * 3 + 1] -= delta * 24.0;
        if (this.rainPositions[i * 3 + 1] < 0) {
          this.rainPositions[i * 3 + 1] = 28.0;
        }
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

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
