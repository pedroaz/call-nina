// Add reviewed English articles here. A published entry creates /blog/<slug>/ at build time.
// Keep slugs stable: they are public URLs. Dates use YYYY-MM-DD; body text is plain text.
export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: readonly string[] };

export interface Article {
  slug: string;
  title: string;
  summary: string;
  author: string;
  publishedOn: string;
  body: readonly ArticleBlock[];
}

// Editorial publication is separate from the blog foundation.
export const articles: readonly Article[] = [];

export const blogTitle = "Blog — Call Nina";
export const blogDescription = "English articles from Call Nina.";
export const articleHref = (slug: string) => `/blog/${slug}/`;

export function validateArticles(entries: readonly Article[]) {
  const slugs = new Set<string>();
  for (const article of entries) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) ||
      article.slug === "preview" ||
      slugs.has(article.slug)
    ) {
      throw new Error(`Invalid or duplicate article slug: ${article.slug}`);
    }
    slugs.add(article.slug);
    const date = new Date(`${article.publishedOn}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(article.publishedOn) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== article.publishedOn
    ) {
      throw new Error(`Invalid publication date: ${article.slug}`);
    }
    if (
      ![article.title, article.summary, article.author].every((text) => text.trim()) ||
      !article.body.length
    ) {
      throw new Error(`Missing article content: ${article.slug}`);
    }
    for (const block of article.body) {
      const texts = block.type === "list" ? block.items : [block.text];
      if (!texts.length || !texts.every((text) => text.trim()))
        throw new Error(`Empty article block: ${article.slug}`);
    }
  }
}
