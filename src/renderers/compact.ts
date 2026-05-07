/**
 * Renders blog posts as a single-paragraph-per-post compact stream — useful for
 * sidebars and "recent posts" widgets. No bullets, no card chrome.
 */
import { renderFormat, postExcerptInline, postUrl } from "./shared.js";

export type CompactOptions = {
  format: string;
  excerpts: boolean;
  expand: string;
};

export function renderCompact(posts: any[], ctx: any, opts: CompactOptions) {
  const blocks: any[] = posts.map((post) => {
    const headerLine = renderFormat(opts.format, post, ctx, { linkTitleTo: post.url });
    const paragraphs: any[] = [{ type: "paragraph", children: headerLine }];
    if (opts.excerpts) {
      const excerpt = postExcerptInline(post, ctx);
      if (excerpt.length > 0) paragraphs.push({ type: "paragraph", children: excerpt });
      paragraphs.push({
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
      type: "container",
      class: "blog-posts blog-posts-compact",
      children: paragraphs,
    };
  });
  return blocks;
}
