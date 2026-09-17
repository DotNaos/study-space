import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { Course } from "./api";
import { courseImagePath } from "./course-library";

type Palette = {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  tertiary: string;
};

const paletteFamilies = [
  [214, 278, 188],
  [286, 334, 28],
  [174, 207, 92],
  [225, 191, 326],
  [258, 198, 306],
  [352, 274, 210],
  [190, 44, 318],
  [236, 164, 18],
] as const;

function hashArtworkSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createPalette(seed: number, random: () => number): Palette {
  const family = paletteFamilies[seed % paletteFamilies.length];
  const hue = (value: number) =>
    (value + Math.round(random() * 14 - 7) + 360) % 360;
  const [primary, secondary, tertiary] = family.map(hue);
  return {
    background: `hsl(${primary} 54% 9%)`,
    surface: `hsl(${secondary} 48% 17%)`,
    primary: `hsl(${primary} 92% 64%)`,
    secondary: `hsl(${secondary} 91% 62%)`,
    tertiary: `hsl(${tertiary} 94% 65%)`,
  };
}

function wavePath(
  y: number,
  amplitude: number,
  phase: number,
  frequency: number,
) {
  const points: string[] = [];
  for (let x = -20; x <= 340; x += 20) {
    const offset =
      Math.sin(x / frequency + phase) * amplitude +
      Math.cos(x / (frequency * 1.8) - phase) * amplitude * 0.34;
    points.push(`${x},${(y + offset).toFixed(1)}`);
  }
  return `M ${points.join(" L ")}`;
}

