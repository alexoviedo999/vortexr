/**
 * Tunnel wall shader definitions — one per "level"
 * Each shader exports a manifest with name, uniforms, and GLSL source.
 */

export interface TunnelShader {
  name: string;
  vertexShader: string;
  fragmentShader: string;
}

const VERTEX_BASE = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Northern Lights — soft flowing color bands with gentle aurora motion */
export const SHADER_AURORA: TunnelShader = {
  name: "Aurora",
  vertexShader: VERTEX_BASE,
  fragmentShader: `
    uniform float uTime;
    uniform float uBeatIntensity;
    varying vec2 vUv;
    varying vec3 vNormal;

    vec3 auroraGrad(float t) {
      vec3 c1 = vec3(0.02, 0.12, 0.08);
      vec3 c2 = vec3(0.0, 0.55, 0.35);
      vec3 c3 = vec3(0.1, 0.3, 0.7);
      vec3 c4 = vec3(0.55, 0.0, 0.6);
      float t1 = clamp(t * 3.0, 0.0, 1.0);
      float t2 = clamp(t * 3.0 - 1.0, 0.0, 1.0);
      float t3 = clamp(t * 3.0 - 2.0, 0.0, 1.0);
      return mix(mix(c1, c2, t1), mix(c3, c4, t2), t3);
    }

    void main() {
      float wave1 = sin(vUv.y * 5.0 - uTime * 0.4) * 0.5 + 0.5;
      float wave2 = sin(vUv.y * 8.0 + vUv.x * 3.0 + uTime * 0.25) * 0.5 + 0.5;
      float wave3 = sin(vUv.y * 2.0 - uTime * 0.15 + vUv.x * 1.5) * 0.5 + 0.5;
      float combined = (wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25);
      vec3 col = auroraGrad(combined);
      float glow = 0.35 + uBeatIntensity * 0.5;
      gl_FragColor = vec4(col * glow, 0.75);
    }
  `,
};

/** Scanline Grid — retro high-contrast horizontal bands */
export const SHADER_SCANLINE: TunnelShader = {
  name: "Scanline",
  vertexShader: VERTEX_BASE,
  fragmentShader: `
    uniform float uTime;
    uniform float uBeatIntensity;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      float baseDark = 0.02;
      float beatBright = 0.6 + uBeatIntensity * 0.7;
      float scanline = step(0.5, fract(vUv.y * 40.0 + uTime * 1.5));
      float brightness = baseDark + beatBright * scanline;
      gl_FragColor = vec4(vec3(brightness), 0.95);
    }
  `,
};

/** Starfield — subtle twinkling dots on dark void */
export const SHADER_STARFIELD: TunnelShader = {
  name: "Starfield",
  vertexShader: VERTEX_BASE,
  fragmentShader: `
    uniform float uTime;
    uniform float uBeatIntensity;
    varying vec2 vUv;
    varying vec3 vNormal;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 grid = floor(vUv * vec2(60.0, 120.0));
      float star = step(0.985, hash(grid));
      float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + hash(grid) * 6.28);
      float brightness = 0.05 + star * twinkle * (0.6 + uBeatIntensity * 0.8);
      gl_FragColor = vec4(vec3(brightness), 0.8);
    }
  `,
};

/** Plasma Wave — smooth color-shifting plasma with beat pulses */
export const SHADER_PLASMA: TunnelShader = {
  name: "Plasma",
  vertexShader: VERTEX_BASE,
  fragmentShader: `
    uniform float uTime;
    uniform float uBeatIntensity;
    varying vec2 vUv;
    varying vec3 vNormal;

    void main() {
      float t = uTime * 0.3;
      float v1 = sin(vUv.y * 8.0 + t);
      float v2 = sin(vUv.y * 6.0 - t * 0.7 + vUv.x * 4.0);
      float v3 = sin(vUv.x * 10.0 + t * 0.5);
      float plasma = (v1 + v2 + v3) / 3.0;
      float hue = fract(plasma * 0.5 + 0.5 + uTime * 0.05);
      vec3 col;
      if (hue < 0.25) col = vec3(0.1, 0.0, 0.3);
      else if (hue < 0.5) col = vec3(0.0, 0.4, 0.6);
      else if (hue < 0.75) col = vec3(0.0, 0.6, 0.3);
      else col = vec3(0.5, 0.0, 0.5);
      float beatBoost = 0.6 + uBeatIntensity * 0.6;
      gl_FragColor = vec4(col * beatBoost, 0.9);
    }
  `,
};

export const TUNNEL_SHADERS: TunnelShader[] = [
  SHADER_AURORA,
  SHADER_SCANLINE,
  SHADER_STARFIELD,
  SHADER_PLASMA,
];
