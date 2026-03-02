import * as THREE from 'three';
import type { CarInputs } from './input';
import { TrackManager } from './track';

/** A single drivable car: chassis, wheels, brake lights, and headlights. */
export class Vehicle {
  public mesh: THREE.Group;
  public velocity = 0;
  public angle = 0;
  public turnSpeed = 2.5;
  /** Last known closest track-point index — used by getClosestInfo windowed search. */
  public trackIndex = -1;

  private acceleration = 25;
  private braking = 40;
  private reverseSpeed = 15;
  private friction = 5;
  private track: TrackManager;

  private wheels: THREE.Group[] = [];
  private frontWheels: THREE.Group[] = [];
  private wheelMeshes: THREE.Mesh[] = [];
  private brakeLightMat: THREE.MeshBasicMaterial;
  private chassisMat: THREE.MeshStandardMaterial;
  private leftSpot: THREE.SpotLight;
  private rightSpot: THREE.SpotLight;

  constructor(
    scene: THREE.Scene,
    track: TrackManager,
    initialColor: string,
    startPos: THREE.Vector3,
    startAngle: number
  ) {
    this.track = track;
    this.mesh = new THREE.Group();

    const geo = new THREE.BoxGeometry(2, 0.8, 4.5);
    this.chassisMat = new THREE.MeshStandardMaterial({ color: initialColor });
    const chassis = new THREE.Mesh(geo, this.chassisMat);
    chassis.position.y = 1.2; chassis.castShadow = true; this.mesh.add(chassis);

    const cabinGeo = new THREE.BoxGeometry(1.8, 0.6, 2);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.9, -0.2); this.mesh.add(cabin);

    this.brakeLightMat = new THREE.MeshBasicMaterial({ color: 0x440000 });
    const brakeLights = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.1), this.brakeLightMat);
    brakeLights.position.set(0, 1.4, -2.26); this.mesh.add(brakeLights);

    const headlights = new THREE.Group();
    this.leftSpot = new THREE.SpotLight(0xfff0e0, 0, 150, Math.PI / 6, 0.5, 1);
    this.leftSpot.position.set(-0.8, 1.3, 2.3); this.leftSpot.target.position.set(-0.8, 0, 20); this.leftSpot.castShadow = true;
    this.rightSpot = new THREE.SpotLight(0xfff0e0, 0, 150, Math.PI / 6, 0.5, 1);
    this.rightSpot.position.set(0.8, 1.3, 2.3); this.rightSpot.target.position.set(0.8, 0, 20); this.rightSpot.castShadow = true;
    headlights.add(this.leftSpot, this.leftSpot.target, this.rightSpot, this.rightSpot.target);
    this.mesh.add(headlights);

    const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.4, 32); wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
    const wheelPositions = [
      { x: -1.2, z: 1.5, front: true }, { x: 1.2, z: 1.5, front: true },
      { x: -1.2, z: -1.5, front: false }, { x: 1.2, z: -1.5, front: false },
    ];

    wheelPositions.forEach(pos => {
      const wheelGroup = new THREE.Group(); wheelGroup.position.set(pos.x, 0.6, pos.z);
      const tire = new THREE.Mesh(wheelGeo, wheelMat); tire.castShadow = true;
      tire.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.1, 0.1), rimMat));
      wheelGroup.add(tire); this.mesh.add(wheelGroup);
      this.wheels.push(wheelGroup); this.wheelMeshes.push(tire);
      if (pos.front) this.frontWheels.push(wheelGroup);
    });

    this.mesh.position.copy(startPos);
    this.angle = startAngle;
    this.mesh.rotation.y = this.angle;
    scene.add(this.mesh);
  }

  setColor(hexColor: string) { this.chassisMat.color.set(hexColor); }
  setHeadlights(intensity: number) {
    this.leftSpot.intensity = intensity * 100;
    this.rightSpot.intensity = intensity * 100;
  }

  /**
   * Advances physics by `delta` seconds. Returns the wall-impact force
   * (0 when not colliding) so callers can trigger crash sounds / rumble.
   */
  update(inputs: CarInputs, delta: number): number {
    let impactForce = 0;

    if (inputs.throttle > 0) this.velocity += inputs.throttle * this.acceleration * delta;
    if (inputs.brake > 0) {
      this.brakeLightMat.color.setHex(0xff0000);
      if (this.velocity > 0.5) this.velocity -= inputs.brake * this.braking * delta;
      else this.velocity -= inputs.brake * this.reverseSpeed * delta;
    } else {
      this.brakeLightMat.color.setHex(0x440000);
    }

    if (inputs.throttle === 0 && inputs.brake === 0) {
      if (Math.abs(this.velocity) < 0.5) this.velocity = 0;
      else if (this.velocity > 0) this.velocity = Math.max(0, this.velocity - this.friction * delta);
      else this.velocity = Math.min(0, this.velocity + this.friction * delta);
    }
    this.velocity = Math.max(-20, Math.min(this.velocity, 60));

    if (Math.abs(this.velocity) > 0.1) {
      const direction = this.velocity > 0 ? 1 : -1;
      this.angle -= inputs.steering * this.turnSpeed * delta * direction;
    }

    this.mesh.rotation.y = this.angle;
    this.mesh.position.x += Math.sin(this.angle) * this.velocity * delta;
    this.mesh.position.z += Math.cos(this.angle) * this.velocity * delta;

    // Wall collision — push the car back inside and reverse velocity.
    const info = this.track.getClosestInfo(this.mesh.position, this.trackIndex);
    this.trackIndex = info.index;
    if (info.distance > this.track.config.width / 2 - 1.5) {
      impactForce = Math.abs(this.velocity);
      this.velocity *= -0.5;
      const pushVec = info.point.clone().sub(this.mesh.position).normalize();
      this.mesh.position.addScaledVector(pushVec, 1.0);
    }

    // Wheel spin + front-wheel steering visuals.
    const wheelRot = (this.velocity * delta) / 0.6;
    this.wheelMeshes.forEach(tire => { tire.rotation.x -= wheelRot; });
    this.frontWheels.forEach(group => { group.rotation.y = -inputs.steering * (Math.PI / 3); });

    return impactForce;
  }
}