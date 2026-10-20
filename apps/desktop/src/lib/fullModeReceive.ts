import { t } from "../i18n/index.js";
import { experienceMode, experienceRevision } from "../state/experienceMode.js";

/** A mode round trip must not revive an earlier read, scan or invitation. */
export function fullModeReceiveSession() {
  const revision = experienceRevision();
  const isCurrent = (): boolean => experienceMode() === "full" && experienceRevision() === revision;
  const assertCurrent = (): void => {
    if (!isCurrent()) throw new Error(t("friends.modeChanged"));
  };
  return { isCurrent, assertCurrent };
}
