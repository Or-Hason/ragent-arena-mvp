import * as THREE from 'three';
import { InputRouter } from './input';
import { setupScene } from './scene';
import { Vehicle } from './vehicle';
import { AudioEngine } from './audio';
import { NPCController } from './npc';
import { TrackManager } from './track';
import { runCountdown } from './countdown';

const defaultSettings = { track: 'ring', color: '#ff2222', vol: '0.5', sens: '2.5', time: '0' };
const savedTrack = localStorage.getItem('g923_track') || defaultSettings.track;
const savedColor = localStorage.getItem('g923_color') || defaultSettings.color;
const savedVol = localStorage.getItem('g923_vol') || defaultSettings.vol;
const savedSens = localStorage.getItem('g923_sens') || defaultSettings.sens;
const savedTime = localStorage.getItem('g923_time') || defaultSettings.time;
const savedTarget = localStorage.getItem('g923_target') || '100';

function saveSetting(key: string, value: string) { localStorage.setItem(`g923_${key}`, value); }

const trackManager = new TrackManager(savedTrack);
const inputManager = new InputRouter();
const { scene, camera, renderer, cones, mainLight, ambientLight, fog } = setupScene(trackManager);

const pStart = trackManager.getStartData(false);
const nStart = trackManager.getStartData(true);

const car = new Vehicle(scene, trackManager, savedColor, pStart.pos, pStart.angle);
car.turnSpeed = parseFloat(savedSens);
const npc = new NPCController(scene, trackManager, '#0055ff', nStart.pos, nStart.angle);

const audioEngine = new AudioEngine();
audioEngine.setVolume(parseFloat(savedVol));
const clock = new THREE.Clock();

const uiEl = document.getElementById('ui')!; const menuEl = document.getElementById('menu')!;
const endScreenEl = document.getElementById('end-screen')!; const endTitleEl = document.getElementById('end-title')!;
const endSubtitleEl = document.getElementById('end-subtitle')!;
const startBtn = document.getElementById('start-btn')!; const restartBtn = document.getElementById('restart-btn')!;
const resetBtn = document.getElementById('reset-btn')!; const backBtn = document.getElementById('back-btn')!;
const speedTextEl = document.getElementById('speed-text')!; const needleEl = document.getElementById('needle')!;
const playerStatsEl = document.getElementById('player-stats')!; const npcStatsEl = document.getElementById('npc-stats')!;
const mmPlayer = document.getElementById('mm-player')!; const mmNpc = document.getElementById('mm-npc')!;
const wrongWayEl = document.getElementById('wrong-way-warning')!;

const trackSelect = document.getElementById('track-select') as HTMLSelectElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const volSlider = document.getElementById('vol-slider') as HTMLInputElement;
const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
const targetSlider = document.getElementById('target-slider') as HTMLInputElement;
const targetLabel = document.getElementById('target-label')!;

trackSelect.value = savedTrack; colorPicker.value = savedColor; volSlider.value = savedVol;
sensSlider.value = savedSens; timeSlider.value = savedTime;
targetSlider.value = savedTarget; targetLabel.textContent = savedTarget;
let scoreTarget = parseInt(savedTarget, 10);
endSubtitleEl.textContent = `First to ${scoreTarget} points.`;

import { drawSpeedoGauge } from './hud';
drawSpeedoGauge();

function updateEnvironmentLighting(timeValue: number) {
  const r = THREE.MathUtils.lerp(135, 5, timeValue); const g = THREE.MathUtils.lerp(206, 5, timeValue); const b = THREE.MathUtils.lerp(235, 15, timeValue);
  const skyColor = new THREE.Color(`rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`);
  scene.background = skyColor; fog.color = skyColor;
  mainLight.intensity = THREE.MathUtils.lerp(1.2, 0.05, timeValue); ambientLight.intensity = THREE.MathUtils.lerp(1.0, 0.1, timeValue);
  const hp = timeValue > 0.5 ? 1 : 0; autoHeadlights = hp; updateHeadlights();
}
let autoHeadlights = 0;
let manualHeadlights = false;
function updateHeadlights() {
  const on = autoHeadlights === 1 || manualHeadlights ? 1 : 0;
  car.setHeadlights(on); npc.car.setHeadlights(on);
}
updateEnvironmentLighting(parseFloat(savedTime));
setTimeout(() => { menuEl.style.opacity = '1'; }, 50);

