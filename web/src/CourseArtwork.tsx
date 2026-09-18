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
  { background: "#07111f", colors: ["#5f7cff", "#9d5cff", "#32e0c4"] },
  { background: "#16091f", colors: ["#ff4db8", "#765cff", "#45d7ff"] },
  { background: "#071914", colors: ["#20d6a4", "#67e8f9", "#f2c94c"] },
  { background: "#0b1020", colors: ["#4cc9f0", "#4361ee", "#f72585"] },
  { background: "#181008", colors: ["#ff9f43", "#feca57", "#5f27cd"] },
  { background: "#111021", colors: ["#b47cff", "#60a5fa", "#f472b6"] },
  { background: "#07171a", colors: ["#2dd4bf", "#38bdf8", "#a3e635"] },
  { background: "#160d12", colors: ["#fb7185", "#f59e0b", "#818cf8"] },
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
  float amplitude = 0.5;
  mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise2(p);
    p = m * p * 2.03 + 7.13;
    amplitude *= 0.5;
  }
  return value;
}

mat2 rotate2(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

vec3 paletteRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5
    ? mix(u_a, u_b, smoothstep(0.0, 0.5, t))
    : mix(u_b, u_c, smoothstep(0.5, 1.0, t));
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  float baseNoise = fbm(p * 1.35 + u_seed * 5.0);
  vec3 color = u_background;

  if (u_variant < 0.5) {
    float warp = sin(p.x * 2.4 + u_seed * 17.0) * 0.28;
    float bands = 0.5 + 0.5 * sin((p.y + warp + baseNoise * 0.24) * 10.5);
    float highlight = pow(bands, 4.0);
    color = mix(u_background, paletteRamp(bands), 0.58 + 0.34 * highlight);
  } else if (u_variant < 1.5) {
    vec2 q = vec2(
      fbm(p * 1.9 + vec2(u_seed * 4.0, 1.7)),
      fbm(p * 1.9 + vec2(5.3, u_seed * 3.0))
    );
    vec2 r = vec2(
      fbm(p * 2.8 + q * 2.4 + vec2(8.1, 2.2)),
      fbm(p * 2.8 + q * 2.4 + vec2(1.8, 7.4))
    );
    float field = fbm(p * 2.25 + r * 3.0);
    color = mix(u_background, paletteRamp(field), 0.76);
    color += u_c * pow(max(0.0, field - 0.62), 3.0) * 1.4;
  } else if (u_variant < 2.5) {
    float field = fbm(rotate2(u_seed * 3.2) * p * 2.45);
    float contourDistance = abs(fract(field * 8.0 + baseNoise * 0.35) - 0.5);
    float contours = 1.0 - smoothstep(0.035, 0.11, contourDistance);
    color = mix(u_background, paletteRamp(field), 0.48);
    color += mix(u_a, u_c, field) * contours * 0.58;
  } else if (u_variant < 3.5) {
    vec2 gp = rotate2(0.35 + u_seed * 2.2) * p;
    gp += 0.13 * vec2(
      noise2(p * 2.8 + u_seed * 9.0),
      noise2(p * 2.8 + 4.7 - u_seed * 3.0)
    );
    vec2 gridPos = abs(fract(gp * 3.2) - 0.5);
    float grid = 1.0 - smoothstep(0.025, 0.075, min(gridPos.x, gridPos.y));
    float diagonal = 0.5 + 0.5 * sin((gp.x + gp.y) * 4.0 + baseNoise * 5.0);
    color = mix(u_background, paletteRamp(diagonal), 0.36 + grid * 0.46);
    color += u_b * grid * 0.23;
  } else {
    float field = 0.0;
    vec3 weighted = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      vec2 point = hash22(vec2(float(i) + 2.3, u_seed * 71.0 + 0.7)) * 2.0 - 1.0;
      point.x *= aspect;
      vec2 delta = p - point;
      float influence = 0.055 / (dot(delta, delta) + 0.035);
      field += influence;
      vec3 nodeColor = i - (i / 3) * 3 == 0 ? u_a : (i - (i / 3) * 3 == 1 ? u_b : u_c);
      weighted += nodeColor * influence;
    }
    vec3 blobColor = weighted / max(field, 0.001);
    float body = smoothstep(0.45, 1.8, field);
    float rim = smoothstep(1.0, 2.8, field) - smoothstep(2.8, 5.0, field);
    color = mix(u_background, blobColor, body * 0.76);
    color += u_c * rim * 0.20;
  }

  float vignette = smoothstep(1.15, 0.25, length((uv - 0.5) * vec2(1.18, 1.0)));
  color *= 0.78 + vignette * 0.28;
  color += (hash21(gl_FragCoord.xy + u_seed * 999.0) - 0.5) * 0.018;
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

function shaderSpec(course: Course): ShaderSpec {
  const seed = hashArtworkSeed(`${course.id}:${course.name}:${course.shortName}`);
  return {
    seed,
    variant: seed % 5,
    palette: shaderPalettes[(seed >>> 4) % shaderPalettes.length],
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
  const spec = useMemo(() => shaderSpec(course), [course.id, course.name, course.shortName]);
  const [ready, setReady] = useState(false);
  const fallback = `linear-gradient(135deg, ${spec.palette.background}, ${spec.palette.colors[0]}55, ${spec.palette.colors[1]}44)`;

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
