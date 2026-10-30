import catalog from "./catalog.json" with { type: "json" };

export type SpeechArtifact = {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  executable?: boolean;
};
export type SpeechPack = {
  id: string;
  engine: "piper" | "pocket";
  language: "de" | "en-US" | "es" | "pt-BR";
  voice: string;
  qualified: boolean;
  artifacts: SpeechArtifact[];
  runtime: { url: string; bytes: number; sha256: string; files: SpeechArtifact[] } | null;
};
export const speechPacks = catalog as SpeechPack[];
