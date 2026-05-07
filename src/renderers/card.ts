/**
 * Renders blog posts as cards with title, subtitle, description, optional
 * excerpt, optional thumbnail image, and date.
 */
import { postExcerptInline, postUrl } from "./shared.js";

export type CardOptions = {
  excerpts: boolean;
  expand: string;
  image: boolean;
};

export function renderCards(posts: any[], ctx: any, opts: CardOptions = { excerpts: false, expand: "Read more", image: false }) {
  return posts.map(post => {
    const descriptionItems = post.frontmatter.description
      ? ctx.parseMyst(post.frontmatter.description).children
      : [];
    const subtitleItems = post.frontmatter.subtitle
      ? ctx.parseMyst(post.frontmatter.subtitle).children
      : [];
    const footerItems = post.frontmatter.date
      ? [
          {
            type: "footer",
            children: [
              ctx.parseMyst(`**Date**: ${post.frontmatter.date}`)["children"][0],
            ],
          },
        ]
      : [];

    const excerptItems: any[] = [];
    if (opts.excerpts) {
      const inline = postExcerptInline(post, ctx);
      if (inline.length > 0) {
        excerptItems.push({ type: "paragraph", children: inline });
        excerptItems.push({
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
    }

    const imageItems: any[] = [];
    if (opts.image && typeof post.frontmatter.image === "string" && post.frontmatter.image.length > 0) {
      imageItems.push({
        type: "image",
        url: post.frontmatter.image,
        alt: typeof post.frontmatter.title === "string" ? post.frontmatter.title : "",
      });
    }

    return {
      type: "card",
      class: "blog-posts",
      children: [
        ...imageItems,
        {
          type: "cardTitle",
          children: ctx.parseMyst(post.frontmatter.title).children,
        },
        ...subtitleItems,
        ...descriptionItems,
        ...excerptItems,
        ...footerItems,
      ],
      url: post.url,
    };
  });
}
