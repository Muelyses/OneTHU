import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 个人信息页 —— getUserInfo（yyfw 漫游 F315577F… 后正则取名/邮箱；
 * grjbxx 对本应用 403 无权限，仅作兜底）。
 * 脱敏版（demo 分支）：姓名 / 学号来自已脱敏的 profile；登录账号走 displayStudentId。
 */
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useProfile } from "../../state/data.js";
import { useApp } from "../../state/context.js";
import { displayStudentId } from "../../lib/privacy.js";

export function ProfileTab() {
  const uiLocale = useUiLocale();

  const { user } = useApp();
  const { data, state, error, reload } = useProfile();

  const rows: Array<[string, string | undefined]> = [
    [i18n("pages.info.profiletab.50b5b1d2abef"), data?.name],
    [i18n("pages.info.profiletab.c4d678ef6e37"), data?.studentId || displayStudentId(user?.username)],
    [i18n("pages.info.profiletab.a752a7d8c127"), data?.gender],
    [i18n("pages.info.profiletab.ac439859ca01"), data?.department],
    [i18n("pages.info.profiletab.349b21c03d6a"), data?.major],
    [i18n("pages.info.profiletab.d9a999a7c8e8"), displayStudentId(user?.username)],
  ];

  return (
    <>
      <SectionHead
        title={i18n("pages.info.profiletab.640803d89773")}
        aside={i18n("pages.info.profiletab.09048b67c1e6")}
        /* actions 参数不存在，刷新按钮放下方标题行右缘 */
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.info.profiletab.aee887434131")}</Btn>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : !data ? (
        <Card>
          <Empty text={i18n("pages.info.profiletab.5328f4fc33df")} />
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {rows.map(([label, value]) => (
            <div className="setting-row" key={label}>
              <div>
                <div className="setting-title">{value || "–"}</div>
                <div className="setting-desc">{label}</div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
