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
import { ShaderMaterial, BufferAttribute } from "three";

import { TunnelRing } from "./systems/TunnelGenerator.js";
import {
  RailPoint,
  TouchableGeometry,
  PsychedelicMaterial,
  AudioParticleEmitter,
} from "./components/VortexrComponents.js";
import { RailMovementSystem } from "./systems/RailMovement.js";
import { AudioReactorSystem } from "./systems/AudioReactor.js";
import { AudioAnalyzerSystem } from "./systems/AudioAnalyzer.js";
import { TunnelGeneratorSystem } from "./systems/TunnelGenerator.js";
import { GeometryTouchSystem } from "./systems/GeometryTouch.js";
import { PsychedelicFXSystem } from "./systems/PsychedelicFX.js";
import { TUNNEL_SHADERS, type TunnelShader } from "./shaders/TunnelShaders.js";

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

// ─── Initial Tunnel Rings ────────────────────────────────────────────────────
const AUDIO_PARAMS = [
  "lowpass_freq",
  "highpass_freq",
  "delay_feedback",
  "delay_time",
];

// Uses merged geometry — one LineSegments per ring = 1 draw call per ring.
const SPIRAL_STEP = 0.4;
const SPIRAL_RADIUS = 2.3;

function spawnInitialTunnel(world: Awaited<ReturnType<typeof World.create>>) {
  const tunnelRadius = 3.0;
  const segmentsPerRing = 6;
  const ringSpacing = 10.0;
  const totalRings = 15;

  for (let ringIdx = 0; ringIdx < totalRings; ringIdx++) {
    const z = -ringIdx * ringSpacing;
    const hue = (ringIdx * 0.05) % 1.0;
    const spiralAngle = ringIdx * SPIRAL_STEP;
    const cx = Math.cos(spiralAngle) * SPIRAL_RADIUS;
    const cy = Math.sin(spiralAngle) * SPIRAL_RADIUS;

    const lines = buildMergedRing(segmentsPerRing, tunnelRadius);
    lines.position.set(cx, cy, z);
    lines.lookAt(0, 0, 1000);

    const entity = world.createTransformEntity(lines, { persistent: false });
    entity.addComponent(TunnelRing, { ringIndex: ringIdx, baseHue: hue * 360, persistent: ringIdx % 8 === 0 });
    entity.addComponent(TouchableGeometry, { audioParam: AUDIO_PARAMS[ringIdx % AUDIO_PARAMS.length], touchValue: 1.0, decayRate: 1.5, currentValue: 0.0 });
    entity.addComponent(PsychedelicMaterial, { baseHue: hue * 360, hueShiftRange: 60, pulseAmplitude: 0.08, opacityRange: [0.3, 0.95, 0.3, 0.95] });
    entity.addComponent(AudioParticleEmitter, { burstCount: 30, triggerThreshold: 0.5, cooldown: 0.1, particleColor: [1, 1, 1, 1], lifetime: 1.2, speed: 4.0 });
  }
}

