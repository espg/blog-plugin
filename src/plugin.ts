import { globSync } from "glob";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { getFrontmatter } from "myst-transforms";
import { validatePageFrontmatter } from "myst-frontmatter";
import { fileError, fileWarn, RuleId } from "myst-common";
import type { DirectiveSpec } from "myst-common";
import { renderCards } from "./renderers/card.js";
import { renderTable } from "./renderers/table.js";
import { renderList } from "./renderers/list.js";
import { renderCompact } from "./renderers/compact.js";
import { applyFilters, parseCommaList, warnUnknownFilterValues, type Filters } from "./filters.js";
import { applySort } from "./sort.js";
import { updateDirective } from "./directives/update.js";
import { parseNotebookAsAst, extractNotebookBodyMarkdown } from "./notebookFrontmatter.js";

const VALID_LIST_STYLES = new Set(["none", "disc", "circle", "square", "decimal"]);
const VALID_KINDS = new Set(["card", "table", "list", "compact"]);

const blogPostsDirective: DirectiveSpec = {
  name: "blog-posts",
  doc: "Display preview cards / tables / lists for posts.",
  options: {
    // ── existing options (preserved) ─────────────────────────────────────
    limit: { type: Number, doc: "Number of posts." },
    path: { type: String, doc: "Path to posts. Supports glob patterns like 'posts/**/*.md' to include subfolders." },
    "default-title": { type: String, doc: "Default title if none given." },
    kind: { type: String, doc: "Display style: 'card', 'table', 'list', or 'compact'. Default is 'card'." },
    "table-columns": { type: String, doc: "Comma-separated list of frontmatter fields to display as table columns. Default is 'title,date'." },
    sort: { type: String, doc: "Sort posts. Format: 'field-asc', 'field-desc', or just 'field' (defaults to asc). Special values: 'random' (deterministic shuffle, seeded by post paths). Modifier: prefix with 'pinned-first,' to pin posts whose frontmatter has pinned: true. Default is 'date-desc'." },

    // ── filter options (new) ─────────────────────────────────────────────
    tags: { type: String, doc: "Comma list. Include posts whose `tags` frontmatter contains any of these values. Case-insensitive." },
    author: { type: String, doc: "Comma list. Include posts whose `authors[].name` matches any of these. Case-insensitive." },
    category: { type: String, doc: "Comma list. Include posts whose `category` frontmatter matches any. Case-insensitive." },
    location: { type: String, doc: "Comma list. Include posts whose `location` frontmatter matches any. Case-insensitive." },
    language: { type: String, doc: "Comma list. Include posts whose `language` frontmatter (BCP-47) matches any. Case-insensitive." },

    // ── display options (new) ────────────────────────────────────────────
    excerpts: { type: Boolean, doc: "Render the post's excerpt under each title." },
    format: { type: String, doc: "Format string for kind=list/compact. Placeholders: {date}, {title}, {author}, {tags}, {category}, {excerpt}. Default '{date} — {title}'." },
    "list-style": { type: String, doc: "When kind=list: bullet style. One of 'none', 'disc', 'circle', 'square', 'decimal'. Default 'none'." },
    expand: { type: String, doc: "Link text shown after each excerpt. Default 'Read more'." },
    image: { type: Boolean, doc: "Show post's `image` frontmatter as a thumbnail (kind=card only). String image paths only in v1; integer indices into post body images are not yet supported." },
  },
  run(data, vfile, ctx) {
    // ── parse options ────────────────────────────────────────────────────
    const size = (data.options?.limit as number | undefined) ?? 10;
    const searchPath = (data.options?.path as string | undefined) ?? "posts";
    const defaultTitle =
      (data.options?.["default-title"] as string | undefined) ??
      "<Untitled Post>";
    const kind = ((data.options?.kind as string | undefined) ?? "card").toLowerCase();
    if (!VALID_KINDS.has(kind)) {
      fileWarn(vfile, `Unknown {blog-posts} kind="${kind}"; falling back to 'card'.`, {
        ruleId: RuleId.directiveOptionsCorrect,
      });
    }
    const effectiveKind = VALID_KINDS.has(kind) ? kind : "card";

    const filters: Filters = {
      tags: parseCommaList(data.options?.tags),
      author: parseCommaList(data.options?.author),
      category: parseCommaList(data.options?.category),
      location: parseCommaList(data.options?.location),
      language: parseCommaList(data.options?.language),
    };

    const excerpts = Boolean(data.options?.excerpts);
    const format = (data.options?.format as string | undefined) ?? "{date} — {title}";
    const expand = (data.options?.expand as string | undefined) ?? "Read more";
    const image = Boolean(data.options?.image);
    let listStyle = ((data.options?.["list-style"] as string | undefined) ?? "none").toLowerCase();
    if (!VALID_LIST_STYLES.has(listStyle)) {
      fileWarn(vfile, `Unknown {blog-posts} list-style="${listStyle}"; falling back to 'none'.`, {
        ruleId: RuleId.directiveOptionsCorrect,
      });
      listStyle = "none";
    }

    // ── glob + frontmatter parse ─────────────────────────────────────────
    // Support glob patterns in the path parameter
    // If the path contains glob patterns (*, ?, [, or **), use it directly
    // Otherwise, append *.md to match all markdown files in that directory
    const globPattern = /[*?\[]|\*\*/;
    const searchPattern = globPattern.test(searchPath)
      ? searchPath
      : join(searchPath, "*.md");

    const paths = globSync(searchPattern);

    // Collect post data from all files
    const allPosts = paths.map((path) => {
      const ext = extname(path);
      const content = readFileSync(path, { encoding: "utf-8" });
      // Files without a `date:` aren't blog posts — skip them. This is also
      // what prevents recursive parsing when a glob matches a section-index
      // file that itself contains a {blog-posts} directive: those index files
      // never have `date:`, so we bail before ctx.parseMyst would re-enter
      // this directive's run().
      if (ext === ".md") {
        const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm || !/^date:\s*\S/m.test(fm[1])) return null;
      }
      // For .ipynb files, parse only the notebook's frontmatter — passing the
      // raw notebook JSON to ctx.parseMyst is both wrong (it isn't Markdown)
      // and pathological (large notebooks have hung the build). Closes #13.
      const ast = ext === ".ipynb"
        ? parseNotebookAsAst(content)
        : ctx.parseMyst(content);

      // For excerpt-from-body, notebooks need a separate parse: the synthetic
      // ast above only carries frontmatter. Pull a few leading markdown cells
      // and run them through ctx.parseMyst to get paragraph nodes.
      const bodyAst = ext === ".ipynb"
        ? ctx.parseMyst(extractNotebookBodyMarkdown(content, 3))
        : ast;

      // Capture the raw YAML *before* getFrontmatter consumes / removes the
      // node from the AST. This is how we recover blog-specific fields that
      // mystmd's PageFrontmatter validator doesn't know about (category,
      // location, excerpt, pinned). See extractBlogFieldsFromYaml().
      const rawYaml = extractRawYamlFromAst(ast);
      const frontmatter = validatePageFrontmatter(
        getFrontmatter(vfile, ast).frontmatter,
        {
          property: "frontmatter",
          file: vfile.path,
          messages: {},
          errorLogFn: (message) => {
            fileError(vfile, message, {
              ruleId: RuleId.validPageFrontmatter,
            });
          },
          warningLogFn: (message) => {
            fileWarn(vfile, message, {
              ruleId: RuleId.validPageFrontmatter,
            });
          },
        },
      );

      return {
        path,
        url: `/${path.toString().slice(0, -ext.length)}`,
        // First few paragraph nodes from the post body, so renderers can
        // honor `excerpt: N` (take the first N paragraphs) without re-reading
        // the file. Cap at MAX_BODY_PARAGRAPHS to bound memory.
        bodyParagraphs: extractBodyParagraphs(bodyAst, MAX_BODY_PARAGRAPHS),
        frontmatter: {
          ...frontmatter,
          title: frontmatter.title ?? defaultTitle,
          // Expose blog-specific fields that mystmd's PageFrontmatter validator
          // strips (category, location, excerpt, pinned, image) so filters and
          // renderers can read them. We re-parse from the raw YAML captured
          // before getFrontmatter mutated the AST.
          ...extractBlogFieldsFromYaml(rawYaml),
        },
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);

    // ── filter ───────────────────────────────────────────────────────────
    const anyFilterSet = Boolean(
      filters.tags || filters.author || filters.category || filters.location || filters.language,
    );
    if (anyFilterSet) {
      warnUnknownFilterValues(vfile, allPosts, filters);
    }
    const filteredPosts = anyFilterSet ? applyFilters(allPosts, filters) : allPosts;

    // ── sort ─────────────────────────────────────────────────────────────
    const sortOption = (data.options?.sort as string | undefined) ?? "date-desc";
    const sortedPosts = applySort(filteredPosts, sortOption);

    // ── limit ────────────────────────────────────────────────────────────
    const limitedPosts = sortedPosts.slice(0, size);

    // ── render ───────────────────────────────────────────────────────────
    if (effectiveKind === "table") {
      const tableColumns = ((data.options?.["table-columns"] as string | undefined) ?? "title,date")
        .split(",")
        .map(c => c.trim())
        .filter(c => c.length > 0);
      return renderTable(limitedPosts, tableColumns);
    } else if (effectiveKind === "list") {
      return renderList(limitedPosts, ctx, {
        format,
        listStyle: listStyle as any,
        excerpts,
        expand,
      });
    } else if (effectiveKind === "compact") {
      return renderCompact(limitedPosts, ctx, { format, excerpts, expand });
    } else {
      return renderCards(limitedPosts, ctx, { excerpts, expand, image });
    }
  },
};

/**
 * mystmd's validatePageFrontmatter only retains a fixed set of standard fields.
 * Blog-specific fields (category, location, excerpt, pinned, image) are dropped
 * with a warning. Re-extract them from the original AST frontmatter so filters
 * and renderers can see them.
 *
 * This is the workaround for the same constraint discussed in DESIGN.md §16:
 * the blog-plugin layer needs blog-specific fields that mystmd core hasn't
 * standardized yet. Once they land in PageFrontmatter, this helper goes away.
 */
function extractRawYamlFromAst(ast: any): string {
  // The leading YAML frontmatter node lives at ast.children[0], or — when
  // mystmd wraps the document in a `block` — at ast.children[0].children[0].
  // Match getFrontmatter's own traversal pattern from myst-transforms.
  let top = ast?.children?.[0];
  if (top?.type === "block") top = top?.children?.[0];
  if (!top || top.type !== "code" || top.lang !== "yaml" || typeof top.value !== "string") return "";
  return top.value;
}

// Cap on how many leading paragraphs we cache per post — supports
// excerpt: N up to this many paragraphs.
const MAX_BODY_PARAGRAPHS = 5;

/**
 * Walk the parsed AST and pull out the first N top-level paragraph nodes
 * from the post body. Skips the leading YAML frontmatter (a `code` node with
 * lang: "yaml") and descends into mystmd's `block` wrapper nodes.
 *
 * Returns paragraph nodes (block-level), not their inline children — callers
 * decide whether to render them as separate paragraphs or flatten to inline.
 */
function extractBodyParagraphs(ast: any, max: number): any[] {
  const out: any[] = [];
  const visit = (node: any) => {
    if (out.length >= max || !node) return;
    if (node.type === "paragraph") {
      out.push(node);
      return;
    }
    if (node.type === "code" && node.lang === "yaml") return;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
        if (out.length >= max) return;
      }
    }
  };
  visit(ast);
  return out;
}

function extractBlogFieldsFromYaml(yaml: string): Record<string, unknown> {
  if (!yaml) return {};
  const out: Record<string, unknown> = {};
  // Cheap parse: pull the keys we care about line-by-line. Avoids pulling in
  // a full YAML parser for a hot path. Only handles scalar values; lists and
  // nested objects fall through (which is fine for these particular fields).
  for (const key of ["category", "location", "excerpt", "pinned", "image", "language"]) {
    const re = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, "m");
    const m = re.exec(yaml);
    if (!m) continue;
    let raw = m[1].trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    if (raw === "true") out[key] = true;
    else if (raw === "false") out[key] = false;
    else if (/^-?\d+$/.test(raw)) out[key] = parseInt(raw, 10);
    else out[key] = raw;
  }
  return out;
}

const plugin = { name: "Blog posts", directives: [blogPostsDirective, updateDirective] };

export default plugin;
