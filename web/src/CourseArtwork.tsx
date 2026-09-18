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
  { background: "#5877F4", colors: ["#E5EEFF", "#53DFFF", "#A27CFF"] },
  { background: "#15B7A1", colors: ["#D2FFF1", "#4BE1C5", "#4D8CFF"] },
  { background: "#F08B28", colors: ["#FFE5B3", "#FFBC4C", "#FF7152"] },
  { background: "#9275F2", colors: ["#FFB5E9", "#77D2FF", "#D8BEFF"] },
  { background: "#1FA5DD", colors: ["#D1F8FF", "#55D9FF", "#7578F4"] },
  { background: "#E76091", colors: ["#FFD2E2", "#FF91C2", "#8580FF"] },
  { background: "#42B978", colors: ["#D8FFE3", "#68E6A8", "#32CBD4"] },
  { background: "#F29A2C", colors: ["#FFF0BE", "#FFD05B", "#FF8069"] },
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
  float width = scale.x * (0.12 + 0.88 * pow(max(0.0, 1.0 - y * y), 0.54));
  float x = abs(q.x) / max(width, 0.001);
  float distanceField = max(abs(y), x);
  float mask = 1.0 - smoothstep(0.88, 1.02, distanceField);

  float crossLight = clamp(
    0.5 + 0.5 * q.x / max(scale.x, 0.001) * lightDirection,
    0.0,
    1.0
  );
  float centerFold = exp(-pow(q.x / max(scale.x * 0.22, 0.001), 2.0));
  float innerLight = pow(max(0.0, 1.0 - abs(y)), 0.7);
  float rim = smoothstep(0.68, 0.98, distanceField) * mask;

  vec3 shaded = petalColor * (0.79 + crossLight * 0.21);
  shaded = mix(
    shaded,
    screenBlend(shaded, vec3(0.74)),
    centerFold * innerLight * 0.22
  );
  shaded = mix(shaded, screenBlend(shaded, vec3(0.64)), rim * 0.10);

  return vec4(shaded, mask);
}

vec4 sheet(
  vec2 p,
  vec2 center,
  float angle,
  vec2 scale,
  float bend,
  float foldOffset,
  vec3 sheetColor,
  float lightDirection
) {
  vec2 q = rotate2(angle) * (p - center);
  q.x += bend * q.y * q.y;
  vec2 n = q / max(scale, vec2(0.001));

  float distanceField = pow(abs(n.x), 3.0) + pow(abs(n.y), 2.2);
  float mask = 1.0 - smoothstep(0.84, 1.04, distanceField);
  float crossLight = clamp(0.5 + 0.5 * n.x * lightDirection, 0.0, 1.0);
  float crease = exp(-pow((n.x - foldOffset) * 5.4, 2.0));
  float middle = pow(max(0.0, 1.0 - abs(n.y)), 0.55);
  float rim = smoothstep(0.58, 0.96, distanceField) * mask;

  vec3 shaded = sheetColor * (0.80 + crossLight * 0.20);
  shaded = mix(
    shaded,
    screenBlend(shaded, vec3(0.76)),
    crease * middle * 0.20
  );
  shaded = mix(shaded, screenBlend(shaded, vec3(0.62)), rim * 0.08);

  return vec4(shaded, mask);
}

