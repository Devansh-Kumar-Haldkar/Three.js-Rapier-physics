import * as THREE from 'three';
import { RAPIER, physics } from './physics';

export class Arena {
  private scene: THREE.Scene;
  private gridTexture!: THREE.CanvasTexture;
  private orangeGridTexture!: THREE.CanvasTexture;
  private darkGridTexture!: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createTextures();
  }

  private createGridCanvas(primaryColor: string, secondaryColor: string, lineColor: string, size = 512): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = primaryColor;
    ctx.fillRect(0, 0, size, size);

    // Checker pattern
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

    // Inner Grid lines
    ctx.strokeStyle = lineColor;
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

    // Outer border
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, size, size);

    return canvas;
  }

  private createTextures(): void {
    const canvasMain = this.createGridCanvas('#111827', '#0e1626', 'rgba(0, 240, 255, 0.28)');
    this.gridTexture = new THREE.CanvasTexture(canvasMain);
    this.gridTexture.wrapS = THREE.RepeatWrapping;
    this.gridTexture.wrapT = THREE.RepeatWrapping;

    const canvasOrange = this.createGridCanvas('#2b1c10', '#1f1308', 'rgba(255, 140, 0, 0.4)');
    this.orangeGridTexture = new THREE.CanvasTexture(canvasOrange);
    this.orangeGridTexture.wrapS = THREE.RepeatWrapping;
    this.orangeGridTexture.wrapT = THREE.RepeatWrapping;

    const canvasDark = this.createGridCanvas('#0f172a', '#0a0f1d', 'rgba(255, 255, 255, 0.16)');
    this.darkGridTexture = new THREE.CanvasTexture(canvasDark);
    this.darkGridTexture.wrapS = THREE.RepeatWrapping;
    this.darkGridTexture.wrapT = THREE.RepeatWrapping;
  }

  public build(): void {
    // 1. Main Ground
    this.createGround(120, 120);

    // 2. Perimeter Walls
    this.createPerimeterWalls(120, 120, 8);

    // 3. Central Obstacle & Platform Arena
    this.createCentralPlatforms();

    // 4. Test Ramps (15°, 30°, 45°)
    this.createRamps();

    // 5. Stepping Stairs & Parkour Blocks
    this.createStairsAndParkour();

    // 6. Interactive Physics Dynamic Props
    this.createDynamicProps();

    // 7. Jump Pad (Bouncy Launch Pad)
    this.createJumpPad(new THREE.Vector3(0, 0.1, -18));

    // 8. Atmospheric Skybox, Lighting and Fog
    this.setupEnvironment();
  }

  private createGround(width: number, depth: number): void {
    const groundGeo = new THREE.PlaneGeometry(width, depth);
    const texture = this.gridTexture.clone();
    texture.repeat.set(width / 4, depth / 4);

    const groundMat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.2,
    });

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Rapier Ground collider
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = physics.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, 0.5, depth / 2)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0);
    physics.world.createCollider(groundColliderDesc, groundBody);
  }

  private createPerimeterWalls(width: number, depth: number, height: number): void {
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.darkGridTexture,
      roughness: 0.55,
      metalness: 0.25,
      color: 0x334155,
    });

    const halfW = width / 2;
    const halfD = depth / 2;
    const halfH = height / 2;

    const wallsData = [
      { size: [width, height, 1], pos: [0, halfH, -halfD] },
      { size: [width, height, 1], pos: [0, halfH, halfD] },
      { size: [1, height, depth], pos: [-halfW, halfH, 0] },
      { size: [1, height, depth], pos: [halfW, halfH, 0] },
    ];

    wallsData.forEach(({ size, pos }) => {
      const [w, h, d] = size;
      const [px, py, pz] = pos;

      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(px, py, pz);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      // Glowing top border strip on walls for cyber bloom
      const stripGeo = new THREE.BoxGeometry(w > 1 ? w : 0.8, 0.15, d > 1 ? d : 0.8);
      const stripMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
      const stripMesh = new THREE.Mesh(stripGeo, stripMat);
      stripMesh.position.set(px, height, pz);
      this.scene.add(stripMesh);

      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz);
      const body = physics.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2);
      physics.world.createCollider(colliderDesc, body);
    });
  }

  private createCentralPlatforms(): void {
    // Large elevated catwalk in center
    this.createStaticBox(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(12, 3, 12), 0x2563eb, true);
    this.createStaticBox(new THREE.Vector3(0, 3.5, 0), new THREE.Vector3(6, 1, 6), 0x0284c7, true);

    // Cover obstacles
    this.createStaticBox(new THREE.Vector3(-8, 1, -8), new THREE.Vector3(2, 2, 6), 0x3b82f6);
    this.createStaticBox(new THREE.Vector3(8, 1, -8), new THREE.Vector3(6, 2, 2), 0x3b82f6);
    this.createStaticBox(new THREE.Vector3(-8, 1, 8), new THREE.Vector3(6, 2, 2), 0x3b82f6);
    this.createStaticBox(new THREE.Vector3(8, 1, 8), new THREE.Vector3(2, 2, 6), 0x3b82f6);

    // Glowing Pillars
    this.createStaticCylinder(new THREE.Vector3(-14, 4, 0), 1.2, 8, 0x475569);
    this.createStaticCylinder(new THREE.Vector3(14, 4, 0), 1.2, 8, 0x475569);
  }

  private createRamps(): void {
    // 15 Degree Ramp (Gentle)
    this.createRamp(new THREE.Vector3(-22, 0, 10), 6, 12, 15 * (Math.PI / 180), 0x10b981);

    // 30 Degree Ramp (Standard)
    this.createRamp(new THREE.Vector3(-22, 0, -2), 6, 10, 30 * (Math.PI / 180), 0xf59e0b);

    // 45 Degree Ramp (Steep)
    this.createRamp(new THREE.Vector3(-22, 0, -14), 6, 8, 45 * (Math.PI / 180), 0xef4444);

    // Signpost markers for ramps
    this.createSignpost(new THREE.Vector3(-27, 1.5, 10), '15° RAMP');
    this.createSignpost(new THREE.Vector3(-27, 1.5, -2), '30° RAMP');
    this.createSignpost(new THREE.Vector3(-27, 1.5, -14), '45° RAMP');
  }

  private createRamp(basePos: THREE.Vector3, width: number, length: number, angleRad: number, color: number): void {
    const thickness = 0.5;
    const height = Math.sin(angleRad) * length;
    const horizontalRun = Math.cos(angleRad) * length;

    const texture = this.orangeGridTexture.clone();
    texture.repeat.set(width / 2, length / 2);

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.5,
      metalness: 0.2,
      color: color,
    });

    const geo = new THREE.BoxGeometry(width, thickness, length);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position center of ramp
    const posX = basePos.x;
    const posY = basePos.y + height / 2;
    const posZ = basePos.z + horizontalRun / 2;

    mesh.position.set(posX, posY, posZ);
    mesh.rotation.x = angleRad;
    this.scene.add(mesh);

    // Rapier physics for rotated ramp
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(posX, posY, posZ)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angleRad));
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, thickness / 2, length / 2)
      .setFriction(0.8);
    physics.world.createCollider(colliderDesc, body);

    // Supporting platform at top of ramp
    const topPlatW = width;
    const topPlatD = 4;
    const topPlatH = thickness;
    const topPlatPos = new THREE.Vector3(posX, height, basePos.z + horizontalRun + topPlatD / 2);
    this.createStaticBox(topPlatPos, new THREE.Vector3(topPlatW, topPlatH, topPlatD), color);
  }

  private createStairsAndParkour(): void {
    // Staircase steps leading up to an elevated deck
    const stepCount = 10;
    const stepWidth = 5;
    const stepDepth = 1.0;
    const stepHeight = 0.4;
    const startPos = new THREE.Vector3(22, 0, -15);

    for (let i = 0; i < stepCount; i++) {
      const pos = new THREE.Vector3(
        startPos.x,
        (i + 0.5) * stepHeight,
        startPos.z + i * stepDepth
      );
      this.createStaticBox(pos, new THREE.Vector3(stepWidth, (i + 1) * stepHeight, stepDepth), 0x6366f1);
    }

    // High viewing platform at top of stairs
    const topDeckPos = new THREE.Vector3(startPos.x, (stepCount * stepHeight) / 2, startPos.z + stepCount * stepDepth + 5);
    this.createStaticBox(
      new THREE.Vector3(topDeckPos.x, stepCount * stepHeight - 0.25, topDeckPos.z),
      new THREE.Vector3(10, 0.5, 10),
      0x4f46e5,
      true
    );

    // Parkour jumping pillars / blocks
    const pillarPositions = [
      new THREE.Vector3(18, 1.0, 10),
      new THREE.Vector3(22, 1.8, 14),
      new THREE.Vector3(26, 2.6, 10),
      new THREE.Vector3(22, 3.4, 6),
      new THREE.Vector3(16, 4.2, 4),
    ];

    pillarPositions.forEach((pos) => {
      this.createStaticBox(pos, new THREE.Vector3(2.5, pos.y * 2, 2.5), 0x06b6d4, true);
    });
  }

  public spawnPhysicsBox(position: THREE.Vector3): void {
    const size = 0.8 + Math.random() * 0.6;
    const geo = new THREE.BoxGeometry(size, size, size);
    const colors = [0xef4444, 0x10b981, 0x3b82f6, 0xf59e0b, 0x8b5cf6, 0xec4899];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.2)
      .setAngularDamping(0.2);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setRestitution(0.4)
      .setFriction(0.6)
      .setDensity(1.5);
    physics.world.createCollider(colliderDesc, body);

    physics.registerSync(mesh, body);
  }

  private createDynamicProps(): void {
    // Dynamic stack of crates to knock down
    const stackBase = new THREE.Vector3(0, 0, 18);
    const rows = 4;
    const boxSize = 1.0;

    for (let y = 0; y < rows; y++) {
      const count = rows - y;
      const yOffset = (y + 0.5) * boxSize;
      const startX = -((count - 1) * boxSize * 1.05) / 2;

      for (let x = 0; x < count; x++) {
        const posX = stackBase.x + startX + x * boxSize * 1.05;
        const pos = new THREE.Vector3(posX, yOffset, stackBase.z);
        this.spawnPhysicsBox(pos);
      }
    }

    // Dynamic Barrels / Cylinders
    for (let i = 0; i < 4; i++) {
      const radius = 0.5;
      const height = 1.2;
      const geo = new THREE.CylinderGeometry(radius, radius, height, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        roughness: 0.3,
        metalness: 0.7,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const pos = new THREE.Vector3(-8 + i * 2, height / 2 + 0.1, 14);
      mesh.position.copy(pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
      const body = physics.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cylinder(height / 2, radius)
        .setFriction(0.5)
        .setRestitution(0.2);
      physics.world.createCollider(colliderDesc, body);
      physics.registerSync(mesh, body);
    }
  }

  private createJumpPad(pos: THREE.Vector3): void {
    // Jump pad base
    const baseGeo = new THREE.CylinderGeometry(2, 2.2, 0.3, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.8,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.copy(pos);
    baseMesh.receiveShadow = true;
    this.scene.add(baseMesh);

    // Glowing energy ring (High emissive bloom)
    const ringGeo = new THREE.TorusGeometry(1.5, 0.16, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.set(pos.x, pos.y + 0.2, pos.z);
    this.scene.add(ringMesh);

    // Inner glowing core
    const coreGeo = new THREE.CircleGeometry(1.2, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x00a8ff,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.rotation.x = -Math.PI / 2;
    coreMesh.position.set(pos.x, pos.y + 0.16, pos.z);
    this.scene.add(coreMesh);

    // Physics Collider for pad
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(0.15, 2.0);
    physics.world.createCollider(colliderDesc, body);
  }

  public createStaticBox(pos: THREE.Vector3, size: THREE.Vector3, color: number, addNeonTrim = false): THREE.Mesh {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const texture = this.darkGridTexture.clone();
    texture.repeat.set(size.x / 2, size.z / 2);

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      color: color,
      roughness: 0.55,
      metalness: 0.2,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    if (addNeonTrim) {
      // Add glowing neon top border edges for sci-fi bloom
      const trimGeo = new THREE.BoxGeometry(size.x + 0.05, 0.08, size.z + 0.05);
      const trimMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
      const trimMesh = new THREE.Mesh(trimGeo, trimMat);
      trimMesh.position.set(pos.x, pos.y + size.y / 2 + 0.04, pos.z);
      this.scene.add(trimMesh);
    }

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(1.0);
    physics.world.createCollider(colliderDesc, body);

    return mesh;
  }

  public createStaticCylinder(pos: THREE.Vector3, radius: number, height: number, color: number): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.45,
      metalness: 0.35,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Neon ring band on pillar
    const ringGeo = new THREE.TorusGeometry(radius + 0.05, 0.08, 16, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.set(pos.x, pos.y + height * 0.25, pos.z);
    this.scene.add(ringMesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(height / 2, radius);
    physics.world.createCollider(colliderDesc, body);

    return mesh;
  }

  private createSignpost(pos: THREE.Vector3, text: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(2.0, 1.0);
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.y = Math.PI / 2;
    this.scene.add(mesh);
  }

  private setupEnvironment(): void {
    // 1. Procedural Sky Dome
    this.createSkyDome();

    // 2. Ambient Lighting
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.35);
    this.scene.add(ambientLight);

    // 3. Hemisphere Sky Light (Top cyan sky / bottom deep navy)
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.7);
    hemiLight.position.set(0, 60, 0);
    this.scene.add(hemiLight);

    // 4. Directional Sun Light with Soft Shadow Mapping
    const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.7);
    sunLight.position.set(40, 60, 30);
    sunLight.castShadow = true;

    // High quality soft shadow map properties
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 160;

    const d = 65;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.radius = 2.0;
    this.scene.add(sunLight);

    // Secondary Cool Rim / Fill Light
    const fillLight = new THREE.DirectionalLight(0x0284c7, 0.5);
    fillLight.position.set(-35, 30, -35);
    this.scene.add(fillLight);

    // 5. Harmonious Atmospheric Fog for Depth
    this.scene.fog = new THREE.FogExp2(0x091122, 0.012);
  }

  private createSkyDome(): void {
    // Large hemisphere sky dome with custom gradient shader
    const skyGeo = new THREE.SphereGeometry(300, 32, 24);

    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;

      void main() {
        float h = normalize(vWorldPosition + offset).y;
        vec3 color;
        if (h > 0.0) {
          color = mix(horizonColor, topColor, pow(max(h, 0.0), exponent));
        } else {
          color = mix(horizonColor, bottomColor, pow(max(-h, 0.0), exponent));
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const uniforms = {
      topColor: { value: new THREE.Color(0x030712) },     // Deep space navy
      horizonColor: { value: new THREE.Color(0x0c1e3d) }, // Cyan atmosphere haze
      bottomColor: { value: new THREE.Color(0x060b14) },  // Dark ground plane
      offset: { value: 30 },
      exponent: { value: 0.6 },
    };

    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });

    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyMesh);

    // Starfield particle cloud
    const starCount = 600;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.8 + 0.1); // Upper hemisphere only
      const r = 280;

      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xe2e8f0,
      size: 1.2,
      transparent: true,
      opacity: 0.8,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    this.scene.add(starPoints);
  }
}
