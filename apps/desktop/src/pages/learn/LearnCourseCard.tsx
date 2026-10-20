import type { ReactNode } from "react";
import { Btn, Card, Tag } from "@onethu/gui";
import { IconChevron } from "../../components/Icons.js";
import type { CourseTabKey } from "./courseMerge.js";

export interface LearnCourseCardProps {
  courseId: string;
  title: string;
  details?: string;
  schedule?: string;
  source: "learn" | "yuketang";
  stats: { hw: number; notices: number; files: number };
  audited?: boolean;
  aside?: ReactNode;
  onOpen: () => void;
  onOpenSection: (section: CourseTabKey) => void;
  yktEntry?: { title: string; onOpen: () => void };
}

/** Both sources share one card. Independent actions are siblings of the main
 * course button, so click, Enter and Space never open two different pages. */
export function LearnCourseCard({
  courseId, title, details, schedule, source, stats, audited, aside, onOpen, onOpenSection, yktEntry,
}: LearnCourseCardProps): ReactNode {
  return (
    <Card flush className="learn-course-card" data-learn-course-id={courseId} data-learn-source={source}>
      <div className="learn-course-main">
        <Btn
          variant="ghost"
          className="learn-course-open"
          onClick={onOpen}
          aria-label={`打开课程 ${title}`}
        >
          <span className="learn-course-heading">
            <span className="learn-course-title">{title}</span>
            <IconChevron className="learn-course-caret" />
          </span>
          <span className="learn-course-details">{details}</span>
          <span className="learn-course-schedule">{schedule}</span>
        </Btn>
        {aside ? <div className="learn-course-save">{aside}</div> : null}
      </div>
      <div className="learn-course-footer">
        <div className="learn-course-sources">
          <Btn
            variant="tonal"
            tone="info"
            size="sm"
            onClick={onOpen}
            aria-label={`打开${source === "learn" ? "网络学堂" : "雨课堂"}课程 ${title}`}
            iconRight={<IconChevron />}
          >
            {source === "learn" ? "网络学堂" : "雨课堂"}
          </Btn>
          {yktEntry ? (
            <Btn
              variant="tonal"
              tone="info"
              size="sm"
              onClick={yktEntry.onOpen}
              aria-label={`打开雨课堂课程 ${yktEntry.title}`}
              iconRight={<IconChevron />}
            >
              雨课堂
            </Btn>
          ) : null}
          {audited ? <Tag>旁听</Tag> : null}
        </div>
        <div className="learn-course-counts">
          <Btn
            variant="tonal"
            tone={stats.hw > 0 ? "error" : "default"}
            size="sm"
            onClick={() => onOpenSection("assignments")}
            aria-label={`查看${title}的作业`}
          >
            未交 {stats.hw}
          </Btn>
          <Btn variant="tonal" size="sm" onClick={() => onOpenSection("notices")} aria-label={`查看${title}的通知`}>
            通知 {stats.notices}
          </Btn>
          <Btn variant="tonal" size="sm" onClick={() => onOpenSection("files")} aria-label={`查看${title}的文件`}>
            文件 {stats.files}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
