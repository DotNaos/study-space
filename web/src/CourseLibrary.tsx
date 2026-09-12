import { ArrowRight } from "lucide-react";
import { CourseArtwork } from "./CourseArtwork";
import { courseSubtitle, type CourseGroup } from "./course-library";
import { AppLink, type Navigate } from "./navigation";

export function CourseLibrary({
  groups,
  navigate,
}: {
  groups: CourseGroup[];
  navigate: Navigate;
}) {
  return (
    <div className="space-y-7">
      {groups.map(({ semester, courses }) => (
        <section
          key={semester.key}
          aria-labelledby={`semester-${semester.key}`}
        >
          <div className="mb-1 flex items-baseline gap-2 border-b border-border/60 pb-2">
            <h2
              id={`semester-${semester.key}`}
              className="text-sm font-medium tracking-tight sm:text-base"
            >
              <span className="sm:hidden">{semester.shortLabel}</span><span className="hidden sm:inline">{semester.label}</span>
            </h2>
            <span className="text-xs tabular-nums text-text-muted" aria-label={`${courses.length} Kurse`}>
              {courses.length}
            </span>
          </div>
          <ul className="divide-y divide-border/60">
            {courses.map((course) => {
              const subtitle = courseSubtitle(course);
              return (
                <li key={course.id}>
                  <AppLink
                    href={`/courses/${course.id}`}
                    navigate={navigate}
                    className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-bg-1/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:gap-5"
                  >
                    <CourseArtwork
                      course={course}
                      className="size-14 sm:h-16 sm:w-24"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-medium leading-5 group-hover:text-accent sm:text-base">
                        {course.name}
                      </h3>
                      {subtitle && (
                        <p className="mt-1 hidden break-words text-xs leading-5 text-text-muted sm:block">
                          {subtitle}
                        </p>
                      )}
                    </div>
                    <ArrowRight
                      size={18}
                      className="shrink-0 text-text-muted transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transform-none"
                      aria-hidden="true"
                    />
                  </AppLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
