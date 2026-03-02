import * as THREE from 'three';
import { TrackManager } from './track';

/**
 * Builds a connected quad-strip mesh along a CatmullRom curve.
 * Adjacent segments share vertices so there are no cracks at bends.
 *
 * @param curve    Spline to follow.
 * @param offset1  Lateral offset of the first edge (negative = inner side).
 * @param y1       Y height of the first edge.
 * @param offset2  Lateral offset of the second edge (positive = outer side).
 * @param y2       Y height of the second edge.
 * @param isDashed Skip alternate groups of segments to produce a dashed line.
 */
function createQuadStrip(
  curve: THREE.CatmullRomCurve3,
  offset1: number, y1: number,
  offset2: number, y2: number,
  isDashed = false
) {
  const segments = 600;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tn = curve.getTangentAt(t);

    // Lateral normal — perpendicular to travel direction, on the XZ plane.
    const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();

    const vA = p.clone().addScaledVector(n, offset1);
    const vB = p.clone().addScaledVector(n, offset2);

    positions.push(vA.x, y1, vA.z);  // vertex i*2
    positions.push(vB.x, y2, vB.z);  // vertex i*2 + 1
  }

  // Returns true when segment index `s` falls inside a dashed gap.
  const isGap = (s: number) => isDashed && Math.floor(s / 4) % 2 === 0;

  for (let i = 0; i < segments; i++) {
    if (isGap(i) || isGap(i + 1)) continue;

    const a = i * 2;           // current ring, edge 1
    const b = i * 2 + 1;       // current ring, edge 2
    const c = (i + 1) * 2;     // next ring,    edge 1
    const d = (i + 1) * 2 + 1; // next ring,    edge 2

    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}


/** Builds and returns the full Three.js scene for the given track. */
export function setupScene(trackManager: TrackManager) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 300);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
  mainLight.position.set(50, 100, 50); mainLight.castShadow = true;
  mainLight.shadow.camera.top = 100; mainLight.shadow.camera.bottom = -100;
  mainLight.shadow.camera.left = -100; mainLight.shadow.camera.right = 100;
  mainLight.shadow.mapSize.width = 2048; mainLight.shadow.mapSize.height = 2048;
  scene.add(mainLight);
  const ambientLight = new THREE.AmbientLight(0x555555); scene.add(ambientLight);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ color: 0x3d8c40 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.2;
  plane.receiveShadow = true;
  scene.add(plane);

  const halfW = trackManager.config.width / 2;

  // Road surface
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, side: THREE.DoubleSide });
  const roadGeo = createQuadStrip(trackManager.config.curve, -halfW, 0, halfW, 0);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // Dashed centre-line
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const laneGeo = createQuadStrip(trackManager.config.curve, -0.3, 0.02, 0.3, 0.02, true);
  scene.add(new THREE.Mesh(laneGeo, laneMat));

  // Barrier walls — DoubleSide prevents clipping artefacts on tight bends.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide });
  const innerW = new THREE.Mesh(createQuadStrip(trackManager.config.curve, -halfW, 0, -halfW, 2.5), wallMat);
  innerW.castShadow = true; innerW.receiveShadow = true; scene.add(innerW);
  const outerW = new THREE.Mesh(createQuadStrip(trackManager.config.curve, halfW, 0, halfW, 2.5), wallMat);
  outerW.castShadow = true; outerW.receiveShadow = true; scene.add(outerW);

  // Finish line — placed at points[0] with orientation derived from getStartData
  // so it matches exactly the t=0 position used by the lap tracker.
  const { centre: startCentre, tangent: startTangent } = trackManager.getStartData();
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(trackManager.config.width, 4),
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  finishLine.position.set(startCentre.x, 0.03, startCentre.z);
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.rotation.z = Math.atan2(-startTangent.x, -startTangent.z);
  finishLine.receiveShadow = true;
  scene.add(finishLine);

  // Scatter traffic cones across the track surface.
  const cones: THREE.Mesh[] = [];
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6600 });
  const coneGeo = new THREE.ConeGeometry(1, 2, 16);
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const p = trackManager.config.curve.getPointAt(t);
    const tangent = trackManager.config.curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const offset = (Math.random() * (trackManager.config.width / 2 - 3)) * (Math.random() > 0.5 ? 1 : -1);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(p).add(normal.multiplyScalar(offset));
    cone.position.y = 1; cone.castShadow = true;
    cone.userData = { velocity: new THREE.Vector3(0, 0, 0), isHit: false };
    scene.add(cone); cones.push(cone);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, cones, mainLight, ambientLight, fog: scene.fog as THREE.Fog };
}