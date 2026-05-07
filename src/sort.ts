/**
 * Sort helpers for the {blog-posts} directive.
 *
 * Existing: <field>-<asc|desc>, default date-desc.
 * Extensions:
 *   - random: deterministically shuffled, seeded by a hash of the post paths so
 *     the order is reproducible within and across builds with the same input set.
 *   - pinned-first modifier: prefix any sort with "pinned-first," to put posts
 *     with frontmatter pinned: true at the top, sorted normally within each group.
 */

/** djb2-style string hash. Returns a uint32. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic, fast, plenty random for shuffling small lists. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle in place using a seeded PRNG. */
function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function compareField(a: any, b: any, field: string, ascending: boolean): number {
  const aValue = a.frontmatter[field as keyof typeof a.frontmatter];
  const bValue = b.frontmatter[field as keyof typeof b.frontmatter];
  if (!aValue && !bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  const cmp = String(aValue).localeCompare(String(bValue), undefined, { numeric: true });
  return ascending ? cmp : -cmp;
}

/**
 * Sort posts by the given sort spec.
 *
 * Spec syntax:
 *   "field"            → field-asc
 *   "field-asc"        → ascending
 *   "field-desc"       → descending
 *   "random"           → deterministic shuffle (seeded by post path hash)
 *   "pinned-first,<spec>" → pinned posts first, then sort each group by <spec>
 */
export function applySort(posts: any[], sortOption: string): any[] {
  let spec = sortOption.trim();
  let pinnedFirst = false;
  if (spec.toLowerCase().startsWith("pinned-first")) {
    pinnedFirst = true;
    // Strip "pinned-first" and any leading separator (",", "+", or whitespace).
    spec = spec.slice("pinned-first".length).replace(/^[,+\s]+/, "");
    if (spec.length === 0) spec = "date-desc";
  }

  const innerSorted = sortInner(posts, spec);

  if (!pinnedFirst) return innerSorted;

  const pinned = innerSorted.filter((p) => p.frontmatter?.pinned === true);
  const rest = innerSorted.filter((p) => p.frontmatter?.pinned !== true);
  return [...pinned, ...rest];
}

function sortInner(posts: any[], spec: string): any[] {
  if (spec.toLowerCase() === "random") {
    // Seed from sorted post paths so the shuffle is stable across builds when
    // the post set hasn't changed. Within a build, two calls with the same
    // posts produce the same order.
    const seed = hashString(posts.map((p) => p.path).sort().join("\n"));
    return shuffleSeeded(posts, seed);
  }
  const [field, order = "asc"] = spec.split("-");
  const ascending = order.toLowerCase() === "asc";
  return posts.slice().sort((a, b) => compareField(a, b, field, ascending));
}
