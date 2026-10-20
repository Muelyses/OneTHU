import { t } from "../../i18n/index.js";

/** Resolve app-authored failures at render time; leave school responses unchanged. */
export function localizeLibraryError(message: string): string {
  if (message === "图书馆登录状态未能恢复，请先重试；若仍失败，请在设置中重新登录"
    || message.startsWith("图书馆 access_token 获取失败（")) {
    return t("library.session.recoveryFailed");
  }
  if (message.startsWith("图书馆座位系统会话未能建立（现场: ")) {
    return t("library.session.unavailable");
  }
  if (message === "图书馆会话已失效，请重试" || message.startsWith("图书馆会话已失效，请重试。")) {
    return t("library.session.expired");
  }
  return message;
}