vec3 compositeForm(vec3 base, vec4 layer, float opacity) {
  vec3 translucent = mix(base, layer.rgb, 0.82);
  return mix(base, translucent, layer.a * opacity);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;

  float seedA = hash21(vec2(u_seed * 73.0, 1.7));
  float seedB = hash21(vec2(9.1, u_seed * 53.0));
  float seedC = hash21(vec2(u_seed * 31.0, 6.4));

  // Clean editorial base: saturated enough to feel alive, but the large forms
  // carry the composition instead of procedural texture.
  float diagonal = clamp(uv.x * 0.58 + (1.0 - uv.y) * 0.42, 0.0, 1.0);
  vec3 color = mix(u_background, u_b, 0.08 + diagonal * 0.20);
  vec2 softPoint = vec2(0.20 + seedA * 0.24, 0.17 + seedB * 0.20);
  float softLight = exp(-dot(uv - softPoint, uv - softPoint) * 5.2);
  color = mix(color, screenBlend(color, u_a * 0.72), softLight * 0.28);

  if (u_variant < 0.5) {
    // Radial bloom: one clear flower-like focal point.
    vec2 center = vec2(
      (-0.08 + (seedA - 0.5) * 0.20) * aspect,
      -0.06 + (seedB - 0.5) * 0.16
    );
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float angle = fi * 1.047198 + seedC * 0.46;
      vec2 petalCenter =
        center +
        vec2(cos(angle), sin(angle)) * vec2(0.20 * aspect, 0.16);
      vec3 pc = i == 0 || i == 3
        ? u_a
        : (i == 1 || i == 4 ? u_c : u_b);
      vec4 layer = petal(
        p,
        petalCenter,
        angle + 1.5708,
        vec2(0.52 + seedA * 0.08, 0.86 + seedB * 0.12),
        (seedC - 0.5) * 0.16,
        pc,
        i == 0 || i == 2 ? 1.0 : -1.0
      );
      color = compositeForm(color, layer, 0.82);
    }
  } else if (u_variant < 1.5) {
    // Asymmetrical petal cluster with deliberate negative space.
    vec2 anchor = vec2(
      (0.50 + (seedA - 0.5) * 0.12) * aspect,
      -0.20 + (seedB - 0.5) * 0.18
    );
    vec4 a = petal(
      p,
      anchor + vec2(-0.18 * aspect, 0.02),
      2.28 + seedC * 0.18,
      vec2(0.70, 1.18),
      -0.12,
      u_a,
      -1.0
    );
    vec4 b = petal(
      p,
      anchor + vec2(0.02 * aspect, 0.22),
      2.78 + seedC * 0.12,
      vec2(0.64, 1.04),
      0.16,
      u_c,
      1.0
    );
    vec4 c = petal(
      p,
      anchor + vec2(-0.02 * aspect, -0.34),
      1.78 + seedC * 0.16,
      vec2(0.58, 0.92),
      -0.08,
      u_b,
      -1.0
    );
    color = compositeForm(color, a, 0.86);
    color = compositeForm(color, b, 0.76);
    color = compositeForm(color, c, 0.72);
  } else if (u_variant < 2.5) {
    // Folded fan / ribbons sweeping upward from the lower-left.
    float baseAngle = -0.56 + (seedA - 0.5) * 0.16;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float angle = baseAngle + fi * 0.27;
      vec2 center = vec2(
        (-0.50 + fi * 0.27) * aspect,
        -0.22 + fi * 0.12 + (seedB - 0.5) * 0.08
      );
      vec3 sc = i == 0
        ? u_a
        : (i == 1 ? u_c : (i == 2 ? u_b : mix(u_a, u_c, 0.56)));
      vec4 layer = sheet(
        p,
        center,
        angle,
        vec2(0.82 - fi * 0.055, 0.42 + fi * 0.025),
        0.13 + fi * 0.035,
        -0.18 + fi * 0.11,
        sc,
        mod(fi, 2.0) < 1.0 ? 1.0 : -1.0
      );
      color = compositeForm(color, layer, 0.78 - fi * 0.035);
    }
  } else if (u_variant < 3.5) {
    // Cropped macro petals: oversized forms originate outside the card.
    vec2 origin = vec2(
      (-0.58 + (seedA - 0.5) * 0.16) * aspect,
      -0.48 + (seedB - 0.5) * 0.12
    );
    vec4 a = petal(
      p,
      origin + vec2(0.14 * aspect, 0.10),
      -0.28 + seedC * 0.14,
      vec2(0.96, 1.52),
      -0.11,
      u_a,
      1.0
    );
    vec4 b = petal(
      p,
      origin + vec2(0.52 * aspect, 0.16),
      0.44 + seedC * 0.12,
      vec2(0.88, 1.38),
      0.12,
      u_c,
      -1.0
    );
    vec4 c = petal(
      p,
      origin + vec2(0.84 * aspect, 0.48),
      0.98 + seedC * 0.10,
      vec2(0.72, 1.18),
      0.09,
      u_b,
      1.0
    );
    color = compositeForm(color, a, 0.78);
    color = compositeForm(color, b, 0.80);
    color = compositeForm(color, c, 0.70);
  } else {
    // Three giant folded sheets with strong transparent overlap.
    vec4 a = sheet(
      p,
      vec2((-0.18 + (seedA - 0.5) * 0.10) * aspect, 0.22),
      0.48 + seedC * 0.12,
      vec2(1.04, 0.54),
      -0.10,
      -0.16,
      u_a,
      1.0
    );
    vec4 b = sheet(
      p,
      vec2((0.24 + (seedB - 0.5) * 0.10) * aspect, -0.12),
      -0.62 + seedC * 0.08,
      vec2(1.00, 0.48),
      0.16,
      0.12,
      u_c,
      -1.0
    );
    vec4 c = sheet(
      p,
      vec2(-0.10 * aspect, -0.48 + seedA * 0.12),
      0.10 + seedC * 0.08,
      vec2(0.86, 0.38),
      -0.18,
      0.02,
      u_b,
      1.0
    );
    color = compositeForm(color, a, 0.74);
    color = compositeForm(color, b, 0.78);
    color = compositeForm(color, c, 0.66);
  }

  // Broad studio light gives the translucent forms a polished finish.
  vec2 glowPoint = vec2((seedC - 0.5) * aspect * 0.58, 0.30 - seedA * 0.42);
  float glow = exp(-dot(p - glowPoint, p - glowPoint) * 1.30);
  color = screenBlend(color, vec3(1.0) * glow * 0.11);

  // Keep only a very light frame so the palette never turns muddy.
  float edge = 1.0 - smoothstep(
    0.38,
    1.16,
    length((uv - 0.5) * vec2(1.04, 0.90))
  );
  color *= 0.95 + edge * 0.05;

  // Fine static film grain. Keep it multiplicative so hue/saturation stay intact.
  float grainA = hash21(gl_FragCoord.xy + vec2(u_seed * 173.0, u_seed * 317.0));
  float grainB = hash21(
    gl_FragCoord.yx * vec2(0.7549, 0.5698) +
    vec2(u_seed * 911.0, 37.0)
  );
  float grain = (grainA + grainB - 1.0) * 0.018;
  color *= 1.0 + grain;

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
    context.globalAlpha = 1;
    context.filter = "none";
    context.drawImage(this.canvas, 0, 0, width, height);
    context.globalAlpha = 0.18;
    context.filter = "blur(2.5px)";
    context.drawImage(this.canvas, 0, 0, width, height);
    context.globalAlpha = 1;
    context.filter = "none";
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
  const fallback = `radial-gradient(ellipse at 24% 22%, ${spec.palette.colors[0]}cc 0%, ${spec.palette.colors[0]}55 34%, transparent 62%), radial-gradient(ellipse at 82% 76%, ${spec.palette.colors[2]}aa 0%, transparent 58%), linear-gradient(145deg, ${spec.palette.background}, ${spec.palette.colors[1]})`;

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
