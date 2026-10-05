import * as THREE from 'three';
import * as YUKA from 'yuka';
import { RAPIER, physics } from '../physics';
import { BaseGameMap, MapId, MapMetadata, MapSpawnPoints, MAP_METADATA } from './types';
import { parseNavMeshFromGeometry } from '../ai/navmesh-helper';

export class DesertOutpostMap implements BaseGameMap {
  public id: MapId = 'desert';
  public metadata: MapMetadata = MAP_METADATA.desert;
  public sceneGroup: THREE.Group;
  public navMesh: YUKA.NavMesh;
  public spawns: MapSpawnPoints;
  public colliders: RAPIER.Collider[] = [];
  public rigidBodies: RAPIER.RigidBody[] = [];
  public lights: THREE.Light[] = [];

  private scene: THREE.Scene;
  private sandTexture!: THREE.CanvasTexture;
  private sandBumpMap!: THREE.CanvasTexture;
  private sandMat!: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sceneGroup = new THREE.Group();
    this.navMesh = new YUKA.NavMesh();

    this.spawns = {
      playerSpawn: new THREE.Vector3(0, 1.5, 24),
      botSpawns: [
        new THREE.Vector3(-18, 0.05, -18),
        new THREE.Vector3(18, 0.05, -18),
        new THREE.Vector3(0, 0.05, -28),
        new THREE.Vector3(-22, 0.05, 12),
        new THREE.Vector3(22, 0.05, 12),
        new THREE.Vector3(-14, 0.05, -4),
        new THREE.Vector3(14, 0.05, -4),
      ],
      lootSpawns: [
        { type: 'health', pos: new THREE.Vector3(-18, 0.05, 0), name: 'NANO-MEDKIT (+50 HP)' },
        { type: 'health', pos: new THREE.Vector3(18, 0.05, 0), name: 'NANO-MEDKIT (+50 HP)' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, 20), name: 'AMMO RESUPPLY CRATE' },
        { type: 'ammo', pos: new THREE.Vector3(0, 0.05, -20), name: 'AMMO RESUPPLY CRATE' },
        { type: 'weapon', weaponType: 'sniper', pos: new THREE.Vector3(0, 3.85, 0), name: 'AWP-50 VOID SNIPER' },
        { type: 'weapon', weaponType: 'shotgun', pos: new THREE.Vector3(-12, 0.05, -12), name: 'SPAS-12 STRIKER' },
        { type: 'weapon', weaponType: 'rpg', pos: new THREE.Vector3(12, 0.05, 12), name: 'TITAN-RPG HEAVY' },
      ],
      patrolWaypoints: [
        new YUKA.Vector3(-16, 0.05, -16),
        new YUKA.Vector3(16, 0.05, -16),
        new YUKA.Vector3(0, 3.85, 0), // Central elevated outpost deck
        new YUKA.Vector3(16, 0.05, 16),
        new YUKA.Vector3(-16, 0.05, 16),
        new YUKA.Vector3(0, 0.05, 24),
        new YUKA.Vector3(0, 0.05, -24),
      ],
      coverWaypoints: [
        new YUKA.Vector3(-22, 0.05, -22),
        new YUKA.Vector3(22, 0.05, -22),
        new YUKA.Vector3(-22, 0.05, 22),
        new YUKA.Vector3(22, 0.05, 22),
        new YUKA.Vector3(0, 0.05, -32),
      ],
    };

    this.createSandTextures();
  }

  private createSandTextures(): void {
    const size = 512;
    // 1. Color Map
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#d4a359';
    ctx.fillRect(0, 0, size, size);

    // Dune ripple noise
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const alpha = 0.05 + Math.random() * 0.12;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(255, 235, 180, ${alpha})` : `rgba(160, 110, 50, ${alpha})`;
      ctx.fillRect(x, y, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }

    this.sandTexture = new THREE.CanvasTexture(canvas);
    this.sandTexture.wrapS = THREE.RepeatWrapping;
    this.sandTexture.wrapT = THREE.RepeatWrapping;
    this.sandTexture.repeat.set(30, 30);

    // 2. Bump Map
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d')!;
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      bCtx.fillStyle = Math.random() < 0.5 ? '#a0a0a0' : '#606060';
      bCtx.fillRect(x, y, 2, 2);
    }
    this.sandBumpMap = new THREE.CanvasTexture(bumpCanvas);
    this.sandBumpMap.wrapS = THREE.RepeatWrapping;
    this.sandBumpMap.wrapT = THREE.RepeatWrapping;
    this.sandBumpMap.repeat.set(30, 30);

    this.sandMat = new THREE.MeshStandardMaterial({
      map: this.sandTexture,
      bumpMap: this.sandBumpMap,
      bumpScale: 0.06,
      roughness: 0.9,
      metalness: 0.05,
    });
  }

  public build(): void {
    // 1. Atmosphere, Fog & Lighting
    this.setupAtmosphere();

    // 2. Main Sand Ground
    this.createSandGround(130, 130);

    // 3. Canyon Perimeter Cliffs & Barricades
    this.createCanyonPerimeter(130, 130);

    // 4. Outpost Fortress & Elevated Wooden Ramparts
    this.createOutpostFortress();

    // 5. Low-Poly Palm Trees
    this.createPalmTrees();

    // 6. Canyon Stone Barricades & Cover
    this.createCanyonBarricades();

    // 7. Generate NavMesh
    this.buildNavMesh();

    this.scene.add(this.sceneGroup);
  }

  private setupAtmosphere(): void {
    // Warm distance fog
    this.scene.fog = new THREE.Fog(this.metadata.fogColor, 18, 120);
    this.scene.background = new THREE.Color(this.metadata.skyColor);

    // Bright Directional Sunlight (#fff1d0)
    const dirLight = new THREE.DirectionalLight(this.metadata.sunColor, 2.8);
    dirLight.position.set(40, 70, 30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 180;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    this.scene.add(dirLight);
    this.lights.push(dirLight);

    // Warm Ambient bounce
    const ambLight = new THREE.AmbientLight(0xffe8cc, 1.2);
    this.scene.add(ambLight);
    this.lights.push(ambLight);
  }

  private createSandGround(width: number, depth: number): void {
    const geo = new THREE.PlaneGeometry(width, depth, 32, 32);
    geo.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geo, this.sandMat);
    mesh.receiveShadow = true;
    this.sceneGroup.add(mesh);

    // Rapier Ground Collider
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2);
    const col = physics.world.createCollider(colDesc, body);

    this.rigidBodies.push(body);
    this.colliders.push(col);
  }

  private createCanyonPerimeter(width: number, depth: number): void {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x9a6b43, // Desert Sandstone
      roughness: 0.95,
      metalness: 0.1,
    });

    const wallHeight = 14.0;
    const thickness = 6.0;

    const walls = [
      { size: [width + thickness * 2, wallHeight, thickness], pos: [0, wallHeight / 2, -depth / 2 - thickness / 2] },
      { size: [width + thickness * 2, wallHeight, thickness], pos: [0, wallHeight / 2, depth / 2 + thickness / 2] },
      { size: [thickness, wallHeight, depth], pos: [-width / 2 - thickness / 2, wallHeight / 2, 0] },
      { size: [thickness, wallHeight, depth], pos: [width / 2 + thickness / 2, wallHeight / 2, 0] },
    ];

    for (const w of walls) {
      const geo = new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]);
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.sceneGroup.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(w.pos[0], w.pos[1], w.pos[2]);
      const body = physics.world.createRigidBody(bodyDesc);
      const colDesc = RAPIER.ColliderDesc.cuboid(w.size[0] / 2, w.size[1] / 2, w.size[2] / 2);
      const col = physics.world.createCollider(colDesc, body);
      this.rigidBodies.push(body);
      this.colliders.push(col);
    }
  }

  private createOutpostFortress(): void {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const adobeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.9 });

    // 1. Central Elevated Fortress Platform (8m x 8m, Height 3.8m)
    const platformGeo = new THREE.BoxGeometry(14, 3.8, 14);
    const platform = new THREE.Mesh(platformGeo, adobeMat);
    platform.position.set(0, 1.9, 0);
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.sceneGroup.add(platform);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.9, 0);
    const body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(7, 1.9, 7);
    const col = physics.world.createCollider(colDesc, body);
    this.rigidBodies.push(body);
    this.colliders.push(col);

    // 2. Walkable Wooden Ramp to Central Deck
    const rampLength = 12.0;
    const rampGeo = new THREE.BoxGeometry(4.0, 0.4, rampLength);
    const rampMesh = new THREE.Mesh(rampGeo, woodMat);
    rampMesh.position.set(0, 1.9, 10.5);
    rampMesh.rotation.x = -Math.atan2(3.8, rampLength);
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    this.sceneGroup.add(rampMesh);

    const rampBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.9, 10.5).setRotation({
      x: -Math.sin(Math.atan2(3.8, rampLength) / 2),
      y: 0,
      z: 0,
      w: Math.cos(Math.atan2(3.8, rampLength) / 2),
    });
    const rampBody = physics.world.createRigidBody(rampBodyDesc);
    const rampCol = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2.0, 0.2, rampLength / 2), rampBody);
    this.rigidBodies.push(rampBody);
    this.colliders.push(rampCol);

    // 3. Watchtowers at Corners
    const towerCoords = [
      { x: -20, z: -20 },
      { x: 20, z: -20 },
      { x: -20, z: 20 },
      { x: 20, z: 20 },
    ];

    for (const t of towerCoords) {
      const towerGeo = new THREE.CylinderGeometry(2.2, 2.8, 7.5, 8);
      const tower = new THREE.Mesh(towerGeo, adobeMat);
      tower.position.set(t.x, 3.75, t.z);
      tower.castShadow = true;
      tower.receiveShadow = true;
      this.sceneGroup.add(tower);

      const tBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, 3.75, t.z));
      const tCol = physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3.75, 2.6), tBody);
      this.rigidBodies.push(tBody);
      this.colliders.push(tCol);
    }
  }

  private createPalmTrees(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6, side: THREE.DoubleSide });

    const treePositions = [
      { x: -12, z: 16 },
      { x: -15, z: 22 },
      { x: 14, z: 18 },
      { x: 18, z: -10 },
      { x: -24, z: -14 },
      { x: 25, z: 4 },
      { x: -8, z: -24 },
    ];

    for (const pos of treePositions) {
      const tree = new THREE.Group();
      tree.position.set(pos.x, 0, pos.z);

      // Curved Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 6.5, 6);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(0, 3.25, 0);
      trunk.rotation.z = (Math.random() - 0.5) * 0.15;
      trunk.castShadow = true;
      tree.add(trunk);

      // Palm Fronds
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const leafGeo = new THREE.PlaneGeometry(1.2, 3.8);
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(Math.cos(angle) * 1.5, 6.4, Math.sin(angle) * 1.5);
        leaf.rotation.y = angle;
        leaf.rotation.x = 0.5;
        leaf.castShadow = true;
        tree.add(leaf);
      }

      this.sceneGroup.add(tree);

      // Rapier Trunk Collider
      const pBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, 3.25, pos.z));
      const pCol = physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3.25, 0.4), pBody);
      this.rigidBodies.push(pBody);
      this.colliders.push(pCol);
    }
  }

  private createCanyonBarricades(): void {
    const sandbagMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.95 });

    const barricades = [
      { pos: [-6, 0.6, 6], size: [4.0, 1.2, 0.8], rotY: 0.3 },
      { pos: [6, 0.6, 6], size: [4.0, 1.2, 0.8], rotY: -0.3 },
      { pos: [-8, 0.6, -8], size: [5.0, 1.2, 0.8], rotY: -0.4 },
      { pos: [8, 0.6, -8], size: [5.0, 1.2, 0.8], rotY: 0.4 },
      { pos: [0, 0.6, -14], size: [6.0, 1.2, 0.8], rotY: 0 },
    ];

    for (const b of barricades) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mesh = new THREE.Mesh(geo, sandbagMat);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.rotation.y = b.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.sceneGroup.add(mesh);

      const bBody = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(b.pos[0], b.pos[1], b.pos[2])
          .setRotation({ x: 0, y: Math.sin(b.rotY / 2), z: 0, w: Math.cos(b.rotY / 2) })
      );
      const bCol = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2),
        bBody
      );
      this.rigidBodies.push(bBody);
      this.colliders.push(bCol);
    }
  }

  private buildNavMesh(): void {
    // Generate unified walkable navmesh plane with elevated center & ramp
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
