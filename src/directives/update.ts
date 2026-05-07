/**
 * The {update} directive.
 *
 * Marks a post update at the location it appears in the document. Renders as
 * a note-style admonition titled "Update — <date>". Strict ISO-8601 dates only.
 *
 * Migration note: ablog accepted free-form strings like "15 March, 2020".
 * mystmd does not — we follow ISO-8601 to keep dates parseable for sort,
 * filter, and feed generation. This is locked in DESIGN.md §5 / §14.
 *
 *   ```{update} 2026-04-20
 *   Added a third example.
 *   ```
 */
import { fileError, RuleId } from "myst-common";
import type { DirectiveSpec } from "myst-common";

// YYYY-MM-DD, optionally with time + tz. No "Z 13:45" type oddities.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/;

export const updateDirective: DirectiveSpec = {
  name: "update",
  doc: "Mark a post update at the current point in the document. Renders as a note admonition. Requires a strict ISO-8601 date.",
  arg: {
    type: String,
    required: true,
    doc: "Update date in ISO-8601 (e.g., 2026-04-20 or 2026-04-20T15:00:00Z).",
  },
  body: {
    type: "myst",
    required: false,
    doc: "Markdown content describing what changed.",
  },
  run(data, vfile, _ctx) {
    const dateRaw = String(data.arg ?? "").trim();
    if (!ISO_DATE_RE.test(dateRaw)) {
      fileError(
        vfile,
        `{update} requires a strict ISO-8601 date, got "${dateRaw}". (ablog accepted "15 March, 2020"-style strings; mystmd does not.)`,
        { ruleId: RuleId.directiveArgumentCorrect },
      );
      return [];
    }
    const bodyNodes = Array.isArray(data.body) ? data.body : [];
    return [
      {
        type: "admonition",
        kind: "note",
        class: "update",
        children: [
          {
            type: "admonitionTitle",
            children: [{ type: "text", value: `Update — ${dateRaw}` }],
          },
          ...bodyNodes,
        ],
      },
    ];
  },
};
