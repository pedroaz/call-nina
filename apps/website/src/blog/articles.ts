// Add reviewed English articles here. A published entry creates /blog/<slug>/ at build time.
// Keep slugs stable: they are public URLs. Dates use YYYY-MM-DD; body text is plain text.
// Optional sources render after the body. Use a descriptive publication/title label and a
// public HTTPS URL, without credentials or private access tokens. Review destinations
// before publication; URL validation does not establish evidence quality or public access.
// Do not put HTML or Markdown links in body text or labels.
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
  sources?: readonly { label: string; url: string }[];
}

// Editorial publication is separate from the blog foundation.
export const articles: readonly Article[] = [
  {
    slug: "a-clearer-introduction-and-a-place-for-development-stories",
    title: "A clearer introduction, and a place for development stories",
    summary:
      "Four merged changes clarify Call Nina’s prelaunch website, lay the groundwork for development articles, and make learner context more explicit in the desktop code.",
    author: "Call Nina",
    publishedOn: "2026-09-29",
    body: [
      {
        type: "paragraph",
        text: "Explaining a product while it is still being built means answering two questions together: what is already there, and what is still a plan? Four changes merged on September 29 bring that distinction into Call Nina’s website and learning code. They give the project a clearer introduction and a place to explain its development, while keeping public downloads marked as coming soon. This article covers the four merges from the landing page through the blog foundation, ending at revision 62a9675; it is a snapshot of that interval.",
      },
      {
        type: "heading",
        text: "An introduction with room for honest limits",
      },
      {
        type: "paragraph",
        text: "The new landing page introduces Call Nina in English and German. It describes the development app’s German reading, writing and vocabulary practice, and lets visitors switch the website language. Its download section keeps the prelaunch status visible. That matters because a polished introduction should help someone understand the project without suggesting that an installer is already available.",
      },
      {
        type: "paragraph",
        text: "A comparison of Free personal, Premium personal, Teachers and Enterprise adds detail to that introduction. The accompanying FAQ explains that the current AI connection uses Codex, while direct connections using a personal API key and Nina-managed access remain planned. It also separates Nina’s own fees from provider costs. Visitors can read about the direction of the product without mistaking future tiers for something they can buy today.",
      },
      {
        type: "heading",
        text: "Keeping language choices distinct",
      },
      {
        type: "paragraph",
        text: "Another merged change makes learner and course context explicit in the desktop code. It separates the language being learned from the language used for explanations and from the interface language, and represents learning goals in a structured form. This gives the app a clearer way to carry learning context through its activity preparation and feedback code: choosing an interface language should not choose a different course.",
      },
      {
        type: "paragraph",
        text: "At that revision, the supported course remains German. This is groundwork in the repository, not an announcement of additional language courses. The pull request records passing static checks and local code review, with interactive desktop verification deferred to the planned consolidated round. The merge therefore establishes what changed in the code; it does not establish that every affected learning flow has been verified in use.",
      },
      {
        type: "heading",
        text: "A place to explain the work",
      },
      {
        type: "paragraph",
        text: "The blog foundation adds an English article index, a shared article layout and direct article URLs generated during the website build. Articles can carry descriptive source links, so readers can follow an explanation back to the changes behind it. The foundation merged with an empty published collection; this first article is a later addition. A development-only format example helps inspect the layout without becoming an editorial article.",
      },
      {
        type: "paragraph",
        text: "That separation leaves room to review an article’s claims and wording before publication. The foundation does not add a publishing service or schedule, and reading the blog still requires JavaScript. Its pull request reports browser viewport checks; those observations are not physical-device coverage.",
      },
      {
        type: "heading",
        text: "What remains ahead",
      },
      {
        type: "paragraph",
        text: "At the end of this interval, the website still describes a conversational home screen, mobile practice and additional AI routes as future work. Public installers remain unavailable in the website’s download section. These merges improve the project’s explanation and its internal foundations; they do not constitute a deployment or an app release.",
      },
    ],
    sources: [
      {
        label: "Call Nina PR #41 — bilingual prelaunch landing page",
        url: "https://github.com/pedroaz/call-nina/pull/41",
      },
      {
        label: "Call Nina PR #42 — plans, FAQ and contact",
        url: "https://github.com/pedroaz/call-nina/pull/42",
      },
      {
        label: "Call Nina PR #43 — learner course and goal context",
        url: "https://github.com/pedroaz/call-nina/pull/43",
      },
      {
        label: "Call Nina PR #44 — static English blog foundation",
        url: "https://github.com/pedroaz/call-nina/pull/44",
      },
      {
        label: "Website copy at the selected revision — current scope and future plans",
        url: "https://github.com/pedroaz/call-nina/blob/62a967528369dbab00e049d236ea88cd49be762f/apps/website/src/locales.ts",
      },
      {
        label: "Learning context contract at its merge revision",
        url: "https://github.com/pedroaz/call-nina/blob/00d9e1d39b3c1b71804813ee3ca4d2510f194e5c/packages/contracts/src/learning-context.ts",
      },
    ],
  },
];

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
    for (const source of article.sources ?? []) {
      let url: URL;
      try {
        url = new URL(source.url);
      } catch {
        throw new Error(`Invalid article source URL: ${article.slug}`);
      }
      if (
        !source.label.trim() ||
        !/^https:\/\//i.test(source.url) ||
        /[\s\\]/.test(source.url) ||
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        throw new Error(`Invalid article source: ${article.slug}`);
      }
    }
  }
}
