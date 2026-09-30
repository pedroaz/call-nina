import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import "./i18n.js";
import "@call-nina/design-system/tokens.css";
import "@call-nina/design-system/fonts.css";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("OD_RENDERER_ROOT_MISSING");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
