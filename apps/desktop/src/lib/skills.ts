import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/index.js";
import { session } from "./clients.js";
import { experienceMode, experienceRevision } from "../state/experienceMode.js";
import { xiaodaClient } from "./xiaoda.js";
import type { XiaodaSkillItem } from "@onethu/core";

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  sha256: string;
  installedAt: number;
  enabled: boolean;
  compatibility: "text" | "javascript" | "external-agent";
  requirements: string[];
  files: string[];
  expandedBytes: number;
}

function owner(): string {
  if (!session.username || session.state !== "ready") throw new Error(t("skills.error.login"));
  return session.username;
}
async function action<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const account = owner();
  const result = await invoke<T>("skills_action", { owner: account, action, ...args });
  if (owner() !== account) throw new Error(t("skills.error.login"));
  return result;
}

export const listSkills = (): Promise<InstalledSkill[]> => action("list");
export const importSkill = (item: XiaodaSkillItem): Promise<InstalledSkill> => action("import", {
  id: item.id, name: item.name, description: item.description ?? "", token: xiaodaClient.getToken(),
});
export const setSkillEnabled = (id: string, enabled: boolean): Promise<InstalledSkill> => action("enable", { id, enabled });
export const deleteSkill = (id: string): Promise<void> => action("delete", { id });
export const exportSkill = (id: string): Promise<string | null> => invoke("skills_export", { owner: owner(), id });

/** No installed content is automatically made active by sync or switching modes. */
export async function searchSkills(query = ""): Promise<Array<Pick<InstalledSkill, "id" | "name" | "description">>> {
  if (experienceMode() !== "full") return [];
  const terms = String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const revision = experienceRevision();
  const installed = await listSkills();
  if (experienceMode() !== "full" || revision !== experienceRevision()) return [];
  return installed.filter(s => s.enabled && s.compatibility !== "external-agent" && terms.every(term => `${s.name} ${s.description}`.toLocaleLowerCase().includes(term)))
    .map(({ id, name, description }) => ({ id, name, description }));
}
async function ohAction(kind: string, args: Record<string, unknown>): Promise<unknown> {
  if (experienceMode() !== "full") throw new Error(t("skills.error.fullMode"));
  const revision = experienceRevision();
  const result = await action(kind, args);
  if (experienceMode() !== "full" || revision !== experienceRevision()) throw new Error(t("skills.error.fullMode"));
  return result;
}
export function readSkill(id: string, path?: string): Promise<unknown> {
  return ohAction(path ? "read" : "load", { id, ...(path ? { path } : {}) });
}
export function computeSkill(code: string, input: unknown): Promise<unknown> {
  return ohAction("compute", { code, input });
}
export function runSkill(id: string, path: string, input: unknown): Promise<unknown> {
  return ohAction("run", { id, path, input });
}

export function skillError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const keys: Record<string, string> = {
    SKILL_LOGIN_REQUIRED: t("skills.error.login"), SKILL_DOWNLOAD_FAILED: t("skills.error.download"),
    SKILL_PACKAGE_TOO_LARGE: t("skills.error.large"), SKILL_TOO_MANY_FILES: t("skills.error.large"),
    SKILL_INVALID_ZIP: t("skills.error.package"), SKILL_INVALID_MANIFEST: t("skills.error.package"),
    SKILL_MISSING_MANIFEST: t("skills.error.manifest"), SKILL_AMBIGUOUS_ROOT: t("skills.error.manifest"),
    SKILL_UNSAFE_PATH: t("skills.error.path"), SKILL_DUPLICATE_PATH: t("skills.error.path"),
    SKILL_EXTERNAL_AGENT_REQUIRED: t("skills.externalBody"), SKILL_NOT_ENABLED: t("skills.error.disabled"),
    SKILL_TIME_LIMIT: t("skills.error.time"), SKILL_SCRIPT_FAILED: t("skills.error.script"),
    SKILL_CODE_TOO_LARGE: t("skills.error.code"), SKILL_INPUT_TOO_LARGE: t("skills.error.code"), SKILL_OUTPUT_TOO_LARGE: t("skills.error.code"),
    SKILL_RUNTIME_FAILED: t("skills.error.runtime"), SKILL_NOT_FOUND: t("skills.error.notFound"),
    SKILL_INVALID_INPUT: t("skills.error.input"), SKILL_INVALID_OUTPUT: t("skills.error.output"),
    SKILL_TEXT_ONLY: t("skills.error.text"), SKILL_TEXT_TOO_LARGE: t("skills.error.textSize"),
    SKILL_INVALID_ID: t("skills.error.notFound"), SKILL_BUSY: t("skills.error.busy"),
    SKILL_UNKNOWN_ACTION: t("skills.error.generic"),
  };
  return keys[raw] ? keys[raw] : /^SKILL_[A-Z_]+$/.test(raw) ? t("skills.error.generic") : raw;
}
