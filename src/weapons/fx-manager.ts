import * as THREE from 'three';

export interface DecalItem {
  mesh: THREE.Mesh;
  createdAt: number;
  duration: number;
}

export interface ShockwaveEffect {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  radius: number;
  maxRadius: number;
  speed: number;
  startTime: number;
  duration: number;
}

export class FXManager {
  public scene: THREE.Scene;

  // Tracers
  private tracerMaterial: THREE.LineBasicMaterial;
  private tracers: Array<{ line: THREE.Line; progress: number; length: number; origin: THREE.Vector3; dir: THREE.Vector3 }> = [];

  // Spark Particles
  private sparkCount = 400;
  private sparkGeo: THREE.BufferGeometry;
  private sparkPositions: Float32Array;
  private sparkVelocities: Float32Array;
  private sparkAges: Float32Array;
  private sparkLifespans: Float32Array;
  private sparkColors: Float32Array;
  private sparkPoints: THREE.Points;

  // Decals
  public decals: DecalItem[] = [];

  // Shockwaves
  public shockwaves: ShockwaveEffect[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Tracer Setup
    this.tracerMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      linewidth: 2,
    });

    // 2. GPU Particle Spark Setup
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(this.sparkCount * 3);
    this.sparkVelocities = new Float32Array(this.sparkCount * 3);
    this.sparkAges = new Float32Array(this.sparkCount);
    this.sparkLifespans = new Float32Array(this.sparkCount);
    this.sparkColors = new Float32Array(this.sparkCount * 3);

    for (let i = 0; i < this.sparkCount; i++) {
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = -9999;
      this.sparkPositions[i * 3 + 2] = 0;
      this.sparkAges[i] = 999;
      this.sparkLifespans[i] = 0.35;
    }

    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3));

    const sparkMat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sparkPoints = new THREE.Points(this.sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);
  }

  public addTracer(from: THREE.Vector3, to: THREE.Vector3, colorHex = 0x00f0ff): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.01) return;
    dir.normalize();

    const lineGeo = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
    const lineMat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    this.scene.add(line);

    this.tracers.push({
      line,
      progress: 0,
      length: dist,
      origin: from.clone(),
      dir,
    });
  }

  public addImpact(point: THREE.Vector3, normal: THREE.Vector3, isFlesh = false): void {
    this.emitSparks(point, normal, isFlesh ? 8 : 16, isFlesh);
    this.createDecal(point, normal, isFlesh);
  }

  public addSparksOnly(point: THREE.Vector3, normal: THREE.Vector3): void {
    this.emitSparks(point, normal, 12, false);
  }

  public emitSparks(pos: THREE.Vector3, normal: THREE.Vector3, count = 14, isFlesh = false): void {
    let spawned = 0;
    for (let i = 0; i < this.sparkCount && spawned < count; i++) {
      if (this.sparkAges[i] >= this.sparkLifespans[i]) {
        this.sparkAges[i] = 0;
        this.sparkLifespans[i] = 0.2 + Math.random() * 0.25;

        this.sparkPositions[i * 3] = pos.x;
        this.sparkPositions[i * 3 + 1] = pos.y;
        this.sparkPositions[i * 3 + 2] = pos.z;

        const tangent = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        ).normalize();

        const sparkDir = new THREE.Vector3()
          .addScaledVector(normal, 0.7 + Math.random() * 0.6)
          .addScaledVector(tangent, 0.8)
          .normalize();

        const speed = 4.0 + Math.random() * 9.0;
        this.sparkVelocities[i * 3] = sparkDir.x * speed;
        this.sparkVelocities[i * 3 + 1] = sparkDir.y * speed;
        this.sparkVelocities[i * 3 + 2] = sparkDir.z * speed;

        if (isFlesh) {
          this.sparkColors[i * 3] = 1.0;
          this.sparkColors[i * 3 + 1] = 0.15;
          this.sparkColors[i * 3 + 2] = 0.15;
        } else {
          this.sparkColors[i * 3] = 1.0;
          this.sparkColors[i * 3 + 1] = 0.6 + Math.random() * 0.4;
          this.sparkColors[i * 3 + 2] = 0.1;
        }

        spawned++;
      }
    }
  }

  private createDecal(point: THREE.Vector3, normal: THREE.Vector3, isFlesh = false): void {
    if (this.decals.length > 40) {
      const old = this.decals.shift();
      if (old) {
        this.scene.remove(old.mesh);
        old.mesh.geometry.dispose();
      }
    }

    const size = isFlesh ? 0.18 : 0.12;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: isFlesh ? 0x880000 : 0x05070a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const decal = new THREE.Mesh(geo, mat);
    decal.position.copy(point).addScaledVector(normal, 0.015);

    const target = point.clone().add(normal);
    decal.lookAt(target);

    this.scene.add(decal);
    this.decals.push({
      mesh: decal,
      createdAt: performance.now(),
      duration: 12000,
    });
  }

  /**
   * Spawns massive 5-meter explosion shockwave ring & fireball particle burst
   */
  public addExplosionEffect(center: THREE.Vector3, radius = 5.0): void {
    // 1. Expanding Shockwave Ring Mesh
    const ringGeo = new THREE.RingGeometry(0.2, 0.5, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockwaveMesh = new THREE.Mesh(ringGeo, ringMat);
    shockwaveMesh.position.copy(center).add(new THREE.Vector3(0, 0.1, 0));
    this.scene.add(shockwaveMesh);

    // 2. Bright Explosion Light Flash
    const expLight = new THREE.PointLight(0xff5500, 8.0, 16.0);
    expLight.position.copy(center).add(new THREE.Vector3(0, 1.0, 0));
    this.scene.add(expLight);

    this.shockwaves.push({
      mesh: shockwaveMesh,
      light: expLight,
      radius: 0.2,
      maxRadius: radius,
      speed: radius / 0.45, // Expands over 0.45s
      startTime: performance.now(),
      duration: 550,
    });

    // 3. Dense Radial Sparks & Fireballs
    for (let i = 0; i < 48; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.5 + 0.2,
        (Math.random() - 0.5) * 2
      ).normalize();
      this.emitSparks(center, dir, 3, false);
    }
  }

  public update(delta: number): void {
    // 1. Update Bullet Tracers
    const tracerSpeed = 220.0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.progress += (tracerSpeed * delta) / t.length;

      const headDist = Math.min(t.length, t.progress * t.length);
      const tailDist = Math.max(0, (t.progress - 0.25) * t.length);

      const headPos = t.origin.clone().addScaledVector(t.dir, headDist);
      const tailPos = t.origin.clone().addScaledVector(t.dir, tailDist);

      const posAttr = t.line.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, tailPos.x, tailPos.y, tailPos.z);
      posAttr.setXYZ(1, headPos.x, headPos.y, headPos.z);
      posAttr.needsUpdate = true;

      if (t.progress >= 1.25) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }

    // 2. Update Spark Particles
    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkAges[i] < this.sparkLifespans[i]) {
        this.sparkAges[i] += delta;
        this.sparkVelocities[i * 3 + 1] -= 9.8 * delta;

        this.sparkPositions[i * 3] += this.sparkVelocities[i * 3] * delta;
        this.sparkPositions[i * 3 + 1] += this.sparkVelocities[i * 3 + 1] * delta;
        this.sparkPositions[i * 3 + 2] += this.sparkVelocities[i * 3 + 2] * delta;
      } else {
        this.sparkPositions[i * 3 + 1] = -9999;
      }
    }

    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;

    // 3. Update Decals
    const now = performance.now();
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const age = now - d.createdAt;
      if (age >= d.duration) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.decals.splice(i, 1);
      } else if (age > d.duration * 0.7) {
        const fade = 1.0 - (age - d.duration * 0.7) / (d.duration * 0.3);
        const mat = d.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * 0.9;
      }
    }

    // 4. Update Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      const age = now - s.startTime;
      const progress = Math.min(1.0, age / s.duration);

      s.radius += s.speed * delta;
      const scale = s.radius;
      s.mesh.scale.set(scale, 1, scale);

      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1.0 - progress) * 0.9;
      s.light.intensity = (1.0 - progress) * 8.0;

      if (progress >= 1.0) {
        this.scene.remove(s.mesh);
        this.scene.remove(s.light);
        s.mesh.geometry.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }
}
