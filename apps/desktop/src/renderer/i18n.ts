import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";
import es from "./locales/es.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: en },
    "pt-BR": { translation: ptBR },
    es: { translation: es },
    de: { translation: de },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
  returnNull: false,
});
i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

export default i18n;
