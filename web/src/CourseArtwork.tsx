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
  { background: "#6B82F2", colors: ["#EAF0FF", "#66D9FF", "#9A7BFF"] },
  { background: "#10B99E", colors: ["#B8FFE9", "#36E6C8", "#5C87FF"] },
  { background: "#F08A18", colors: ["#FFE2B7", "#FFB33A", "#FF6E2B"] },
  { background: "#9678F4", colors: ["#FFB2EA", "#86CBFF", "#D8B4FF"] },
  { background: "#249FD8", colors: ["#C8F7FF", "#5EDFFF", "#777CFF"] },
  { background: "#E46A86", colors: ["#FFD0DD", "#FF9EC4", "#9C8BFF"] },
  { background: "#54B86C", colors: ["#D5FFD9", "#7CE8AF", "#39C9D7"] },
  { background: "#F3A12C", colors: ["#FFF0C5", "#FFCC55", "#FF7B63"] },
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

mat2 rotate2(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

vec3 screenBlend(vec3 base, vec3 layer) {
  return 1.0 - (1.0 - base) * (1.0 - layer);
}

vec4 petal(
  vec2 p,
  vec2 center,
  float angle,
  vec2 scale,
  float bend,
  vec3 petalColor,
  float lightDirection
) {
  vec2 q = rotate2(angle) * (p - center);
  q.x += bend * q.y * q.y;

  float y = q.y / max(scale.y, 0.001);
  float width = scale.x * pow(max(0.0, 1.0 - y * y), 0.56);
  float x = abs(q.x) / max(width, 0.001);
  float distanceField = max(abs(y), x);
  float mask = 1.0 - smoothstep(0.91, 1.025, distanceField);

  float crossLight = smoothstep(-scale.x, scale.x, q.x * lightDirection);
  float centerFold = exp(-abs(q.x) / max(scale.x * 0.23, 0.001));
  float tipGlow = smoothstep(1.0, -0.15, abs(y));

  vec3 shaded = petalColor * (0.78 + crossLight * 0.22);
  shaded = screenBlend(shaded, vec3(1.0) * centerFold * 0.16);
  shaded = screenBlend(shaded, vec3(1.0) * tipGlow * 0.035);

  return vec4(shaded, mask);
}

vec3 compositePetal(vec3 base, vec4 layer, float opacity) {
  vec3 luminous = screenBlend(base, layer.rgb);
  return mix(base, luminous, layer.a * opacity);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;

  float seedA = hash21(vec2(u_seed * 73.0, 1.7));
  float seedB = hash21(vec2(9.1, u_seed * 53.0));
  float seedC = hash21(vec2(u_seed * 31.0, 6.4));

  // Bright, clean base gradient. The artwork should read as a designed cover,
  // not a dark procedural texture.
  float diagonal = clamp(uv.x * 0.62 + (1.0 - uv.y) * 0.38, 0.0, 1.0);
  vec3 color = mix(u_background, u_b, diagonal * 0.26);
  vec2 softPoint = vec2(0.24 + seedA * 0.25, 0.18 + seedB * 0.22);
  float softLight = exp(-dot(uv - softPoint, uv - softPoint) * 4.8);
  color = mix(color, screenBlend(color, u_a), softLight * 0.38);

  if (u_variant < 0.5) {
    // Radial bloom: large overlapping petals with one clear focal point.
    vec2 center = vec2((seedA - 0.5) * aspect * 0.26, (seedB - 0.5) * 0.20);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float angle = fi * 1.256637 + seedC * 0.72;
      vec2 petalCenter = center + vec2(cos(angle), sin(angle)) * vec2(0.18 * aspect, 0.13);
      vec3 pc = i == 0 || i == 3 ? u_a : (i == 1 || i == 4 ? u_b : u_c);
      vec4 layer = petal(
        p,
        petalCenter,
        angle + 1.5708,
        vec2(0.50 + seedA * 0.12, 0.92 + seedB * 0.16),
        (seedC - 0.5) * 0.22,
        pc,
        i == 0 || i == 2 ? 1.0 : -1.0
      );
      color = compositePetal(color, layer, 0.66);
    }
  } else if (u_variant < 1.5) {
    // Folded fan: broad soft leaves sweeping across the thumbnail.
    float baseAngle = -0.72 + seedA * 0.55;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float angle = baseAngle + fi * 0.34;
      vec2 center = vec2(-0.42 * aspect + fi * 0.25 * aspect, -0.25 + fi * 0.11);
      vec3 pc = i == 0 ? u_a : (i == 1 ? u_b : (i == 2 ? u_c : mix(u_a, u_c, 0.5)));
      vec4 layer = petal(
        p,
        center,
        angle + 1.5708,
        vec2(0.58 + fi * 0.035, 1.12 - fi * 0.055),
        0.08 + fi * 0.035,
        pc,
        mod(fi, 2.0) < 1.0 ? 1.0 : -1.0
      );
      color = compositePetal(color, layer, 0.62);
    }
  } else if (u_variant < 2.5) {
    // Twin blooms: two simple flower-like forms, intentionally low-detail.
    vec2 center0 = vec2(-0.34 * aspect, 0.20);
    vec2 center1 = vec2(0.42 * aspect, -0.20);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      bool second = i >= 3;
      float localIndex = second ? fi - 3.0 : fi;
      vec2 center = second ? center1 : center0;
      center += vec2((seedA - 0.5) * 0.12, (seedB - 0.5) * 0.10);
      float angle = localIndex * 2.0944 + (second ? 0.74 : 0.0) + seedC * 0.45;
      vec3 pc = localIndex < 0.5 ? (second ? u_c : u_a)
        : (localIndex < 1.5 ? (second ? u_a : u_b) : (second ? u_b : u_c));
      vec4 layer = petal(
        p,
        center + vec2(cos(angle), sin(angle)) * vec2(0.16 * aspect, 0.11),
        angle + 1.5708,
        vec2(0.45, 0.76),
        (seedA - 0.5) * 0.18,
        pc,
        localIndex < 1.5 ? 1.0 : -1.0
      );
      color = compositePetal(color, layer, 0.58);
    }
  } else if (u_variant < 3.5) {
    // Close-up bloom: oversized petals intentionally cropped by the card.
    vec2 center = vec2((seedA - 0.58) * aspect * 0.55, (seedB - 0.42) * 0.42);
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float angle = -0.55 + fi * 0.76 + seedC * 0.38;
      vec3 pc = i == 0 ? u_a : (i == 1 ? u_b : (i == 2 ? u_c : mix(u_a, u_b, 0.45));
      vec4 layer = petal(
        p,
        center + vec2(cos(angle), sin(angle)) * vec2(0.18 * aspect, 0.13),
        angle + 1.5708,
        vec2(0.72, 1.30),
        (fi - 1.5) * 0.08,
        pc,
        i < 2 ? 1.0 : -1.0
      );
      color = compositePetal(color, layer, 0.60);
    }
  } else {
    // Ribbon petals: three smooth folded forms with lots of negative space.
    float baseAngle = 0.34 + seedA * 0.65;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 center = vec2((-0.36 + fi * 0.37) * aspect, -0.18 + fi * 0.19);
      float angle = baseAngle + (fi - 1.0) * 0.44;
      vec3 pc = i == 0 ? u_a : (i == 1 ? u_b : u_c);
      vec4 layer = petal(
        p,
        center,
        angle + 1.5708,
        vec2(0.66, 1.18),
        (fi - 1.0) * 0.16,
        pc,
        i == 1 ? -1.0 : 1.0
      );
      color = compositePetal(color, layer, 0.64);
    }
  }

  // Gentle white bloom like a studio light across translucent petals.
  vec2 glowPoint = vec2((seedC - 0.5) * aspect * 0.65, 0.18 - seedA * 0.38);
  float glow = exp(-dot(p - glowPoint, p - glowPoint) * 1.15);
  color = screenBlend(color, vec3(1.0) * glow * 0.13);

  // Slight edge falloff keeps bright cards composed without muddying the colors.
  float edge = smoothstep(1.15, 0.35, length((uv - 0.5) * vec2(1.05, 0.92)));
  color *= 0.91 + edge * 0.09;

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
