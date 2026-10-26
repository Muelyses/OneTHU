/** Enumeration guards for the school's offset pages and size-only file endpoint. */
export type LearnEnumerationFailure =
  | "invalid-total" | "missing-id" | "duplicate-id" | "repeated-page"
  | "snapshot-changed" | "incomplete-page" | "limit-exceeded";

export class LearnEnumerationError extends Error {
  readonly code = "LEARN_ENUMERATION_INCOMPLETE";
  readonly complete = false;
  readonly kind: LearnEnumerationFailure;
  readonly resource: string;
  readonly fetched: number;
  readonly total: number | null;
  constructor(
    kind: LearnEnumerationFailure,
    resource: string,
    fetched: number,
    total: number | null,
  ) {
    super(`LEARN_ENUMERATION_INCOMPLETE: ${resource} ${kind} (${fetched}/${total ?? "unknown"})`);
    this.name = "LearnEnumerationError";
    this.kind = kind;
    this.resource = resource;
    this.fetched = fetched;
    this.total = total;
  }
}

export interface LearnRawPage<T> { rows: T[]; total: number | null }

/** Prefer the filtered DataTables count. Never use row count as a server total. */
export function readLearnTotal(payload: Record<string, unknown>, resource: string): number | null {
  const nested = payload.object;
  const sources = nested && typeof nested === "object" && !Array.isArray(nested)
    ? [nested as Record<string, unknown>, payload] : [payload];
  for (const field of ["iTotalDisplayRecords", "iTotalRecords", "totalRecords", "totalCount", "total"]) {
    for (const source of sources) {
      const raw = source[field];
      if (raw === undefined || raw === null) continue;
      const total = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(total) || total < 0) throw new LearnEnumerationError("invalid-total", resource, 0, null);
      return total;
    }
  }
  return null;
}

function idsFor<T>(rows: T[], key: (row: T) => string, resource: string, fetched: number, total: number | null): string[] {
  const ids = rows.map(key);
  if (ids.some(id => !id.trim())) throw new LearnEnumerationError("missing-id", resource, fetched, total);
  if (new Set(ids).size !== ids.length) throw new LearnEnumerationError("duplicate-id", resource, fetched, total);
  return ids;
}

/** Bounded offset enumeration; a duplicate page never masquerades as completion. */
export async function collectLearnOffsetPages<T>(
  resource: string,
  fetchPage: (offset: number, limit: number) => Promise<LearnRawPage<T>>,
  key: (row: T) => string,
  pageSize = 50,
  maxItems = 10_000,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; offset < maxItems;) {
    const page = await fetchPage(offset, Math.min(pageSize, maxItems - offset));
    if (page.total !== null) {
      if (total !== null && total !== page.total) throw new LearnEnumerationError("snapshot-changed", resource, rows.length, page.total);
      total = page.total;
      if (total > maxItems) throw new LearnEnumerationError("limit-exceeded", resource, rows.length, total);
    }
    const ids = idsFor(page.rows, key, resource, rows.length, total);
    if (ids.some(id => seen.has(id))) throw new LearnEnumerationError("repeated-page", resource, rows.length, total);
    if (page.rows.length > pageSize || (total !== null && offset + page.rows.length > total)) {
      throw new LearnEnumerationError("invalid-total", resource, rows.length, total);
    }
    rows.push(...page.rows);
    ids.forEach(id => seen.add(id));
    offset += page.rows.length;
    if (total !== null && rows.length === total) return rows;
    if (page.rows.length === 0 && total !== null) throw new LearnEnumerationError("incomplete-page", resource, rows.length, total);
    if (page.rows.length < pageSize && total === null) {
      return rows;
    }
  }
  throw new LearnEnumerationError("limit-exceeded", resource, rows.length, total);
}

/** The file endpoint accepts size, not offset. Grow the prefix and verify it. */
export async function collectLearnSizePages<T>(
  resource: string,
  fetchPage: (size: number) => Promise<LearnRawPage<T>>,
  key: (row: T) => string,
  initialSize = 200,
  maxItems = 12_800,
): Promise<T[]> {
  let previous: string[] = [];
  let total: number | null = null;
  for (let size = initialSize; size <= maxItems; size = Math.min(size * 2, maxItems)) {
    const page = await fetchPage(size);
    if (page.total !== null) {
      if (total !== null && total !== page.total) throw new LearnEnumerationError("snapshot-changed", resource, previous.length, page.total);
      total = page.total;
      if (total > maxItems) throw new LearnEnumerationError("limit-exceeded", resource, page.rows.length, total);
    }
    const ids: string[] = idsFor(page.rows, key, resource, previous.length, total);
    if (ids.length > size || (total !== null && ids.length > total)) throw new LearnEnumerationError("invalid-total", resource, previous.length, total);
    if (previous.some((id, i) => ids[i] !== id)) throw new LearnEnumerationError("snapshot-changed", resource, previous.length, total);
    if (total !== null && ids.length === total) return page.rows;
    if (previous.length && ids.length === previous.length) throw new LearnEnumerationError("repeated-page", resource, ids.length, total);
    if (ids.length === 0 && total !== null) throw new LearnEnumerationError("incomplete-page", resource, 0, total);
    if (ids.length < size && total === null) return page.rows;
    if (size === maxItems) throw new LearnEnumerationError("limit-exceeded", resource, ids.length, total);
    previous = ids;
  }
  throw new LearnEnumerationError("limit-exceeded", resource, previous.length, total);
}
