/**
 * Read a Jupyter notebook's frontmatter without parsing the entire .ipynb
 * JSON body as Markdown. Closes blog-plugin#13.
 *
 * Two conventions are supported:
 *
 *   1. Cell metadata — `cells[0].metadata.frontmatter = {title: ..., date: ...}`
 *      (preferred — what jupyterlab-myst writes when you edit notebook
 *      frontmatter through the JupyterLab UI).
 *
 *   2. First-cell source — a leading markdown cell whose source is a YAML
 *      block delimited by `---` lines, e.g.
 *
 *        ---
 *        title: My Post
 *        date: 2025-05-07
 *        ---
 *
 *      (the older, hand-edited convention; what most existing notebooks use).
 *
 * Returns a synthetic AST root containing a single `yaml` node whose `value`
 * is the YAML text. That shape is the same one mystmd's `getFrontmatter`
 * helper expects for `.md` files, so the caller can run the same parsing /
 * validation pipeline regardless of input file type.
 */
import type { GenericParent } from "myst-common";

type RawNotebook = {
  cells?: Array<{
    cell_type?: string;
    source?: string | string[];
    metadata?: Record<string, unknown>;
  }>;
};

function joinSource(source: string | string[] | undefined): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.join("");
  return "";
}

/**
 * Extract a YAML block from the start of a markdown source string.
 *
 * Recognizes:
 *   - "---\n...\n---"
 *   - "---\n...\n---\n<additional content>"
 * Returns the inner YAML or null if no leading frontmatter block is found.
 */
function extractLeadingYamlBlock(source: string): string | null {
  // Trim leading whitespace/newlines without losing the body inside the block.
  const trimmed = source.replace(/^\s+/, "");
  if (!trimmed.startsWith("---")) return null;
  // Match opening ---, capture everything up to closing ---.
  const m = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(trimmed);
  if (!m) return null;
  return m[1];
}

/**
 * Convert a key/value object back into a YAML-ish string.
 *
 * We do not pull in a YAML serializer dependency just for this — the values
 * we serialize are simple scalars and arrays of scalars (post frontmatter:
 * title, date, tags, authors, category, etc). For anything more exotic we
 * fall back to JSON encoding, which is valid YAML.
 */
function objectToYamlText(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      // Quote strings only if they contain YAML-significant chars.
      if (typeof value === "string" && /[:#\[\]{}&*!|>'"%@`,?-]/.test(value)) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (Array.isArray(value)) {
      // Inline flow style — readable, valid YAML.
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === "object") {
      // Object (e.g., authors). JSON-encode; valid YAML.
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Read frontmatter from an .ipynb file's raw JSON content. Returns a
 * synthetic AST root with a single `yaml` child, or an empty root if no
 * frontmatter could be found.
 *
 * Throws nothing — all failure paths return an empty root so the caller can
 * decide whether to warn.
 */
export function parseNotebookAsAst(content: string): GenericParent {
  const empty: GenericParent = { type: "root", children: [] };
  let nb: RawNotebook;
  try {
    nb = JSON.parse(content);
  } catch {
    return empty;
  }
  const cells = nb.cells;
  if (!Array.isArray(cells) || cells.length === 0) return empty;

  // Convention 1: structured frontmatter in cell.metadata.frontmatter
  const metaFm = cells[0]?.metadata?.frontmatter;
  if (metaFm && typeof metaFm === "object" && !Array.isArray(metaFm)) {
    return {
      type: "root",
      children: [
        { type: "code", lang: "yaml", value: objectToYamlText(metaFm as Record<string, unknown>) } as any,
      ],
    };
  }

  // Convention 2: leading markdown cell with --- YAML --- block
  const first = cells[0];
  if (first?.cell_type === "markdown") {
    const yaml = extractLeadingYamlBlock(joinSource(first.source));
    if (yaml !== null) {
      return {
        type: "root",
        children: [{ type: "code", lang: "yaml", value: yaml } as any],
      };
    }
  }

  return empty;
}
