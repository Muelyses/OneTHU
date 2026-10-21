import { courseDisplayName } from "../../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/** 文件详情（learnX FileDetail）：类型/大小/说明 + 下载占位按钮 */
import { useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconDownload } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, InfoRow, fmtDateTime, learnFileName } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { downloadLearnFile } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { DownloadOpenButtons } from "../../components/DownloadOpenButtons.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { LEARN_FILE_DOWNLOAD } from "@onethu/core";

export function FileDetailPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { navParams, navigate } = useApp();
  const { data, state, error, reload } = useLearnData();
  // R23：下载提示携带落盘路径，右侧挂「打开文件 / 打开目录」
  const [hint, setHint] = useState<{ text: string; path?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const f = useMemo(
    () => data?.files.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [uiLocale, data, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [uiLocale, data, courseId]);

  const doDownload = async () => {
    if (!f) return;
    setDownloading(true);
    setHint(null);
    try {
      // 落盘名 = title + "." + fileType（title 已带该后缀则不重复；mobile fs.downloadFile 同构）
      const path = await downloadLearnFile(f.id, learnFileName(f.title || `learn-file-${f.id}`, f.fileType));
      setHint({ text: i18n("pages.learn.filedetailpage.2d2ab24375ce", { path: String(path) }), path });
    } catch (err) {
      setHint({ text: i18n("pages.learn.filedetailpage.90f9253844e7") + explainNetworkError(err) });
    } finally {
      setDownloading(false);
    }
  };

  if (!f) {
    return (
      <>
        <PageHead title={i18n("pages.learn.filedetailpage.27b6154b3fd3")} actions={<><BackButton to={navParams?.from ?? "learn-files"} courseId={navParams?.courseId} courseTab="files" /></>} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty
            text={i18n("pages.learn.filedetailpage.0e74e85582ac")}
            action={<Btn variant="ghost" onClick={() => navigate("learn")}>{i18n("pages.learn.filedetailpage.c9521a639f12")}</Btn>}
          /></Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={f.title}
        meta={i18n("pages.learn.filedetailpage.52e4a178c47c", { value: String(courseDisplayName(course) ?? i18n("pages.learn.filedetailpage.60db1afb4022")), value2: String(course?.teacherName ? ` · ${course.teacherName}` : ""), value3: String(fmtDateTime(f.uploadTime)) })}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-files"} courseId={navParams?.courseId} courseTab="files" />
            <CollectStar
              atom={{ kind: "file", key: enc(f.courseId, f.id, f.title, course?.name ?? "", data?.semester.id ?? "") }}
              title={f.title}
            />
            <Btn variant="outline" onClick={() => openFilePreview({ name: learnFileName(f.title || i18n("pages.learn.filedetailpage.2f3a2301c3d3", { id: String(f.id) }), f.fileType), url: LEARN_FILE_DOWNLOAD(f.id) })}>{i18n("pages.learn.filedetailpage.13d61fea9f17")}</Btn>
            <Btn variant="solid" tone="brand" disabled={downloading} onClick={() => void doDownload()}><IconDownload width={14} height={14} />{downloading ? i18n("pages.learn.filedetailpage.bcc2333dc631") : i18n("pages.learn.filedetailpage.4673a2306165")}</Btn>
          </>
        }
      />

      {hint ? (
        <div className="error-note dl-done-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{hint.text}</span>
          {hint.path ? <DownloadOpenButtons path={hint.path} /> : null}
        </div>
      ) : null}

      <Card className="list">
        <InfoRow label={i18n("pages.learn.filedetailpage.9a8457b3dc84")} value={f.fileType ? f.fileType.toUpperCase() : i18n("pages.learn.filedetailpage.4d8c1c5b4283")} />
        <InfoRow label={i18n("pages.learn.filedetailpage.b9bf6916437a")} value={f.size ?? i18n("pages.learn.filedetailpage.5e8fca40baca")} />
        <InfoRow label={i18n("pages.learn.filedetailpage.262312ea18e9")} value={courseDisplayName(course) ?? i18n("pages.learn.filedetailpage.60db1afb4022")} />
        <InfoRow label={i18n("pages.learn.filedetailpage.de89171538fd")} value={fmtDateTime(f.uploadTime)} />
        <InfoRow label={i18n("pages.learn.filedetailpage.4262c45dc797")} value={f.description ?? i18n("pages.learn.filedetailpage.71083097a94f")} />
      </Card>
    </>
  );
}
