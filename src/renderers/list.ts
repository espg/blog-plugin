/**
 * Renders blog posts as a flat <ul>/<ol> list with optional excerpts.
 *
 * Honors:
 *   - format:      template like "{date} — {title}" (default).
 *                  Placeholders: {date}, {title}, {author}, {tags}, {category}, {excerpt}.
 *   - listStyle:   none | disc | circle | square | decimal.
 *                  "decimal" produces an ordered list; the others are unordered with the
 *                  matching CSS list-style. "none" → no bullet.
 *   - excerpts:    if true, render the post's excerpt as a sub-paragraph after the title line.
 *   - expand:      link text shown after each excerpt (default "Read more").
 *   - image:       reserved (currently unused in list mode; cards/compact carry images).
 */
export type ListOptions = {
  format: string;
  listStyle: "none" | "disc" | "circle" | "square" | "decimal";
  excerpts: boolean;
  expand: string;
};

import { renderFormat, postExcerptBlocks, postUrl } from "./shared.js";

export function renderList(posts: any[], ctx: any, opts: ListOptions) {
  const ordered = opts.listStyle === "decimal";
  const items = posts.map((post) => {
    const headerLine = renderFormat(opts.format, post, ctx, { linkTitleTo: post.url });
    const children: any[] = [
      {
        type: "paragraph",
        children: headerLine,
      },
    ];
    if (opts.excerpts) {
      const blocks = postExcerptBlocks(post, ctx);
      if (blocks.length > 0) {
        children.push(...blocks);
      }
      children.push({
        type: "paragraph",
        children: [
          {
            type: "link",
            url: postUrl(post),
            children: [{ type: "text", value: opts.expand }],
          },
        ],
      });
    }
    return {
      type: "listItem",
      children,
    };
  });

  return [
    {
      type: "list",
      ordered,
      class: `blog-posts blog-posts-list-style-${opts.listStyle}`,
      children: items,
    },
  ];
}
