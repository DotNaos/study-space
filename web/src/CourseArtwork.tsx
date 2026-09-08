import { useState } from "react";
import { BookOpen } from "lucide-react";
import type { Course } from "./api";
import { courseImagePath } from "./course-library";

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
      <div className="absolute inset-0 flex items-center justify-center text-text-muted/45">
        <BookOpen size={30} strokeWidth={1.2} />
      </div>
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
