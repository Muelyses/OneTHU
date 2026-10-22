import { createContext, useContext } from "react";
import { cacheGet, cacheSet, cacheFetch, type CacheEntry } from "./cache.js";

export interface DataScope {
  preview: boolean;
  cacheGet: typeof cacheGet;
  cacheSet: typeof cacheSet;
  cacheFetch: typeof cacheFetch;
}
const live: DataScope = { preview: false, cacheGet, cacheSet, cacheFetch };
export const PreviewDataContext = createContext<DataScope | null>(null);

/** Each preview tree owns its data. Normal pages and background snapshots use live stores. */
export function createPreviewScope(entries: ReadonlyMap<string, CacheEntry<unknown>>): DataScope {
  const get = <T,>(key: string): CacheEntry<T> | null => {
    const entry = entries.get(key) ?? entries.get(key.split(":")[0] ?? key);
    return (entry as CacheEntry<T> | undefined) ?? null;
  };
  return {
    preview: true,
    cacheGet: get,
    // Preview interactions cannot write caches, persist data or start requests.
    cacheSet: () => undefined,
    cacheFetch: <T,>(key: string): Promise<T> => {
      const entry = get<T>(key);
      return entry ? Promise.resolve(entry.data) : Promise.reject(new Error("Missing preview fixture: " + key));
    },
  };
}
export function useDataScope(): DataScope {
  const scoped = useContext(PreviewDataContext);
  return scoped ?? live;
}
