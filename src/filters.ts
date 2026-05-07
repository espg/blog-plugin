/**
 * Filter helpers for the {blog-posts} directive.
 *
 * Within a field: OR (any value matches → post is kept).
 * Across fields: AND (all set filters must match).
 * Unknown filter values: empty match → fileWarn, not fileError.
 */
import { fileWarn, RuleId } from "myst-common";
import type { VFile } from "vfile";

export type Filters = {
  tags?: string[];
  author?: string[];
  category?: string[];
  location?: string[];
  language?: string[];
};

/** Parse a comma-separated directive option into a normalized lowercase string array. */
export function parseCommaList(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/** Extract author display names from a post's authors frontmatter (handles strings and {name: ...} objects). */
function authorNames(authors: unknown): string[] {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object" && "name" in a) return String((a as any).name ?? "");
      return "";
    })
    .filter(Boolean)
    .map((n) => n.toLowerCase());
}

function postTagsLower(post: any): string[] {
  const tags = post?.frontmatter?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t).toLowerCase());
}

function postFieldLower(post: any, field: string): string {
  const v = post?.frontmatter?.[field];
  return v == null ? "" : String(v).toLowerCase();
}

/** Apply filters to a post array. Returns kept posts. */
export function applyFilters(posts: any[], filters: Filters): any[] {
  return posts.filter((post) => {
    if (filters.tags) {
      const postTags = postTagsLower(post);
      if (!filters.tags.some((t) => postTags.includes(t))) return false;
    }
    if (filters.author) {
      const names = authorNames(post?.frontmatter?.authors);
      if (!filters.author.some((a) => names.includes(a))) return false;
    }
    if (filters.category) {
      const cat = postFieldLower(post, "category");
      if (!filters.category.includes(cat)) return false;
    }
    if (filters.location) {
      const loc = postFieldLower(post, "location");
      if (!filters.location.includes(loc)) return false;
    }
    if (filters.language) {
      const lang = postFieldLower(post, "language");
      if (!filters.language.includes(lang)) return false;
    }
    return true;
  });
}

/**
 * For each requested filter value, check whether any post in the *unfiltered* set
 * has that value. If not, emit a warning to help users catch typos.
 *
 * Per DESIGN.md §4.3: "Unknown filter values → empty result, build warns. Not an error."
 */
export function warnUnknownFilterValues(vfile: VFile, allPosts: any[], filters: Filters): void {
  if (filters.tags) {
    const universe = new Set<string>();
    for (const p of allPosts) for (const t of postTagsLower(p)) universe.add(t);
    for (const v of filters.tags) {
      if (!universe.has(v)) {
        fileWarn(vfile, `Unknown {blog-posts} filter value tags="${v}" — no posts match`, {
          ruleId: RuleId.directiveOptionsCorrect,
        });
      }
    }
  }
  if (filters.author) {
    const universe = new Set<string>();
    for (const p of allPosts) for (const n of authorNames(p?.frontmatter?.authors)) universe.add(n);
    for (const v of filters.author) {
      if (!universe.has(v)) {
        fileWarn(vfile, `Unknown {blog-posts} filter value author="${v}" — no posts match`, {
          ruleId: RuleId.directiveOptionsCorrect,
        });
      }
    }
  }
  for (const field of ["category", "location", "language"] as const) {
    const requested = filters[field];
    if (!requested) continue;
    const universe = new Set<string>();
    for (const p of allPosts) {
      const v = postFieldLower(p, field);
      if (v) universe.add(v);
    }
    for (const v of requested) {
      if (!universe.has(v)) {
        fileWarn(vfile, `Unknown {blog-posts} filter value ${field}="${v}" — no posts match`, {
          ruleId: RuleId.directiveOptionsCorrect,
        });
      }
    }
  }
}