trackSelect.addEventListener('change', (e) => { saveSetting('track', (e.target as HTMLSelectElement).value); location.reload(); });
colorPicker.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; car.setColor(v); saveSetting('color', v); });
volSlider.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; audioEngine.setVolume(parseFloat(v)); saveSetting('vol', v); });
sensSlider.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; car.turnSpeed = parseFloat(v); saveSetting('sens', v); });
timeSlider.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; updateEnvironmentLighting(parseFloat(v)); saveSetting('time', v); });
targetSlider.addEventListener('input', (e) => {
  const v = (e.target as HTMLInputElement).value; scoreTarget = parseInt(v, 10);
  targetLabel.textContent = v; endSubtitleEl.textContent = `First to ${v} points.`;
  saveSetting('target', v);
});
resetBtn.addEventListener('click', () => { localStorage.clear(); location.reload(); });
restartBtn.addEventListener('click', () => { location.reload(); });

let isGameStarted = false; let isGameOver = false;
let isRaceActive = false; // True only after countdown finishes
let hasRaceStartedOnce = false; // Track if it's a first start or resume
let wrongWayTimer = 0; // Timer for driving wrong way before alerting

/**
 * Divides the track into 4 checkpoints (zones 1–4 at t=0/0.25/0.5/0.75).
 * A lap is credited when the car crosses back through zone 1 AFTER having
 * passed through zones 2, 3 and 4 — i.e. the finish line is at t=0.
 * expectedZone starts at 2 so cars spawning in zone 1 don't score instantly.
 */
class LapTracker {
  expectedZone = 2; laps = 0; score = 0;
  checkProgress(t: number) {
    const zone = t >= 0.75 ? 4 : t >= 0.5 ? 3 : t >= 0.25 ? 2 : 1;
    if (zone !== this.expectedZone) return;
    if (this.expectedZone === 1) {
      // Crossed the start/finish line after a full lap.
      this.laps++; this.score += 10;
      this.expectedZone = 2;
    } else {
      this.expectedZone = this.expectedZone === 4 ? 1 : this.expectedZone + 1;
    }
  }
}
const pTracker = new LapTracker(); const nTracker = new LapTracker();

const keyboardHintEl = document.getElementById('keyboard-hint');

startBtn.addEventListener('click', async () => {
  audioEngine.init(); audioEngine.resumeContext(); isGameStarted = true;
  menuEl.style.opacity = '0'; setTimeout(() => { menuEl.style.display = 'none'; }, 300); uiEl.style.display = 'block';

  // Show keyboard hint, then fade it out after 6s
  if (keyboardHintEl) {
    keyboardHintEl.classList.remove('hidden');
    setTimeout(() => keyboardHintEl.classList.add('hidden'), 6000);
  }

  // Only show countdown for the first start (not resume)
  if (!hasRaceStartedOnce) {
    hasRaceStartedOnce = true;
    await runCountdown((isGo) => audioEngine.playCountdownSound(isGo));
  }
  isRaceActive = true;
  backBtn.style.display = 'block';

  // After first start, button text changes to "Resume" for when they re-open menu
  startBtn.textContent = startBtn.getAttribute('data-resume-text') || 'Resume';
});

backBtn.addEventListener('click', () => {
  isGameStarted = false; isRaceActive = false;
  menuEl.style.display = 'flex'; setTimeout(() => { menuEl.style.opacity = '1'; }, 10);
  uiEl.style.display = 'none'; car.velocity = 0; audioEngine.updateEngineSound(0, 0, 0, 0, 0, false);
  audioEngine.pauseContext();
  backBtn.style.display = 'none';
  // Re-show hint for next session
  if (keyboardHintEl) keyboardHintEl.classList.remove('hidden');
});

const smokeParticles: THREE.Mesh[] = []; const smokeGeo = new THREE.PlaneGeometry(1.5, 1.5); const smokeMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6, depthWrite: false });
const skidMarks: THREE.Mesh[] = []; const skidGeo = new THREE.PlaneGeometry(0.5, 0.8); const skidMat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.8, depthWrite: false });

