import React from "react";
import { createRoot } from "react-dom/client";
import { NinaAccountProvider } from "./learning/account/NinaAccount.js";
import { DesktopNotifications } from "./runtime/Notifications.js";

import "@call-nina/design-system/fonts.css";
import "@call-nina/design-system/tokens.css";
import App from "./App.js";
import "./runtime/i18n.js";
import "./styles/global.css";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("OD_RENDERER_ROOT_MISSING");

createRoot(root).render(
  <React.StrictMode>
    <DesktopNotifications>
      <NinaAccountProvider>
        <App />
      </NinaAccountProvider>
    </DesktopNotifications>
  </React.StrictMode>,
);
