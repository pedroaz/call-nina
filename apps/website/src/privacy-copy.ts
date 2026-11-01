import type { Locale } from "./locales";

type PrivacyCopy = {
  title: string;
  description: string;
  allow: string;
  reject: string;
  notice: string;
  settings: string;
  close: string;
  accepted: string;
  rejected: string;
  updated: string;
  storageUnavailable: string;
};
export const privacyCopy: Record<Locale, PrivacyCopy> = {
  en: {
    title: "Website analytics",
    description:
      "May we use Vercel to measure visits, interactions and website performance? Analytics is optional. Your choice is remembered for six months.",
    allow: "Allow analytics",
    reject: "Reject analytics",
    notice: "Privacy",
    settings: "Privacy settings",
    close: "Close",
    accepted: "Analytics is allowed.",
    rejected: "Analytics is off.",
    updated: "Last updated",
    storageUnavailable:
      "Your browser could not save this choice. It applies to this page only. Clear this site’s browser data to remove any earlier saved choice.",
  },
  de: {
    title: "Website-Analyse",
    description:
      "Dürfen wir mit Vercel Besuche, Interaktionen und die Leistung der Website messen? Die Analyse ist freiwillig. Deine Auswahl wird sechs Monate gespeichert.",
    allow: "Analyse erlauben",
    reject: "Analyse ablehnen",
    notice: "Datenschutz",
    settings: "Datenschutzeinstellungen",
    close: "Schließen",
    accepted: "Die Analyse ist erlaubt.",
    rejected: "Die Analyse ist ausgeschaltet.",
    updated: "Zuletzt aktualisiert",
    storageUnavailable:
      "Dein Browser konnte diese Auswahl nicht speichern. Sie gilt nur für diese Seite. Lösche die Website-Daten im Browser, um eine frühere gespeicherte Auswahl zu entfernen.",
  },
  es: {
    title: "Análisis del sitio web",
    description:
      "¿Podemos usar Vercel para medir visitas, interacciones y el rendimiento del sitio? El análisis es opcional. Guardamos tu elección durante seis meses.",
    allow: "Permitir análisis",
    reject: "Rechazar análisis",
    notice: "Privacidad",
    settings: "Ajustes de privacidad",
    close: "Cerrar",
    accepted: "El análisis está permitido.",
    rejected: "El análisis está desactivado.",
    updated: "Última actualización",
    storageUnavailable:
      "Tu navegador no pudo guardar la elección. Solo se aplica a esta página. Borra los datos del sitio en el navegador para eliminar una elección anterior.",
  },
  "pt-BR": {
    title: "Análise do site",
    description:
      "Podemos usar a Vercel para medir visitas, interações e o desempenho do site? A análise é opcional. Sua escolha fica salva por seis meses.",
    allow: "Permitir análise",
    reject: "Recusar análise",
    notice: "Privacidade",
    settings: "Configurações de privacidade",
    close: "Fechar",
    accepted: "A análise está permitida.",
    rejected: "A análise está desativada.",
    updated: "Última atualização",
    storageUnavailable:
      "Seu navegador não conseguiu salvar a escolha. Ela vale apenas para esta página. Apague os dados deste site no navegador para remover uma escolha salva anteriormente.",
  },
};
