import * as THREE from 'three';
import * as YUKA from 'yuka';

/**
 * Parses geometry (or extracted GLTF buffer geometry) into a Yuka NavMesh
 * by extracting vertices and convex polygon triangles.
 */
export function parseNavMeshFromGeometry(geometry: THREE.BufferGeometry): YUKA.NavMesh {
  const navMesh = new YUKA.NavMesh();
  const positionAttr = geometry.getAttribute('position');
  const indexAttr = geometry.getIndex();

  if (!positionAttr) {
    console.warn('[NAVMESH] Geometry missing position attribute.');
    return navMesh;
  }

  const vertices: YUKA.Vector3[] = [];
  for (let i = 0; i < positionAttr.count; i++) {
    vertices.push(new YUKA.Vector3(
      positionAttr.getX(i),
      positionAttr.getY(i),
      positionAttr.getZ(i)
    ));
  }

  const polygons: YUKA.Polygon[] = [];

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      const a = vertices[indexAttr.getX(i)];
      const b = vertices[indexAttr.getX(i + 1)];
      const c = vertices[indexAttr.getX(i + 2)];
      const poly = new YUKA.Polygon().fromContour([a, b, c]);
      polygons.push(poly);
    }
  } else {
    for (let i = 0; i < vertices.length; i += 3) {
      const a = vertices[i];
      const b = vertices[i + 1];
      const c = vertices[i + 2];
      const poly = new YUKA.Polygon().fromContour([a, b, c]);
      polygons.push(poly);
    }
  }

  // Build navmesh graph from convex polygons
  (navMesh as any).fromPolygons(polygons);
  return navMesh;
}

/**
 * Parses a loaded GLTF Object or Object3D hierarchy containing a NavMesh into a Yuka NavMesh.
 */
export function parseNavMeshFromGLTF(gltf: any): YUKA.NavMesh {
  const root = gltf.scene || gltf;
  let navMeshGeometry: THREE.BufferGeometry | null = null;

  root.traverse((child: any) => {
    if (child.isMesh && child.geometry && !navMeshGeometry) {
      const geom = child.geometry.clone();
      geom.applyMatrix4(child.matrixWorld);
      navMeshGeometry = geom;
    }
  });

  if (navMeshGeometry !== null) {
    return parseNavMeshFromGeometry(navMeshGeometry);
  }

  console.warn('[NAVMESH] No mesh found in GLTF to generate NavMesh. Falling back to default arena NavMesh.');
  return createArenaNavMesh();
}

/**
 * Loads an exported NavMesh GLTF file from a URL/path and parses it into a Yuka NavMesh.
 */
export async function loadNavMeshGLTF(url: string): Promise<YUKA.NavMesh> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const navMesh = parseNavMeshFromGLTF(gltf);
        resolve(navMesh);
      },
      undefined,
      (error) => {
        console.error('[NAVMESH] Error loading NavMesh GLTF:', error);
        reject(error);
      }
    );
  });
}

/**
 * Procedurally creates a full structured NavMesh covering the Testing Arena
 * (Main Ground, Ramps, Elevated Deck, Flanks, and Obstacle bypasses).
 */
export function createArenaNavMesh(): YUKA.NavMesh {
  const navMesh = new YUKA.NavMesh();
  const polygons: YUKA.Polygon[] = [];

  // Helper to add quad as 2 triangles
  function addQuad(
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number]
  ): void {
    const v1 = new YUKA.Vector3(p1[0], p1[1], p1[2]);
    const v2 = new YUKA.Vector3(p2[0], p2[1], p2[2]);
    const v3 = new YUKA.Vector3(p3[0], p3[1], p3[2]);
    const v4 = new YUKA.Vector3(p4[0], p4[1], p4[2]);

    polygons.push(new YUKA.Polygon().fromContour([v1, v2, v3]));
    polygons.push(new YUKA.Polygon().fromContour([v1, v3, v4]));
  }

  // 1. South Arena Sector (Z: 0 to 35)
  addQuad([-35, 0.05, 0], [35, 0.05, 0], [35, 0.05, 18], [-35, 0.05, 18]);
  addQuad([-35, 0.05, 18], [35, 0.05, 18], [35, 0.05, 36], [-35, 0.05, 36]);

  // 2. North Arena Sector (Z: -35 to 0)
  addQuad([-35, 0.05, -18], [35, 0.05, -18], [35, 0.05, 0], [-35, 0.05, 0]);
  addQuad([-35, 0.05, -36], [35, 0.05, -36], [35, 0.05, -18], [-35, 0.05, -18]);

  // 3. West & East Flank Corridors
  addQuad([-35, 0.05, -36], [-20, 0.05, -36], [-20, 0.05, 36], [-35, 0.05, 36]);
  addQuad([20, 0.05, -36], [35, 0.05, -36], [35, 0.05, 36], [20, 0.05, 36]);

  // 4. Central Elevated Platform (+3.0m height)
  addQuad([-9, 3.05, -9], [9, 3.05, -9], [9, 3.05, 9], [-9, 3.05, 9]);

  // 5. Access Ramps connecting ground to +3.0m deck
  // North Ramp
  addQuad([-4, 0.05, -18], [4, 0.05, -18], [4, 3.05, -9], [-4, 3.05, -9]);
  // South Ramp
  addQuad([-4, 3.05, 9], [4, 3.05, 9], [4, 0.05, 18], [-4, 0.05, 18]);
  // West Ramp
  addQuad([-18, 0.05, -4], [-9, 3.05, -4], [-9, 3.05, 4], [-18, 0.05, 4]);
  // East Ramp
  addQuad([9, 3.05, -4], [18, 0.05, -4], [18, 0.05, 4], [9, 3.05, 4]);

  (navMesh as any).fromPolygons(polygons);
  return navMesh;
}

/**
 * Creates a debug visual wireframe mesh of the Yuka NavMesh in Three.js
 */
export function createNavMeshWireframe(navMesh: YUKA.NavMesh): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];

  for (const polygon of (navMesh as any).regions || (navMesh as any).polygons || []) {
    const contour = polygon.contour || polygon.vertices || [];
    for (let i = 0; i < contour.length; i++) {
      const v1 = contour[i];
      const v2 = contour[(i + 1) % contour.length];
      positions.push(v1.x, v1.y + 0.08, v1.z);
      positions.push(v2.x, v2.y + 0.08, v2.z);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.35,
  });

  return new THREE.LineSegments(geometry, material);
}
