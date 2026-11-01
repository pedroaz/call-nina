import { app, Menu } from "electron";
import { interfaceMessage } from "./localization.js";

export function installNativeMenu(openSettings: () => void): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const systemLanguage = app.getLocale().split("-")[0];
  const locale =
    systemLanguage === "de"
      ? "de"
      : systemLanguage === "es"
        ? "es"
        : systemLanguage === "pt"
          ? "pt-BR"
          : "en-US";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: interfaceMessage(locale, "settings"),
            accelerator: "Command+,",
            click: openSettings,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: interfaceMessage(locale, "view"),
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}
