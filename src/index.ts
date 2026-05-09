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

// ─── Rail Path ───────────────────────────────────────────────────────────────
function buildRailPath(world: Awaited<ReturnType<typeof World.create>>) {
  const railData = [
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0.3, z: -10 },
    { x: -0.5, y: -0.2, z: -20 },
    { x: 0, y: 0.5, z: -30 },
    { x: 1.0, y: 0, z: -40 },
    { x: -1.0, y: 0.3, z: -50 },
    { x: 0.5, y: -0.3, z: -60 },
    { x: 0, y: 0, z: -70 },
    { x: -0.5, y: 0.5, z: -80 },
    { x: 0.5, y: 0, z: -90 },
    { x: 0, y: 0, z: -200 },
  ];

  railData.forEach((pt, i) => {
    const entity = world.createTransformEntity();
    entity.object3D!.position.set(pt.x, pt.y, pt.z);
    entity.addComponent(RailPoint, { order: i / (railData.length - 1) });
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
  const tunnelRadius = 2.5;
  const segmentsPerRing = 16;
  const ringSpacing = 3.0;

  // Spawn initial rings to fill the first portion of tunnel
  // More rings will be spawned dynamically as player moves
  const totalRings = 20;
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

function spawnTunnelWalls(world: Awaited<ReturnType<typeof World.create>>) {
  const tunnelRadius = 2.5;
  const sectionLength = 50;
  const sections = 5;

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
      color: 0x220022,
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
    });

    const sectionMesh = new Mesh(sectionGeometry, sectionMaterial);
    const sectionEntity = world.createTransformEntity(sectionMesh, { persistent: false });
    sectionEntity.object3D!.position.set(0, 0, -s * sectionLength);
  }
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
  // Start dynamic spawning from ring 20 (rings 0-19 are pre-spawned)
  tunnelSystem?.rebuild(20);

  const audioSystem = world.getSystem(AudioReactorSystem);
  const fxSystem = world.getSystem(PsychedelicFXSystem);

  // ── Wire audio energy → visual intensity ──────────────────────────────
  // Each frame, feed AudioReactor's energy into PsychedelicFX's intensity config
  if (audioSystem && fxSystem) {
    // We override the PsychedelicFX update to inject audio energy before calling
    // the original update logic, creating a clean reactive signal path
    const originalUpdate = (fxSystem as any).update.bind(fxSystem);
    (fxSystem as any).update = (delta: number, time: number) => {
      // Feed audio energy signal into the effects intensity
      (fxSystem.config.intensity as any).value = audioSystem.energy.value;
      originalUpdate(delta, time);
    };
  }

  // ── Audio init (requires user gesture for browser autoplay compliance) ──
  if (audioSystem) {
    const startAudio = async () => {
      audioSystem.initAudioContext();
      // Place your track in public/audio/ and uncomment:
      await audioSystem.loadSoundtrack("/audio/01-enter-one.wav");
      audioSystem.play();
      audioSystem.setGain(0.75);
      console.log(
        "[Vortexr] Audio ready. Drop a track in public/audio/ and uncomment to enable.",
      );
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
