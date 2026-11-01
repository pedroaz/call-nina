import type { Language } from "@call-nina/contracts";

// Main-owned interface text. Privileged code never imports renderer resources.
const interfaceMessages = {
  "en-US": {
    chooseFolder: "Choose Call Nina data folder",
    settings: "Settings…",
    view: "View",
    exportDiagnostics: "Export redacted Call Nina diagnostics",
    invalidCallback: "Invalid sign-in callback.",
    expiredCallback: "Invalid or expired sign-in callback.",
    connected: "Call Nina is connected. You can close this tab and return to the app.",
    loginFailed: "Sign-in did not complete. Return to Call Nina and try again.",
  },
  "pt-BR": {
    chooseFolder: "Escolher pasta de dados da Call Nina",
    settings: "Ajustes…",
    view: "Visualizar",
    exportDiagnostics: "Exportar diagnóstico da Call Nina sem dados pessoais",
    invalidCallback: "Retorno de login inválido.",
    expiredCallback: "Retorno de login inválido ou expirado.",
    connected: "A Call Nina está conectada. Você pode fechar esta aba e voltar ao aplicativo.",
    loginFailed: "O login não foi concluído. Volte à Call Nina e tente novamente.",
  },
  es: {
    chooseFolder: "Elegir carpeta de datos de Call Nina",
    settings: "Ajustes…",
    view: "Visualización",
    exportDiagnostics: "Exportar diagnóstico de Call Nina sin datos personales",
    invalidCallback: "Respuesta de inicio de sesión no válida.",
    expiredCallback: "Respuesta de inicio de sesión no válida o caducada.",
    connected: "Call Nina está conectada. Puedes cerrar esta pestaña y volver a la aplicación.",
    loginFailed: "No se completó el inicio de sesión. Vuelve a Call Nina e inténtalo de nuevo.",
  },
  de: {
    chooseFolder: "Datenordner für Call Nina auswählen",
    settings: "Einstellungen…",
    view: "Darstellung",
    exportDiagnostics: "Bereinigte Call-Nina-Diagnose exportieren",
    invalidCallback: "Ungültige Anmeldeantwort.",
    expiredCallback: "Ungültige oder abgelaufene Anmeldeantwort.",
    connected: "Call Nina ist verbunden. Du kannst diesen Tab schließen und zur App zurückkehren.",
    loginFailed:
      "Die Anmeldung wurde nicht abgeschlossen. Kehre zu Call Nina zurück und versuche es erneut.",
  },
} satisfies Record<Language, Record<string, string>>;

export function interfaceMessage(
  language: Language,
  key: keyof (typeof interfaceMessages)["en-US"],
) {
  return interfaceMessages[language][key];
}

// Persisted learning feedback captures the request's explanation language.
export const unchangedWritingFeedback: Readonly<Record<Language, string>> = {
  "en-US": "No textual changes were needed.",
  "pt-BR": "Não foi necessário alterar o texto.",
  es: "No fue necesario modificar el texto.",
  de: "Es waren keine Textänderungen nötig.",
};

export const learningTitles = {
  "en-US": { targetedPractice: "Targeted practice", quiz: "Quiz" },
  "pt-BR": { targetedPractice: "Prática direcionada", quiz: "Questionário" },
  es: { targetedPractice: "Práctica dirigida", quiz: "Cuestionario" },
  de: { targetedPractice: "Gezielte Übungen", quiz: "Quiz" },
} satisfies Record<Language, Record<string, string>>;
