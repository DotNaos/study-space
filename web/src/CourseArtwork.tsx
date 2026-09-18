import { useEffect, useMemo, useRef, useState } from "react";
import type { Course } from "./api";
import { courseImagePath } from "./course-library";

type ShaderPalette = {
  background: string;
  colors: [string, string, string];
};

type ShaderSpec = {
  seed: number;
  variant: number;
  palette: ShaderPalette;
};

const shaderPalettes: ShaderPalette[] = [
  { background: "#08101b", colors: ["#8395c8", "#b9a7d8", "#76b6bd"] },
  { background: "#130d18", colors: ["#b7819c", "#c39bc8", "#c3a66d"] },
  { background: "#071411", colors: ["#73a995", "#85b8ae", "#c2b47b"] },
  { background: "#0d1016", colors: ["#7895ad", "#9b8eb3", "#b78d74"] },
  { background: "#0d0d18", colors: ["#7d83b8", "#9c88bd", "#b88196"] },
  { background: "#0a1216", colors: ["#7aa7b4", "#93a6c3", "#8bb39b"] },
  { background: "#10130b", colors: ["#99aa74", "#b19b75", "#78a8a4"] },
  { background: "#160e10", colors: ["#b57d7f", "#b89582", "#9788b0"] },
  { background: "#0a0f12", colors: ["#7c8f99", "#8da5ad", "#aa9e8b"] },
  { background: "#100d14", colors: ["#9889a8", "#aa8492", "#8197ad"] },
];

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_seed;
uniform float u_variant;
uniform vec3 u_background;
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 19.17));
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 m = mat2(0.82, -0.57, 0.57, 0.82);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise2(p);
    p = m * p * 2.03 + 4.71;
    amplitude *= 0.5;
  }
  return value;
}

mat2 rotate2(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 first = mix(u_a, u_b, smoothstep(0.02, 0.58, t));
  return mix(first, u_c, smoothstep(0.52, 1.0, t) * 0.72);
}

vec3 softScreen(vec3 base, vec3 layer, float amount) {
  vec3 screened = 1.0 - (1.0 - base) * (1.0 - layer);
  return mix(base, screened, amount);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  float angle = (u_seed - 0.5) * 1.15;
  vec2 rp = rotate2(angle) * p;
  float n0 = fbm(rp * 1.15 + vec2(u_seed * 8.3, 2.1));
  float n1 = fbm(rp * 2.0 + vec2(5.7, u_seed * 6.4));
  vec3 color = u_background;

  // Silk / folded surface
  if (u_variant < 0.5) {
    float warp = fbm(rp * 1.25 + vec2(n1 * 1.7, n0 * 1.2));
    float fold = sin((rp.x * 1.28 + rp.y * 0.72 + warp * 1.6) * 2.6 + u_seed * 12.0);
    float shade = 0.5 + 0.5 * fold;
    shade = mix(shade, n0, 0.34);
    float highlight = pow(max(0.0, 1.0 - abs(fold)), 5.0);
    color = mix(u_background, ramp(shade), 0.44);
    color = softScreen(color, mix(u_a, u_b, shade), highlight * 0.18);
  }

  // Cloudy / aurora-like volume
  else if (u_variant < 1.5) {
    vec2 q = vec2(
      fbm(rp * 1.15 + vec2(1.7, u_seed * 7.0)),
      fbm(rp * 1.15 + vec2(6.1, 3.0 + u_seed * 5.0))
    );
    float cloud = fbm(rp * 1.65 + q * 2.15);
    float veil = fbm(rp * vec2(0.7, 2.1) + q * 0.9);
    float value = smoothstep(0.2, 0.86, cloud * 0.72 + veil * 0.28);
    color = mix(u_background, ramp(value), 0.48);
    color = softScreen(color, mix(u_b, u_c, value), pow(value, 3.0) * 0.12);
  }

  // Liquid lenses / glassy cells
  else if (u_variant < 2.5) {
    float field = 0.0;
    vec3 tint = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      vec2 center = hash22(vec2(float(i) * 2.17 + 0.3, u_seed * 91.0 + 2.0)) * 2.0 - 1.0;
      center.x *= aspect;
      vec2 d = rp - center;
      float radius = 0.28 + 0.18 * hash21(vec2(float(i), u_seed * 33.0));
      float lens = exp(-dot(d, d) / (radius * radius));
      field += lens;
      vec3 lc = i < 2 ? u_a : (i < 4 ? u_b : u_c);
      tint += lc * lens;
    }
    tint /= max(field, 0.001);
    float body = smoothstep(0.12, 1.15, field);
    float rim = smoothstep(0.25, 0.82, field) - smoothstep(0.82, 1.55, field);
    color = mix(u_background, tint, body * 0.42);
    color = softScreen(color, tint, rim * 0.18);
  }

  // Topographic / geological field
  else if (u_variant < 3.5) {
    vec2 warp = vec2(n0, n1) - 0.5;
    float field = fbm(rp * 1.7 + warp * 0.7);
    float phase = fract(field * 9.0 + u_seed * 3.0);
    float line = 1.0 - smoothstep(0.015, 0.055, abs(phase - 0.5));
    float broad = smoothstep(0.18, 0.82, field);
    color = mix(u_background, ramp(broad), 0.32);
    color = softScreen(color, mix(u_a, u_c, broad), line * 0.15);
  }

  // Prism / caustic interference
  else {
    vec2 q = rotate2(0.5 + u_seed) * rp;
    float f1 = sin(q.x * 2.2 + n0 * 2.1 + u_seed * 7.0);
    float f2 = sin(q.y * 2.7 - n1 * 1.8 - u_seed * 5.0);
    float f3 = sin((q.x + q.y) * 1.4 + (n0 - n1) * 2.6);
    float interference = 0.5 + 0.5 * (f1 + f2 + f3) / 3.0;
    interference = mix(interference, n0, 0.34);
    float glow = pow(smoothstep(0.56, 0.93, interference), 2.4);
    color = mix(u_background, ramp(interference), 0.38);
    color = softScreen(color, mix(u_b, u_c, interference), glow * 0.14);
  }

  // A soft off-center light source gives every thumbnail some depth.
  vec2 lightCenter = vec2(
    (hash21(vec2(u_seed, 1.0)) - 0.5) * aspect * 0.85,
    (hash21(vec2(2.0, u_seed)) - 0.5) * 0.65
  );
  float light = exp(-dot(p - lightCenter, p - lightCenter) * 0.72);
  color = softScreen(color, mix(u_a, u_b, 0.5), light * 0.08);

  float vignette = smoothstep(1.35, 0.12, length((uv - 0.5) * vec2(1.05, 1.0)));
  color *= 0.76 + vignette * 0.29;

  // Very subtle film grain avoids flat digital gradients without becoming noisy.
  float grain = hash21(gl_FragCoord.xy + u_seed * 997.0) - 0.5;
  color += grain * 0.009;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function hashArtworkSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixSeed(seed: number) {
  let value = seed ^ (seed >>> 16);
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function shaderSpec(course: Course): ShaderSpec {
  const seed = hashArtworkSeed(`${course.id}:${course.name}:${course.shortName}`);
  const mixed = mixSeed(seed);
  return {
    seed,
    variant: mixed % 5,
    palette: shaderPalettes[(mixed >>> 7) % shaderPalettes.length],
  };
}

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) return undefined;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return undefined;
  }
  return shader;
}

class SharedCourseShaderRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly position: number;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    position: number,
    uniforms: Record<string, WebGLUniformLocation | null>,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.position = position;
    this.uniforms = uniforms;
  }

  static create() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    if (!gl) return undefined;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertex || !fragment) return undefined;

    const program = gl.createProgram();
    if (!program) return undefined;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return undefined;
    }

    const position = gl.getAttribLocation(program, "a_position");
    const buffer = gl.createBuffer();
    if (position < 0 || !buffer) return undefined;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    return new SharedCourseShaderRenderer(canvas, gl, program, position, {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      seed: gl.getUniformLocation(program, "u_seed"),
      variant: gl.getUniformLocation(program, "u_variant"),
      background: gl.getUniformLocation(program, "u_background"),
      a: gl.getUniformLocation(program, "u_a"),
      b: gl.getUniformLocation(program, "u_b"),
      c: gl.getUniformLocation(program, "u_c"),
    });
  }

  render(target: HTMLCanvasElement, width: number, height: number, spec: ShaderSpec) {
    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);

    const [background, a, b, c] = [
      spec.palette.background,
      ...spec.palette.colors,
    ].map(hexToRgb);
    gl.uniform2f(this.uniforms.resolution, width, height);
    gl.uniform1f(this.uniforms.seed, (spec.seed % 100003) / 100003);
    gl.uniform1f(this.uniforms.variant, spec.variant);
    gl.uniform3fv(this.uniforms.background, background);
    gl.uniform3fv(this.uniforms.a, a);
    gl.uniform3fv(this.uniforms.b, b);
    gl.uniform3fv(this.uniforms.c, c);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const context = target.getContext("2d", { alpha: false });
    if (!context) return false;
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.canvas, 0, 0, width, height);
    return true;
  }
}

let sharedRenderer: SharedCourseShaderRenderer | undefined | null;

function renderer() {
  if (sharedRenderer === undefined)
    sharedRenderer = SharedCourseShaderRenderer.create() ?? null;
  return sharedRenderer || undefined;
}

function ShaderCourseArtwork({ course }: { course: Course }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(
    () => shaderSpec(course),
    [course.id, course.name, course.shortName],
  );
  const [ready, setReady] = useState(false);
  const fallback = `radial-gradient(circle at 30% 25%, ${spec.palette.colors[0]}44, transparent 48%), linear-gradient(145deg, ${spec.palette.background}, ${spec.palette.colors[1]}22)`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = canvas.getBoundingClientRect();
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(96, Math.min(480, Math.round(bounds.width * scale)));
        const height = Math.max(64, Math.min(320, Math.round(bounds.height * scale)));
        setReady(renderer()?.render(canvas, width, height, spec) ?? false);
      });
    };

    draw();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(draw);
    observer?.observe(canvas);
    window.addEventListener("resize", draw, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [spec]);

  return (
    <>
      <div
        className="absolute inset-0"
        style={{ background: fallback }}
        data-course-shader-fallback
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: ready ? 1 : 0 }}
        data-course-shader={spec.variant}
      />
    </>
  );
}

export function CourseArtwork({
  course,
  className = "",
  eager = false,
}: {
  course: Course;
  className?: string;
  eager?: boolean;
}) {
  const src = courseImagePath(course);
  const [failed, setFailed] = useState<string>();
  const useShader = !src || failed === src;

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg bg-bg-1 ${className}`}
      aria-hidden="true"
    >
      {useShader && <ShaderCourseArtwork course={course} />}
      {src && failed !== src && (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(src)}
        />
      )}
    </div>
  );
}
