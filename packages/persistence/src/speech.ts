import { speechPreferencesSchema, type SpeechPreferences } from "@call-nina/contracts";
import { withLeasedConnection, type CallNinaDatabase } from "./sqlite.js";

export async function readSpeechPreferences(db: CallNinaDatabase) {
  return withLeasedConnection(db, (connection) =>
    speechPreferencesSchema.parse(
      JSON.parse(
        String(
          connection
            .prepare("SELECT preferences_json FROM speech_preferences WHERE singleton=1")
            .get()?.["preferences_json"],
        ),
      ),
    ),
  );
}
export async function saveSpeechPreferences(db: CallNinaDatabase, preferences: SpeechPreferences) {
  return withLeasedConnection(db, (connection) => {
    connection
      .prepare("UPDATE speech_preferences SET preferences_json=? WHERE singleton=1")
      .run(JSON.stringify(speechPreferencesSchema.parse(preferences)));
  });
}
