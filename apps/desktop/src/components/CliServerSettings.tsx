import { Btn, Inline, SettingsRow, Switch } from "@onethu/gui";
import { t, useLocale } from "../i18n/index.js";
import { cliAutoExecuteEnabled, setCliAutoExecute, setMcpServer, subscribeUserExt } from "../state/userext.js";
import { syncCliRuntime, useCliRuntime } from "../state/cliRuntime.js";
import { useEffect, useSyncExternalStore } from "react";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { CliTasksSettings } from "./CliTasksSettings.js";
import "./CliTasksSettings.css";

export function CliServerSettings() {
  useLocale();
  const state = useCliRuntime();
  const automatic = useSyncExternalStore(subscribeUserExt, cliAutoExecuteEnabled, () => false);
  const desktop = !isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
  useEffect(() => { void syncCliRuntime(); }, []);
  const message = state.handoffPending ? t("cli.server.handoffPending") : !state.requested ? t("cli.server.off") : !state.authorized ? t("cli.server.authorization")
    : state.phase === "syncing" ? t("cli.server.syncing") : state.reachableNow ? state.background ? t("cli.server.background") : t("cli.server.ready", { endpoint: state.cliEndpoint ?? "http://127.0.0.1:8787/cli/v1" })
    : state.errorCode === "listener-unavailable" ? t("cli.server.portBusy") : state.errorCode === "listener-not-started" ? t("cli.server.desktopOnly") : state.phase === "stopped" ? t("cli.server.stopped") : t("cli.server.error");
  return <><SettingsRow id="row-oh-mcp-server" title="OneTHU CLI" sub={message} control={<Inline gap={2}>
    {(state.requested || state.handoffPending) && !state.reachableNow && state.phase !== "syncing" ? <Btn variant="ghost" onClick={() => void syncCliRuntime()}>{t("cli.server.retry")}</Btn> : null}
    <Switch checked={state.requested} aria-label="OneTHU CLI" onChange={setMcpServer}/>
  </Inline>}/>
    {desktop ? <SettingsRow id="row-cli-auto-execute" title={t("cli.auto.title")}
      sub={automatic ? t("cli.auto.enabled") : t("cli.auto.description")}
      control={<Switch checked={automatic} aria-label={t("cli.auto.title")}
        disabled={!automatic && (!state.requested || !state.authorized)} onChange={setCliAutoExecute}/>}/> : null}
    {desktop && state.requested && state.authorized ? <CliTasksSettings/> : null}
  </>;
}
