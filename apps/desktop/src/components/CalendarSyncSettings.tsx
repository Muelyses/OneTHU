import { useEffect, useState } from "react";
import { Btn, Inline, Input, SettingsRow, Stack } from "@onethu/gui";
import { Card } from "./Layout.js";
import { ErrorLine } from "./Details.js";
import { confirmOk } from "../lib/confirm.js";
import { useCloudCal, configureCloudCal, disconnectCloudCal, syncCloudCal } from "../state/cloudCal.js";
import {
  useSystemCal,
  systemCalSupported,
  enableSystemCalendar,
  disableSystemCalendar,
  removeSystemCalendar,
  syncSystemCalendar,
} from "../state/systemCal.js";

/** Same calendar controls in every experience mode; switching modes only changes the shell. */
export function CalendarSyncSettings() {
  // 云同步（清华邮箱 CalDAV 日历）
  const cloud = useCloudCal();
  const [calEmail, setCalEmail] = useState("");
  const [calPass, setCalPass] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  // 系统日历原生同步（Android/macOS）
  const syscal = useSystemCal();
  const [sysSupported, setSysSupported] = useState<boolean | null>(null);
  const [sysBusy, setSysBusy] = useState(false);
  const [sysMsg, setSysMsg] = useState<string | null>(null);

  useEffect(() => {
    void systemCalSupported().then(setSysSupported);
  }, []);

  return <Stack gap={3}>
      <Card>
        <SettingsRow
          title={cloud.configured ? "日程云同步 · 已连接" : "日程云同步（清华邮箱日历）"}
          sub={
            cloud.configured ? (
              <>
                {cloud.email} · 通过清华邮箱日历（CalDAV）多设备同步手动添加的日程；在「日程」页查看与编辑。作业与课表通过下方系统日历同步。
                {calMsg ? <ErrorLine text={calMsg} tone="quiet" /> : null}
              </>
            ) : (
              <>
                用清华邮箱的日历服务在多台设备间同步手动日程——OneTHU 里添加的日程会出现在系统日历 / 其他设备（添加同一账号）。
                授权码获取：网页版邮箱（mails.tsinghua.edu.cn）→ 设置 → 客户端专用密码。
                {calMsg ? <ErrorLine text={calMsg} tone="quiet" /> : null}
              </>
            )
          }
          control={
            cloud.configured ? (
              <Inline gap={2} wrap>
                <Btn variant="outline" onClick={() =>
                    void confirmOk(
                      "在 iPhone / iPad 上查看日程（可选）\n\n手机上没有 OneTHU 也没关系：日程已在你清华邮箱的云端日历里，在 iPhone/iPad 上添加同一邮箱即可看到：\n· 设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV 账户\n· 服务器地址：https://mails.tsinghua.edu.cn/coremail/dav/users/你的邮箱/\n· 用户名：完整邮箱；密码：客户端专用密码（与本页一致）\n\n本机不需要此设置——用下方「系统日历同步」一键开启即可，应用直接写系统日历。",
                    )
                  }>iPhone 上查看
                </Btn>
                <Btn variant="outline" disabled={calBusy || cloud.syncing} onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void syncCloudCal()
                      .then((r) => setCalMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`))
                      .catch((e: unknown) => setCalMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}>{calBusy || cloud.syncing ? "同步中…" : "立即同步"}</Btn>
                <Btn variant="outline" disabled={calBusy || cloud.syncing} onClick={() =>
                    void disconnectCloudCal().then(() => {
                      setCalEmail("");
                      setCalPass("");
                      setCalMsg("已断开。云端日程保留。");
                    }).catch((e: unknown) => setCalMsg(`断开失败：${e instanceof Error ? e.message : String(e)}`))
                  }>断开
                </Btn>
              </Inline>
            ) : null
          }
        />
        {cloud.error ? <ErrorLine text={`日历连接或同步未完成：${cloud.error}`} tone="error" /> : null}
        {cloud.configured ? null : (
          <div className="og-settings-row" style={{ alignItems: "stretch" }}>
            <span className="og-settings-row-main">
              <Inline gap={2} wrap>
                <div style={{ minWidth: 200, flex: "1 1 200px" }}><Input placeholder="完整邮箱地址（如 someone@mails.tsinghua.edu.cn）" value={calEmail} onChange={(value) => setCalEmail(value.trim())} /></div>
                <div style={{ minWidth: 140, flex: "1 1 140px" }}><Input type="password" placeholder="客户端专用密码" value={calPass} onChange={(value) => setCalPass(value)} /></div>
                <Btn variant="solid" tone="brand" disabled={!/.+@.+/.test(calEmail) || !calPass || calBusy} onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void configureCloudCal(calEmail, calPass)
                      .then((cals) => setCalMsg(`连接成功，发现日历：${cals.join("、")}。`))
                      .catch((e: unknown) => setCalMsg(`连接失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}>{calBusy ? "连接中…" : "保存并验证"}</Btn>
              </Inline>
            </span>
          </div>
        )}
      </Card>
      <Card>
        <SettingsRow
          title={sysSupported === false ? "系统日历同步" : syscal.enabled ? "系统日历同步 · 已开启" : "系统日历同步"}
          sub={
            sysSupported === false ? (
              "本平台不支持直写系统日历；可在「日程」页导出 .ics 再导入。"
            ) : syscal.enabled ? (
              <>
                日历「OneTHU 日程」· 上次同步 {syscal.lastSyncAt ? new Date(syscal.lastSyncAt).toLocaleString() : "—"} · {syscal.lastCount} 条。课表、未提交作业与日程变化后会自动更新。课程提前 15 分钟提醒，作业按提醒设置提前。
                {syscal.lastError ? <ErrorLine text={`最近一次同步失败：${syscal.lastError}`} tone="error" /> : null}
                {sysMsg ? <ErrorLine text={sysMsg} tone="quiet" /> : null}
              </>
            ) : (
              <>
                把课表与日程写入系统日历里的专属日历「OneTHU 日程」（不影响你已有的日历）。开启后自动更新课表、未提交作业与日程；课程与考试提前 15 分钟提醒，作业按提醒设置提前。macOS 日历可能随系统账户同步到其他设备。旧版本的同名日历请核对后自行清理。
                {sysMsg ? <ErrorLine text={sysMsg} tone="quiet" /> : null}
              </>
            )
          }
          control={
            sysSupported === false ? null : syscal.enabled ? (
              <Inline gap={2} wrap>
                <Btn variant="outline" disabled={sysBusy || syscal.syncing} onClick={() => {
                    setSysBusy(true);
                    setSysMsg(null);
                    void syncSystemCalendar()
                      .then((r) =>
                        setSysMsg(r.skipped ? "内容无变化，系统日历已是最新" : `已同步：写入 ${r.added} 条（清理旧 ${r.removed} 条）。`),
                      )
                      .catch((e: unknown) => setSysMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setSysBusy(false));
                  }}>{sysBusy || syscal.syncing ? "同步中…" : "立即同步"}</Btn>
                <Btn variant="outline" disabled={sysBusy} onClick={() => {
                    void disableSystemCalendar()
                      .then(() => setSysMsg("已停止自动同步，已写入的日历与事件保留"))
                      .catch((e: unknown) => setSysMsg(String(e instanceof Error ? e.message : e)));
                  }}>停止自动同步
                </Btn>
                <Btn variant="outline" disabled={sysBusy} onClick={() => {
                    void confirmOk(
                      "确定删除系统日历里的「OneTHU 日程」日历？\n\n其中由 OneTHU 写入的全部事件将被移除；应用内的日程与云同步不受影响。",
                    ).then((yes) => {
                      if (!yes) return;
                      setSysBusy(true);
                      void removeSystemCalendar()
                        .then(() => setSysMsg("已删除系统日历「OneTHU 日程」。"))
                        .catch((e: unknown) => setSysMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`))
                        .finally(() => setSysBusy(false));
                    });
                  }}>清除系统日历
                </Btn>
              </Inline>
            ) : (
              <Btn variant="solid" tone="brand" disabled={sysBusy || sysSupported === null} onClick={() => {
                  setSysBusy(true);
                  setSysMsg(null);
                  void enableSystemCalendar()
                    .then(() => setSysMsg("系统日历「OneTHU 日程」已写入，此后自动保持最新"))
                    .catch((e: unknown) => setSysMsg(`开启失败：${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setSysBusy(false));
                }}>{sysBusy ? "开启中…" : "开启并同步"}</Btn>
            )
          }
        />
      </Card>
  </Stack>;
}
