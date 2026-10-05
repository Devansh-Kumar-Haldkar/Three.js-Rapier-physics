import * as THREE from 'three';

export class CargoPlane {
  public mesh: THREE.Group;
  public startPos: THREE.Vector3;
  public endPos: THREE.Vector3;
  public currentPos: THREE.Vector3;
  public direction: THREE.Vector3;
  public speed = 65.0; // 65 m/s transport speed
  public altitude = 350.0;
  public progress = 0.0;
  public totalDistance: number;
  public scene: THREE.Scene;
  public isCompleted = false;

  // Engine Exhaust Glow Sprites
  private exhaustLights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Calculate randomized flight path vector across arena bounds at altitude Y=350
    const flightAngle = Math.random() * Math.PI * 2;
    const spawnDistance = 260.0;

    this.startPos = new THREE.Vector3(
      Math.cos(flightAngle) * spawnDistance,
      this.altitude,
      Math.sin(flightAngle) * spawnDistance
    );

    this.endPos = new THREE.Vector3(
      Math.cos(flightAngle + Math.PI) * spawnDistance,
      this.altitude,
      Math.sin(flightAngle + Math.PI) * spawnDistance
    );

    this.currentPos = this.startPos.clone();
    this.direction = new THREE.Vector3().subVectors(this.endPos, this.startPos).normalize();
    this.totalDistance = this.startPos.distanceTo(this.endPos);

    // 2. Build 3D Cargo Transport Craft Mesh
    this.mesh = this.buildPlaneModel();
    this.mesh.position.copy(this.currentPos);
    this.mesh.lookAt(this.currentPos.clone().add(this.direction));

    this.scene.add(this.mesh);
  }

  private buildPlaneModel(): THREE.Group {
    const plane = new THREE.Group();

    // Materials
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.3,
    });

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.9,
      roughness: 0.25,
    });

    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.95,
      roughness: 0.2,
    });

    const glowCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const glowOrange = new THREE.MeshBasicMaterial({ color: 0xff6600 });

    // 1. Main Fuselage Body
    const bodyGeo = new THREE.CylinderGeometry(4.5, 4.5, 38.0, 16);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMesh = new THREE.Mesh(bodyGeo, hullMat);
    plane.add(bodyMesh);

    // Nose Cone
    const noseGeo = new THREE.ConeGeometry(4.5, 9.0, 16);
    noseGeo.rotateX(-Math.PI / 2);
    const noseMesh = new THREE.Mesh(noseGeo, hullMat);
    noseMesh.position.set(0, 0, -23.5);
    plane.add(noseMesh);

    // Cockpit Visor Canopy
    const cockpitGeo = new THREE.BoxGeometry(4.0, 2.2, 7.0);
    const cockpit = new THREE.Mesh(cockpitGeo, glowCyan);
    cockpit.position.set(0, 3.2, -18.0);
    plane.add(cockpit);

    // 2. Heavy Swept Wings
    const wingGeo = new THREE.BoxGeometry(54.0, 0.8, 8.0);
    const mainWings = new THREE.Mesh(wingGeo, wingMat);
    mainWings.position.set(0, 1.2, -2.0);
    plane.add(mainWings);

    // Wingtips with Navigation Strobe Lights
    const tipLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 6.0), glowCyan);
    tipLeft.position.set(-27.0, 2.0, -2.0);
    plane.add(tipLeft);

    const tipRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 6.0), glowCyan);
    tipRight.position.set(27.0, 2.0, -2.0);
    plane.add(tipRight);

    // 3. Tail Fin & Stabilizers
    const tailFinGeo = new THREE.BoxGeometry(0.8, 9.5, 8.0);
    const tailFin = new THREE.Mesh(tailFinGeo, wingMat);
    tailFin.position.set(0, 6.5, 16.0);
    plane.add(tailFin);

    const tailHGeo = new THREE.BoxGeometry(18.0, 0.6, 5.0);
    const tailH = new THREE.Mesh(tailHGeo, wingMat);
    tailH.position.set(0, 2.5, 17.5);
    plane.add(tailH);

    // 4. Four Heavy Jet Turbine Engines with Glowing Thrusters
    const engineOffsets = [-16, -9, 9, 16];
    for (const offX of engineOffsets) {
      const engGeo = new THREE.CylinderGeometry(1.8, 1.8, 9.0, 16);
      engGeo.rotateX(Math.PI / 2);
      const eng = new THREE.Mesh(engGeo, engineMat);
      eng.position.set(offX, -1.2, 0.5);
      plane.add(eng);

      // Glowing Exhaust Cone
      const exhaustGeo = new THREE.CylinderGeometry(1.5, 1.2, 1.5, 16);
      exhaustGeo.rotateX(Math.PI / 2);
      const exhaust = new THREE.Mesh(exhaustGeo, glowOrange);
      exhaust.position.set(offX, -1.2, 5.2);
      plane.add(exhaust);

      // Exhaust Light
      const pLight = new THREE.PointLight(0xff5500, 4.0, 18.0);
      pLight.position.set(offX, -1.2, 7.0);
      plane.add(pLight);
      this.exhaustLights.push(pLight);
    }

    return plane;
  }

  public update(delta: number): void {
    if (this.isCompleted) return;

    const step = this.speed * delta;
    this.currentPos.addScaledVector(this.direction, step);
    this.mesh.position.copy(this.currentPos);

    const traveled = this.startPos.distanceTo(this.currentPos);
    this.progress = Math.min(1.0, traveled / this.totalDistance);

    if (this.progress >= 1.0) {
      this.isCompleted = true;
    }
  }

  public getChaseCameraPosition(offsetDist = 32.0, heightOffset = 10.0): THREE.Vector3 {
    // Camera position behind and slightly above cargo craft
    const behindVec = this.direction.clone().negate().multiplyScalar(offsetDist);
    return this.currentPos.clone().add(behindVec).add(new THREE.Vector3(0, heightOffset, 0));
  }

  public destroy(): void {
    this.scene.remove(this.mesh);
  }
}
