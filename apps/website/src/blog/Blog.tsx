import type { Locale } from "../locales";
import { Card } from "@call-nina/browser-ui";
import {
  articles,
  articleHref,
  blogDescription,
  blogTitle,
  validateArticles,
  type Article,
} from "./articles";

// This format illustration is removed from production builds and is never indexed.
const example: Article | undefined = import.meta.env.DEV
  ? {
      slug: "format-example",
      title: "Article format preview",
      summary: "A development-only illustration of the English article template.",
      author: "Call Nina",
      publishedOn: "2026-09-29",
      body: [
        {
          type: "paragraph",
          text: "This is an unpublished format example, not an editorial article.",
        },
        { type: "heading", text: "A section heading" },
        {
          type: "paragraph",
          text: "Articles use plain-text paragraphs, section headings and lists. The shared template supplies the title, summary, author, publication date and optional source links.",
        },
        {
          type: "list",
          items: [
            "Write the article in English.",
            "Review the article before adding it to the published collection.",
          ],
        },
      ],
      sources: [{ label: "Example domain — placeholder source link", url: "https://example.com/" }],
    }
  : undefined;

if (example) validateArticles([example]);

export function resolveBlog(pathname: string) {
  const path = pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "");
  if (path === "/blog") return { title: blogTitle, description: blogDescription };
  const preview = Boolean(example && path === "/blog/preview/format-example");
  const article = preview
    ? example
    : articles.find((entry) => path === articleHref(entry.slug).slice(0, -1));
  return article
    ? { article, preview, title: `${article.title} — Call Nina`, description: article.summary }
    : {
        title: "Article not found — Call Nina",
        description: "This article is not available.",
        missing: true,
      };
}

export function Blog({ page, locale }: { page: ReturnType<typeof resolveBlog>; locale: Locale }) {
  const blogHref = `/blog/?lang=${locale}`;
  const article = page.article;
  return (
    <div className="section wrap blog" lang="en">
      <nav aria-label="Breadcrumb">
        <a href={`/?lang=${locale}`}>Home</a>
        <span aria-hidden="true">/</span>
        {article || page.missing ? (
          <a href={blogHref}>Blog</a>
        ) : (
          <span aria-current="page">Blog</span>
        )}
      </nav>
      {article ? (
        <article className="blog-article">
          <header className="blog-heading">
            <p className="eyebrow">
              {page.preview ? "Unpublished development preview · English" : "Blog · English"}
            </p>
            <h1>{article.title}</h1>
            <p className="lead">{article.summary}</p>
            <p className="article-meta">
              {article.author} · {page.preview ? "Example date: " : "Published "}
              <time dateTime={article.publishedOn}>
                {new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
                  new Date(`${article.publishedOn}T00:00:00Z`),
                )}
              </time>
            </p>
          </header>
          <Card className="article-body">
            {article.body.map((block, index) => {
              if (block.type === "heading") return <h2 key={index}>{block.text}</h2>;
              if (block.type === "list")
                return (
                  <ul key={index}>
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{item}</li>
                    ))}
                  </ul>
                );
              return <p key={index}>{block.text}</p>;
            })}
            {Boolean(article.sources?.length) && (
              <section className="article-body" aria-labelledby="article-sources">
                <h2 id="article-sources">Sources</h2>
                <ul>
                  {article.sources?.map((source, index) => (
                    <li key={index}>
                      <a href={source.url}>{source.label}</a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </Card>
          <a href={blogHref}>← All articles</a>
        </article>
      ) : (
        <>
          <div className="blog-heading">
            <p className="eyebrow">Articles in English</p>
            <h1>{page.missing ? "Article not found" : "The Call Nina blog"}</h1>
            <p className="lead">
              {page.missing
                ? "This article is not available. Browse the blog for published articles."
                : "English articles from Call Nina."}
            </p>
          </div>
          {page.missing ? (
            <a href={blogHref}>Browse all articles</a>
          ) : articles.length ? (
            <ul className="article-index">
              {[...articles]
                .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn))
                .map((entry) => (
                  <Card as="li" key={entry.slug} className="article-card">
                    <article className="blog-heading">
                      <p className="article-meta">
                        <time dateTime={entry.publishedOn}>{entry.publishedOn}</time> · English
                      </p>
                      <h2>
                        <a href={`${articleHref(entry.slug)}?lang=${locale}`}>{entry.title}</a>
                      </h2>
                      <p>{entry.summary}</p>
                    </article>
                  </Card>
                ))}
            </ul>
          ) : (
            <Card as="p" variant="muted" className="blog-empty">
              No articles have been published yet.
            </Card>
          )}
        </>
      )}
    </div>
  );
}