function buildMergedRing(numSegs: number, radius: number): LineSegments {
  const positions: number[] = [];
  for (let i = 0; i < numSegs; i++) {
    const angle = (i / numSegs) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const shapeType = i % 4;
    const segGeom = createGeometryBuffer(shapeType, x, y);
    const edgeGeom = new EdgesGeometry(segGeom);
    segGeom.dispose();
    const pos = edgeGeom.attributes["position"];
    for (let j = 0; j < pos.count; j++) {
      positions.push(pos.getX(j), pos.getY(j), pos.getZ(j));
    }
    edgeGeom.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new Float32BufferAttribute(Float32Array.from(positions), 3));
  return new LineSegments(merged, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
}

function createGeometryBuffer(shapeType: number, x: number, y: number) {
  let geom: import("three").BufferGeometry;
  switch (shapeType) {
    case 0: geom = new BoxGeometry(1.2, 1.2, 0.3, 1, 1, 1); break;
    case 1: geom = new SphereGeometry(0.7, 5, 4); break;
    case 2: geom = new TorusGeometry(0.8, 0.15, 4, 6); break;
    default: geom = new OctahedronGeometry(0.9, 0);
  }
  geom.translate(x, y, 0);
  return geom;
}

// Track wall shader materials for uniform updates
const wallMaterials: ShaderMaterial[] = [];

function spawnTunnelWalls(world: Awaited<ReturnType<typeof World.create>>, shader: TunnelShader) {
  const tunnelRadius = 3.0;
  const totalLength = 15000; // 300 sections x 50 units each

  // One single merged cylinder — 1 draw call instead of 300
  const sectionGeometry = new CylinderGeometry(
    tunnelRadius * 1.2,
    tunnelRadius * 1.2,
    totalLength,
    24,
    1,
    true
  );

  sectionGeometry.rotateX(Math.PI / 2);
  sectionGeometry.translate(0, 0, -totalLength / 2);

  const sectionMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBeatIntensity: { value: 0 },
    },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    side: DoubleSide,
    transparent: true,
  });

  const sectionMesh = new Mesh(sectionGeometry, sectionMaterial);
  const sectionEntity = world.createTransformEntity(sectionMesh, { persistent: false });
  sectionEntity.object3D!.position.set(0, 0, 0);
  wallMaterials.push(sectionMaterial);
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
    .registerSystem(AudioAnalyzerSystem)
    .registerSystem(RailMovementSystem)
    .registerSystem(TunnelGeneratorSystem)
    .registerSystem(GeometryTouchSystem)
    .registerSystem(PsychedelicFXSystem);

  buildRailPath(world);
  // Level 0 = Aurora shader
  spawnTunnelWalls(world, TUNNEL_SHADERS[0]);

  // Rebuild systems now that entities exist
  const railSystem = world.getSystem(RailMovementSystem) as RailMovementSystem | undefined;
  railSystem?.rebuild();
  const tunnelSystem = world.getSystem(TunnelGeneratorSystem) as TunnelGeneratorSystem | undefined;
  // Start dynamic spawning from ring 15
  tunnelSystem?.rebuild(15);

  // All systems fetched early so we can wire them in any order
  const audioSystem = world.getSystem(AudioReactorSystem) as AudioReactorSystem | undefined;
  const analyzerSystem = world.getSystem(AudioAnalyzerSystem) as AudioAnalyzerSystem | undefined;
  const fxSystem = world.getSystem(PsychedelicFXSystem) as PsychedelicFXSystem | undefined;

  // Wire AudioReactor → AudioAnalyzer for VisualDNA generation
  audioSystem?.setAnalyzer(analyzerSystem!);

  // Wire Analyzer → TunnelGenerator for DNA-driven spawning
  tunnelSystem?.setAnalyzer(analyzerSystem!);

  // Wire Analyzer → PsychedelicFX for DNA-driven shader selection
  fxSystem?.setAnalyzer(analyzerSystem!);

  // Wire Analyzer → GeometryTouch for DNA-driven touch sensitivity
  const touchSystem = world.getSystem(GeometryTouchSystem) as GeometryTouchSystem | undefined;
  touchSystem?.setAnalyzer(analyzerSystem!);

  // Wire up loop callback for continuous ride
  railSystem!.onLoop = () => {};

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

  // ── Update tunnel wall shader uniforms each frame ─────────────────────
  let wallTime = 0;
  const wallUpdate = (delta: number) => {
    wallTime += delta / 1000;
    const beatInt = audioSystem ? (audioSystem as AudioReactorSystem).beatIntensity.value : 0;
    for (const mat of wallMaterials) {
      mat.uniforms.uTime.value = wallTime;
      mat.uniforms.uBeatIntensity.value = beatInt;
    }
  };
  // Hook into render loop via a simple polyfill
  const _origUpdate = (world as any).update?.bind(world);
  (world as any).update = function(delta: number, time: number) {
    wallUpdate(delta);
    _origUpdate?.(delta, time);
  };

  console.log("[Vortexr] Systems:", [
    "AudioReactorSystem — FFT + effect chain + touch modulation",
    "RailMovementSystem — CatmullRom spline camera",
    "TunnelGeneratorSystem — procedural wireframe geometry rings",
    "GeometryTouchSystem — proximity hand detection + audio param firing",
    "PsychedelicFXSystem — hue/scale/opacity/particles driven by energy",
  ]);
});