function handleCarCollisions() {
  const dist = car.mesh.position.distanceTo(npc.car.mesh.position);
  if (dist < 4.0) {
    const tempVel = car.velocity; car.velocity = npc.car.velocity * 0.8; npc.car.velocity = tempVel * 0.8;
    const pushVec = car.mesh.position.clone().sub(npc.car.mesh.position).normalize();
    car.mesh.position.addScaledVector(pushVec, 0.5); npc.car.mesh.position.addScaledVector(pushVec, -0.5);
    audioEngine.playCrashSound(Math.max(Math.abs(car.velocity), 10));
  }
}

let mmScale = 1; let mmCx = 0; let mmCz = 0;
function drawMinimap() {
  const canvas = document.getElementById('minimap-track') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  trackManager.points.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; });
  const trackWidth = maxX - minX; const trackHeight = maxZ - minZ;
  mmScale = 120 / Math.max(trackWidth, trackHeight); mmCx = (minX + maxX) / 2; mmCz = (minZ + maxZ) / 2;
  ctx.clearRect(0, 0, 150, 150); ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = Math.max(2, (trackManager.config.width * mmScale) * 0.5);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([5, 5]);
  ctx.beginPath();
  trackManager.points.forEach((p, i) => { const x = 75 + (p.x - mmCx) * mmScale; const y = 75 + (p.z - mmCz) * mmScale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.closePath(); ctx.stroke();
}
drawMinimap();

function updateMinimap() {
  mmPlayer.style.left = `${75 + (car.mesh.position.x - mmCx) * mmScale}px`; mmPlayer.style.top = `${75 + (car.mesh.position.z - mmCz) * mmScale}px`;
  mmNpc.style.left = `${75 + (npc.car.mesh.position.x - mmCx) * mmScale}px`; mmNpc.style.top = `${75 + (npc.car.mesh.position.z - mmCz) * mmScale}px`;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (isGameOver) return;

  const cameraOffset = new THREE.Vector3(0, 5, -8);
  // Look-around: rotate camera offset when Q/E/C held
  const aux = inputManager.getAuxInputs();
  let lookAngleShift = 0;
  if (aux.lookLeft) lookAngleShift = Math.PI / 2;
  if (aux.lookRight) lookAngleShift = -Math.PI / 2;
  if (aux.lookBack) lookAngleShift = Math.PI;
  cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), car.angle + lookAngleShift);
  camera.position.copy(car.mesh.position).add(cameraOffset);
  const lookAtTarget = new THREE.Vector3().copy(car.mesh.position); lookAtTarget.y += 1.5;
  lookAtTarget.add(new THREE.Vector3(0, 0, 3).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.angle + lookAngleShift));
  camera.lookAt(lookAtTarget);

  // NPC only drives when race is active (after countdown)
  if (isRaceActive) {
    const nImpact = npc.update(delta);
    if (nImpact > 5) audioEngine.playCrashSound(nImpact * 0.5);
  }

  handleCarCollisions();
  renderer.render(scene, camera);
  updateMinimap();

  if (!isGameStarted || !isRaceActive) return;

  // Update input-mode badge so the player knows which device is active
  const inputMode = inputManager.getMode();
  const modeBadgeEl = document.getElementById('input-mode-badge');
  if (modeBadgeEl) {
    if (inputMode === 'gamepad') {
      modeBadgeEl.textContent = '🎮 Wheel + ⌨️';
      modeBadgeEl.style.borderColor = '#ffaa00';
    } else {
      modeBadgeEl.textContent = '⌨️ Keyboard';
      modeBadgeEl.style.borderColor = '#00ccff';
    }
  }

  const inputs = inputManager.getInputs(delta);
  const pImpact = car.update(inputs, delta);
  if (pImpact > 5) audioEngine.playCrashSound(pImpact);

  // Auxiliary: horn & lights toggle
  audioEngine.setHorn(aux.horn);
  if (aux.toggleLights) { manualHeadlights = !manualHeadlights; updateHeadlights(); }

  // Skid logic (prevents noise/smoke on gentle reverse)
  const isSkidding = (inputs.brake > 0.4 && car.velocity > 15) || (inputs.throttle > 0.4 && car.velocity < -10);

  const distToNpc = car.mesh.position.distanceTo(npc.car.mesh.position);
  audioEngine.updateEngineSound(inputs.throttle, car.velocity, 0.6, npc.car.velocity, distToNpc, isSkidding);

  const pInfo = trackManager.getClosestInfo(car.mesh.position);
  const nInfo = trackManager.getClosestInfo(npc.car.mesh.position);
  pTracker.checkProgress(pInfo.t);
  nTracker.checkProgress(nInfo.t);

  // Wrong way detection with a 2-second grace period
  const trackTangent = trackManager.config.curve.getTangentAt(pInfo.t);
  const carForwardX = Math.sin(car.angle);
  const carForwardZ = Math.cos(car.angle);
  const dotForward = carForwardX * trackTangent.x + carForwardZ * trackTangent.z;

  if ((dotForward < -0.2 && car.velocity >= -2) || (dotForward > 0.2 && car.velocity < -5)) {
    wrongWayTimer += delta;
  } else {
    wrongWayTimer = 0;
  }

  if (wrongWayTimer > 2.0) {
    wrongWayEl.style.display = 'block';
  } else {
    wrongWayEl.style.display = 'none';
  }

  playerStatsEl.innerText = `Player | Score: ${pTracker.score} | Laps: ${pTracker.laps}`;
  npcStatsEl.innerText = `Rival  | Score: ${nTracker.score} | Laps: ${nTracker.laps}`;

  if (pTracker.score >= scoreTarget || nTracker.score >= scoreTarget) {
    isGameOver = true; uiEl.style.display = 'none'; endScreenEl.style.display = 'flex';
    setTimeout(() => { endScreenEl.style.opacity = '1'; }, 50);
    const isWin = pTracker.score >= scoreTarget;
    if (isWin) { endTitleEl.innerText = "YOU WIN!"; endTitleEl.style.color = "#44ff44"; }
    else { endTitleEl.innerText = "DEFEAT!"; endTitleEl.style.color = "#ff4444"; }
    audioEngine.stopEngines(); // Instantly kill engine/skid loops
    audioEngine.playEndSound(isWin);
    return;
  }

  const speedKmh = Math.abs(car.velocity * 3.6); speedTextEl.innerText = speedKmh.toFixed(0);
  const angle = -135 + (Math.min(speedKmh, 220) / 220) * 270; needleEl.style.transform = `rotate(${angle}deg)`;

  if (isSkidding) {
    const pMat = smokeMat.clone(); const particle = new THREE.Mesh(smokeGeo, pMat);
    particle.position.copy(car.mesh.position); particle.position.y = 0.5; particle.rotation.x = -Math.PI / 2; particle.rotation.z = Math.random() * Math.PI;
    scene.add(particle); smokeParticles.push(particle);

    const rearLeft = new THREE.Vector3(-1.2, 0.02, -1.5).applyMatrix4(car.mesh.matrixWorld);
    const rearRight = new THREE.Vector3(1.2, 0.02, -1.5).applyMatrix4(car.mesh.matrixWorld);
    [rearLeft, rearRight].forEach(pos => {
      const skid = new THREE.Mesh(skidGeo, skidMat); skid.position.copy(pos); skid.rotation.x = -Math.PI / 2; skid.rotation.z = car.angle;
      scene.add(skid); skidMarks.push(skid);
      if (skidMarks.length > 500) scene.remove(skidMarks.shift()!);
    });
  }

  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i]; p.scale.addScalar(delta * 2);
    const mat = p.material as THREE.MeshBasicMaterial; mat.opacity -= delta * 1.5;
    if (mat.opacity <= 0) { scene.remove(p); smokeParticles.splice(i, 1); }
  }

  const allCars = [{ c: car, isP: true }, { c: npc.car, isP: false }];
  cones.forEach(cone => {
    if (!cone.userData.isHit) {
      for (const item of allCars) {
        if (cone.position.distanceTo(item.c.mesh.position) < 2.5) {
          cone.userData.isHit = true;
          if (item.isP) pTracker.score++; else nTracker.score++;
          const hitDir = cone.position.clone().sub(item.c.mesh.position).normalize(); hitDir.y = 1.5;
          const impactForce = Math.max(15, Math.abs(item.c.velocity) * 0.8); cone.userData.velocity = hitDir.multiplyScalar(impactForce);
          audioEngine.playCrashSound(10);
          break;
        }
      }
    } else {
      cone.userData.velocity.y -= 40 * delta; cone.position.addScaledVector(cone.userData.velocity, delta);
      cone.rotation.x += 10 * delta; cone.rotation.z += 10 * delta;
      if (cone.position.y < 1) { cone.position.y = 1; cone.userData.velocity.set(0, 0, 0); cone.rotation.set(Math.PI / 2, 0, 0); }
    }
  });
}
animate();