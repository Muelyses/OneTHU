import { readDataSource } from "./dictionary.mjs";

/** Runs before TS/React transforms, including every dev-server HMR update. */
export function i18nDictionaryGuard() {
  return {
    name: "onethu-i18n-data-only",
    enforce: "pre",
    transform(source, id) {
      const path = id.split("?")[0].replaceAll("\\", "/");
      if (!/\/src\/i18n\/locales\/[^/]+\.ts$/.test(path)) return null;
      const data = readDataSource(source, path);
      if (!data || typeof data.label !== "string" || !data.label.trim() || !data.messages || typeof data.messages !== "object" || Array.isArray(data.messages) ||
          Object.keys(data).some(key => !["label", "messages"].includes(key)) ||
          Object.values(data.messages).some(value => typeof value !== "string")) {
        throw new Error(`${path}: a locale must be pure { label, messages } string data`);
      }
      return null;
    },
  };
}
