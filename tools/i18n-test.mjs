// Public entry point shared by engineering and translation handoff.
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
await import("./i18n/check.mjs");
await import("./i18n/widget-fallback.mjs");
