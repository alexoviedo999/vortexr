/**
 * Vortexr — Rail-based audio-reactive XR experience
 * Immersive Web SDK + Three.js ECS
 *
 * Fly through abstract geometric tunnels. Touch geometry to trigger
 * psychedelic visual mutations and morph the reactive soundtrack.
 */

import {
  World,
  SessionMode,
  AssetManifest,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
  SphereGeometry,
  TorusGeometry,
  OctahedronGeometry,
  EdgesGeometry,
  LineSegments,
  Vector3,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  CylinderGeometry,
} from "@iwsdk/core";

import { TunnelSegment } from "./systems/TunnelGenerator.js";
import {
  RailPoint,
  TouchableGeometry,
  PsychedelicMaterial,
  AudioParticleEmitter,
} from "./components/VortexrComponents.js";
import { RailMovementSystem } from "./systems/RailMovement.js";
import { AudioReactorSystem } from "./systems/AudioReactor.js";
import { TunnelGeneratorSystem } from "./systems/TunnelGenerator.js";
import { GeometryTouchSystem } from "./systems/GeometryTouch.js";
import { PsychedelicFXSystem } from "./systems/PsychedelicFX.js";

// ─── Assets ───────────────────────────────────────────────────────────────────
const assets: AssetManifest = {};

// Rail path data - z values will be scaled to song length later
// x/y kept at 0 to keep player centered in tunnel (no curved drift)
const BASE_PATH_LENGTH = 2500;
const BASE_PATH = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: -125 },
  { x: 0, y: 0, z: -250 },
  { x: 0, y: 0, z: -375 },
  { x: 0, y: 0, z: -500 },
  { x: 0, y: 0, z: -750 },
  { x: 0, y: 0, z: -1000 },
  { x: 0, y: 0, z: -1250 },
  { x: 0, y: 0, z: -1500 },
  { x: 0, y: 0, z: -1750 },
  { x: 0, y: 0, z: -2500 },
];

function buildRailPath(world: Awaited<ReturnType<typeof World.create>>) {
  const songDur = (world.getSystem(AudioReactorSystem) as AudioReactorSystem | undefined)?.songDuration.value ?? 394;
  // Speed 3.0 units/sec × song duration = total path distance
  const scaledLength = songDur * 3.0;

  BASE_PATH.forEach((pt, i) => {
    const entity = world.createTransformEntity();
    // Scale z to match scaledLength
    entity.object3D!.position.set(pt.x * 0.5, pt.y * 0.5, (pt.z / BASE_PATH_LENGTH) * scaledLength);
    entity.addComponent(RailPoint, { order: i / (BASE_PATH.length - 1) });
  });
}

// ─── Initial Tunnel Segments ──────────────────────────────────────────────────
// Each shape type maps to a different audio effect parameter so every
// section of the tunnel sculpts the sound differently.
const AUDIO_PARAMS = [
  "lowpass_freq",
  "highpass_freq",
  "delay_feedback",
  "delay_time",
];

function spawnInitialTunnel(world: Awaited<ReturnType<typeof World.create>>) {
  const tunnelRadius = 2.0;
  const segmentsPerRing = 8;
  const ringSpacing = 3.0;

  // Spawn initial rings to fill the first portion of tunnel
  // More rings will be spawned dynamically as player moves
  const totalRings = 15;
  for (let ringIdx = 0; ringIdx < totalRings; ringIdx++) {
    for (let i = 0; i < segmentsPerRing; i++) {
      const angle = (i / segmentsPerRing) * Math.PI * 2;
      const shapeIdx = i % 4;
      const baseGeom = createGeometry(shapeIdx);
      const edges = new EdgesGeometry(baseGeom);
      baseGeom.dispose();

      const hue = ((angle / (Math.PI * 2)) + ringIdx * 0.02) % 1.0;
      const material = new MeshBasicMaterial({
        color: new Color().setHSL(hue, 1.0, 0.5),
        transparent: true,
        opacity: 0.7,
      });

      const lines = new LineSegments(edges, material);
      lines.position.set(
        Math.cos(angle) * tunnelRadius,
        Math.sin(angle) * tunnelRadius,
        -ringIdx * ringSpacing,
      );
      lines.lookAt(0, 0, 1000);

      const entity = world.createTransformEntity(lines, { persistent: false });
      entity.addComponent(TunnelSegment, { shapeType: shapeIdx, scale: 1.0, ringIndex: ringIdx, baseHue: hue * 360 });
      entity.addComponent(TouchableGeometry, { audioParam: AUDIO_PARAMS[i % AUDIO_PARAMS.length], touchValue: 1.0, decayRate: 1.5, currentValue: 0.0 });
      entity.addComponent(PsychedelicMaterial, { baseHue: hue * 360, hueShiftRange: 60, pulseAmplitude: 0.08, opacityRange: [0.3, 0.95, 0.3, 0.95] });
      entity.addComponent(AudioParticleEmitter, { burstCount: 30, triggerThreshold: 0.5, cooldown: 0.1, particleColor: [1, 1, 1, 1], lifetime: 1.2, speed: 4.0 });
    }
  }
}

function createGeometry(shapeType: number) {
  switch (shapeType) {
    case 0: return new BoxGeometry(1.2, 1.2, 0.3, 1, 1, 1);
    case 1: return new SphereGeometry(0.7, 5, 4);
    case 2: return new TorusGeometry(0.8, 0.15, 4, 6);
    default: return new OctahedronGeometry(0.9, 0);
  }
}

// Track tunnel wall entities for cleanup on loop
const tunnelWallEntities: any[] = [];