function GeneratedCourseArtwork({ course }: { course: Course }) {
  const seed = hashArtworkSeed(`${course.id}:${course.name}:${course.shortName}`);
  const random = seededRandom(seed);
  const palette = createPalette(seed, random);
  const variant = seed % 5;
  const id = `course-art-${seed.toString(36)}`;
  const gradientAngle = random();
  const gradientX = `${Math.round(gradientAngle * 100)}%`;
  const gradientY = `${Math.round((1 - gradientAngle) * 100)}%`;

  const metaballs = Array.from({ length: 6 }, (_, index) => ({
    cx: 30 + random() * 270,
    cy: 18 + random() * 144,
    rx: 28 + random() * 62,
    ry: 22 + random() * 46,
    rotate: -34 + random() * 68,
    fill: [palette.primary, palette.secondary, palette.tertiary][index % 3],
    opacity: 0.16 + random() * 0.28,
  }));

  const nodes = Array.from({ length: 11 }, (_, index) => ({
    x: 18 + random() * 284,
    y: 16 + random() * 148,
    radius: 1.8 + random() * 3.7,
    fill: [palette.primary, palette.secondary, palette.tertiary][index % 3],
  }));

  const ribbons = Array.from({ length: 5 }, (_, index) => {
    const y = 12 + index * 38 + (random() - 0.5) * 24;
    return {
      d: `M -40 ${y.toFixed(1)} C ${(55 + random() * 45).toFixed(1)} ${(y - 68 + random() * 54).toFixed(1)}, ${(198 + random() * 50).toFixed(1)} ${(y + 74 - random() * 42).toFixed(1)}, 360 ${(y - 18 + random() * 42).toFixed(1)}`,
      width: 13 + random() * 22,
      color: [palette.primary, palette.secondary, palette.tertiary][index % 3],
      opacity: 0.17 + random() * 0.23,
    };
  });

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      data-generated-course-artwork={variant}
    >
      <defs>
        <linearGradient
          id={`${id}-background`}
          x1="0%"
          y1="0%"
          x2={gradientX}
          y2={gradientY}
        >
          <stop offset="0%" stopColor={palette.background} />
          <stop offset="48%" stopColor={palette.surface} />
          <stop offset="100%" stopColor={palette.background} />
        </linearGradient>
        <radialGradient
          id={`${id}-glow`}
          cx={`${25 + random() * 50}%`}
          cy={`${20 + random() * 55}%`}
          r="72%"
        >
          <stop
            offset="0%"
            stopColor={palette.primary}
            stopOpacity="0.28"
          />
          <stop
            offset="46%"
            stopColor={palette.secondary}
            stopOpacity="0.1"
          />
          <stop
            offset="100%"
            stopColor={palette.background}
            stopOpacity="0"
          />
        </radialGradient>
      </defs>

      <rect width="320" height="180" fill={`url(#${id}-background)`} />
      <rect width="320" height="180" fill={`url(#${id}-glow)`} />

      {variant === 0 && (
        <g style={{ mixBlendMode: "screen" }}>
          {metaballs.map((blob, index) => (
            <ellipse
              key={index}
              cx={blob.cx}
              cy={blob.cy}
              rx={blob.rx}
              ry={blob.ry}
              fill={blob.fill}
              opacity={blob.opacity}
              transform={`rotate(${blob.rotate} ${blob.cx} ${blob.cy})`}
            />
          ))}
          <path
            d="M-18 148 C50 80 84 188 149 118 S245 50 344 114"
            fill="none"
            stroke={palette.primary}
            strokeOpacity="0.34"
            strokeWidth="2"
          />
        </g>
      )}

      {variant === 1 && (
        <g fill="none" style={{ mixBlendMode: "screen" }}>
          {Array.from({ length: 11 }, (_, index) => (
            <path
              key={index}
              d={wavePath(
                10 + index * 17,
                7 + random() * 15,
                random() * Math.PI * 2,
                28 + random() * 34,
              )}
              stroke={
                [palette.primary, palette.secondary, palette.tertiary][index % 3]
              }
              strokeOpacity={0.12 + index * 0.015}
              strokeWidth={index % 4 === 0 ? 2 : 1}
            />
          ))}
        </g>
      )}

      {variant === 2 && (
        <g
          fill="none"
          strokeLinecap="round"
          style={{ mixBlendMode: "screen" }}
        >
          {Array.from({ length: 9 }, (_, index) => {
            const x = -10 + index * 43;
            const bend = (random() - 0.5) * 76;
            return (
              <path
                key={`v-${index}`}
                d={`M ${x} -20 Q ${(x + bend).toFixed(1)} 90 ${(x - bend * 0.58).toFixed(1)} 200`}
                stroke={
                  index % 3 === 0 ? palette.primary : palette.secondary
                }
                strokeOpacity={index % 3 === 0 ? 0.3 : 0.13}
                strokeWidth={index % 3 === 0 ? 1.7 : 1}
              />
            );
          })}
          {Array.from({ length: 7 }, (_, index) => {
            const y = -4 + index * 33;
            const bend = (random() - 0.5) * 56;
            return (
              <path
                key={`h-${index}`}
                d={`M -20 ${y} Q 160 ${(y + bend).toFixed(1)} 340 ${(y - bend * 0.38).toFixed(1)}`}
                stroke={index % 2 === 0 ? palette.tertiary : palette.primary}
                strokeOpacity={index % 2 === 0 ? 0.25 : 0.11}
                strokeWidth={index % 2 === 0 ? 1.4 : 1}
              />
            );
          })}
        </g>
      )}

      {variant === 3 && (
        <g style={{ mixBlendMode: "screen" }}>
          {nodes.map((node, index) => {
            const next = nodes[(index + 1) % nodes.length];
            const skip = nodes[(index + 4) % nodes.length];
            return (
              <g key={index}>
                <line
                  x1={node.x}
                  y1={node.y}
                  x2={next.x}
                  y2={next.y}
                  stroke={node.fill}
                  strokeOpacity="0.16"
                  strokeWidth="0.9"
                />
                {index % 3 === 0 && (
                  <line
                    x1={node.x}
                    y1={node.y}
                    x2={skip.x}
                    y2={skip.y}
                    stroke={palette.tertiary}
                    strokeOpacity="0.1"
                    strokeWidth="0.7"
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius * 3.5}
                  fill={node.fill}
                  opacity="0.08"
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={node.fill}
                  opacity="0.88"
                />
              </g>
            );
          })}
        </g>
      )}

      {variant === 4 && (
        <g
          fill="none"
          strokeLinecap="round"
          style={{ mixBlendMode: "screen" }}
        >
          {ribbons.map((ribbon, index) => (
            <path
              key={index}
              d={ribbon.d}
              stroke={ribbon.color}
              strokeOpacity={ribbon.opacity}
              strokeWidth={ribbon.width}
            />
          ))}
          {ribbons.slice(0, 3).map((ribbon, index) => (
            <path
              key={`highlight-${index}`}
              d={ribbon.d}
              stroke={[palette.tertiary, palette.primary, palette.secondary][index]}
              strokeOpacity="0.34"
              strokeWidth="1.3"
            />
          ))}
        </g>
      )}

      <rect width="320" height="180" fill="var(--color-bg-0)" opacity="0.05" />
    </svg>
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
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg bg-bg-1 ${className}`}
      aria-hidden="true"
    >
      {!src && <GeneratedCourseArtwork course={course} />}
      {src && failed === src && (
        <div className="absolute inset-0 flex items-center justify-center text-text-muted/45">
          <ImageOff size={22} strokeWidth={1.4} />
        </div>
      )}
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
