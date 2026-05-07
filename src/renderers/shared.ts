/**
 * Shared rendering helpers used across list/compact renderers.
 */

export function postUrl(post: any): string {
  return post.url ?? "#";
}

function authorString(post: any): string {
  const authors = post?.frontmatter?.authors;
  if (!Array.isArray(authors)) return "";
  return authors
    .map((a) => (typeof a === "string" ? a : a?.name ?? ""))
    .filter(Boolean)
    .join(", ");
}

function tagsString(post: any): string {
  const tags = post?.frontmatter?.tags;
  if (!Array.isArray(tags)) return "";
  return tags.join(", ");
}

function rawString(post: any, field: string): string {
  const v = post?.frontmatter?.[field];
  return v == null ? "" : String(v);
}

/**
 * Render a format string with placeholder substitution back into inline AST nodes.
 *
 * Placeholders: {date}, {title}, {author}, {tags}, {category}, {excerpt}.
 * The {title} placeholder, when present, is wrapped in a link to the post URL
 * (controlled by opts.linkTitleTo). Other placeholders render as plain text.
 *
 * Returns an array of inline nodes suitable for embedding in a paragraph.
 */
export function renderFormat(
  format: string,
  post: any,
  ctx: any,
  opts: { linkTitleTo?: string } = {},
): any[] {
  const values: Record<string, string> = {
    date: rawString(post, "date"),
    title: rawString(post, "title") || "<Untitled Post>",
    author: authorString(post),
    tags: tagsString(post),
    category: rawString(post, "category"),
    excerpt: rawString(post, "excerpt"),
  };

  const tokenRe = /\{(date|title|author|tags|category|excerpt)\}/g;
  const out: any[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(format)) !== null) {
    if (match.index > lastIndex) {
      out.push({ type: "text", value: format.slice(lastIndex, match.index) });
    }
    const key = match[1];
    const v = values[key] ?? "";
    if (key === "title" && opts.linkTitleTo) {
      out.push({
        type: "link",
        url: opts.linkTitleTo,
        children: [{ type: "text", value: v }],
      });
    } else {
      out.push({ type: "text", value: v });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < format.length) {
    out.push({ type: "text", value: format.slice(lastIndex) });
  }
  return out;
}

/**
 * Best-effort excerpt extraction. Honors the post's `excerpt` frontmatter:
 *   - string  → render the string as inline markdown.
 *   - false   → no excerpt.
 *   - int N   → take the first N paragraphs of the post body. (We approximate
 *               body-paragraph extraction by re-parsing post.path's contents.
 *               If body parsing is unavailable, returns []).
 *   - unset   → []. (Project-wide post_auto_excerpt fallback is the parent
 *               directive's responsibility, applied before reaching this helper.)
 *
 * Returns an array of inline AST nodes (suitable for inclusion in a paragraph).
 */
export function postExcerptInline(post: any, ctx: any): any[] {
  const excerpt = post?.frontmatter?.excerpt;
  if (excerpt === false) return [];
  if (typeof excerpt === "string" && excerpt.length > 0) {
    const parsed = ctx.parseMyst(excerpt);
    const first = parsed?.children?.find((c: any) => c.type === "paragraph");
    if (first) return first.children ?? [];
    return [{ type: "text", value: excerpt }];
  }
  // For integer N or unset: return empty for now. Body-paragraph extraction
  // requires either a re-parse of the file or a richer post object than the
  // upstream directive currently has. Tracked as a follow-up.
  return [];
}
