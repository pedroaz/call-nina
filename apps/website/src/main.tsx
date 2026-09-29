import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@call-nina/design-system/tokens.css";
import "./styles.css";

function App() {
  return (
    <main>
      <p className="eyebrow">Learning German, at your pace</p>
      <h1>Call Nina</h1>
      <p className="introduction">A local-first companion for learning German.</p>
      <section aria-labelledby="coming-soon">
        <h2 id="coming-soon">Website coming soon</h2>
        <p>We’re building a home for Call Nina. You can follow the project on GitHub.</p>
        <a href="https://github.com/pedroaz/call-nina">Explore the project</a>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Website root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