function spawnTunnelWalls(world: Awaited<ReturnType<typeof World.create>>) {
  const tunnelRadius = 2.5;
  const sectionLength = 50;
  const sections = 300;  // 300 x 50 = 15000 units - matches rail path length

  for (let s = 0; s < sections; s++) {
    const sectionGeometry = new CylinderGeometry(
      tunnelRadius * 1.2,
      tunnelRadius * 1.2,
      sectionLength,
      24,
      1,
      true
    );

    sectionGeometry.rotateX(Math.PI / 2);
    sectionGeometry.translate(0, 0, -sectionLength / 2);

    const sectionMaterial = new MeshBasicMaterial({
      color: 0x000000,
      side: DoubleSide,
      transparent: true,
      opacity: 0.8,
    });

    const sectionMesh = new Mesh(sectionGeometry, sectionMaterial);
    const sectionEntity = world.createTransformEntity(sectionMesh, { persistent: false });
    sectionEntity.object3D!.position.set(0, 0, -s * sectionLength);
    tunnelWallEntities.push(sectionEntity);
  }
}

function repositionTunnelWalls() {
  const sectionLength = 50;
  for (let s = 0; s < tunnelWallEntities.length; s++) {
    tunnelWallEntities[s].object3D!.position.set(0, 0, -s * sectionLength);
  }
}

// Extend repositioning for 2500-unit loop
function resetForLoop() {
  repositionTunnelWalls();
}

// ─── World Bootstrap ──────────────────────────────────────────────────────────
const container = document.getElementById("scene-container") as HTMLDivElement;

World.create(container, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: false },
  },
  features: {
    locomotion: { useWorker: true },
    grabbing: false,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then(async (world) => {
  // Black background
  (world.scene as any).background = 0x000000;
  // Ensure renderer also has black clear color
  if ((world.renderer as any).setClearColor) {
    (world.renderer as any).setClearColor(0x000000);
  }

  world
    .registerSystem(AudioReactorSystem)
    .registerSystem(RailMovementSystem)
    .registerSystem(TunnelGeneratorSystem)
    .registerSystem(GeometryTouchSystem)
    .registerSystem(PsychedelicFXSystem);

  buildRailPath(world);
  spawnInitialTunnel(world);
  spawnTunnelWalls(world);

  // Rebuild systems now that entities exist
  const railSystem = world.getSystem(RailMovementSystem) as RailMovementSystem | undefined;
  railSystem?.rebuild();
  const tunnelSystem = world.getSystem(TunnelGeneratorSystem) as TunnelGeneratorSystem | undefined;
  // Start dynamic spawning from ring 15
  tunnelSystem?.rebuild(15);

  // Wire up loop callback for continuous ride
  railSystem!.onLoop = () => {
    repositionTunnelWalls();
  };

  const audioSystem = world.getSystem(AudioReactorSystem);
  const fxSystem = world.getSystem(PsychedelicFXSystem);

  // ── Sync rail path length to song duration ──────────────────────────
  if (audioSystem && railSystem) {
    // Wait for audio to load, then set path length
    const syncPathLength = () => {
      const pathLen = (audioSystem as AudioReactorSystem).pathLength.value;
      (railSystem.config.pathLength as any).value = pathLen;
      console.log("[Vortexr] pathLength set to:", pathLen);
    };
    // Path length is set after audio loads; call after loadSoundtrack resolves
    setTimeout(syncPathLength, 100);
  }

  // ── Wire audio energy → visual intensity ──────────────────────────────
  if (audioSystem && fxSystem) {
    console.log("[Vortexr] Wiring audioSystem → fxSystem + tunnelSystem");
    let lastBeatDetected = false;
    let totalBeats = 0;
    const originalUpdate = (fxSystem as any).update.bind(fxSystem);
    (fxSystem as any).update = (delta: number, time: number) => {
      (fxSystem.config.intensity as any).value = audioSystem.energy.value;
      // Use AudioReactor's beatIntensity signal - it stays at 1.0 for the whole frame
      (fxSystem.config.beatIntensity as any).value = audioSystem.beatIntensity.value;

      // Rising edge detect: beatDetected just turned true this frame
      if (audioSystem.beatDetected.value && !lastBeatDetected) {
        totalBeats++;
        tunnelSystem?.triggerBeatSpawn();
        console.log("[Vortexr] Beat #" + totalBeats + " triggered spawn, ringIndex=" + ((tunnelSystem as any).highestRingSpawned + 1));
      }
      lastBeatDetected = audioSystem.beatDetected.value;

      originalUpdate(delta, time);
    };
  } else {
    console.log("[Vortexr] WARNING: audioSystem=" + !!audioSystem + " fxSystem=" + !!fxSystem);
  }

  // ── Audio init ──
  if (audioSystem) {
    const startAudio = async () => {
      audioSystem.initAudioContext();
      await audioSystem.loadSoundtrack("/audio/01-enter-one.wav");
      audioSystem.play();
      audioSystem.setGain(0.75);
      document.removeEventListener("click", startAudio);
      document.removeEventListener("xr-start", startAudio);
    };
    document.addEventListener("click", startAudio);
    document.addEventListener("xr-start", startAudio);
  }

  console.log("[Vortexr] Systems:", [
    "AudioReactorSystem — FFT + effect chain + touch modulation",
    "RailMovementSystem — CatmullRom spline camera",
    "TunnelGeneratorSystem — procedural wireframe geometry rings",
    "GeometryTouchSystem — proximity hand detection + audio param firing",
    "PsychedelicFXSystem — hue/scale/opacity/particles driven by energy",
  ]);
});
