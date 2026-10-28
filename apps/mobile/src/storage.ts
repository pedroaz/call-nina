import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync } from "expo-sqlite";
import { mobileSnapshotSchema, type MobileSnapshot, type MobileDeck } from "@call-nina/contracts";

let queue: Promise<unknown> = Promise.resolve();
const opening = openDatabaseAsync("nina-mobile.db").then(async (db) => {
  await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS library(user_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS progress(user_id TEXT NOT NULL, deck_id TEXT NOT NULL, revision TEXT NOT NULL, position INTEGER NOT NULL, completed INTEGER NOT NULL, PRIMARY KEY(user_id,deck_id));
    CREATE TABLE IF NOT EXISTS preference(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
});
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}
export type Progress = { position: number; completed: boolean };
export async function readLibrary(user: string) {
  const db = await opening;
  const row = await db.getFirstAsync<{ snapshot_id: string; content: string }>(
    "SELECT snapshot_id,content FROM library WHERE user_id=?",
    user,
  );
  if (!row) return null;
  try {
    return { id: row.snapshot_id, snapshot: mobileSnapshotSchema.parse(JSON.parse(row.content)) };
  } catch {
    return null;
  }
}
export function installLibrary(
  user: string,
  id: string,
  snapshot: MobileSnapshot,
  assertCurrent: () => void,
) {
  return serialized(async () => {
    const db = await opening;
    await db.withExclusiveTransactionAsync(async (tx) => {
      assertCurrent();
      await tx.runAsync(
        "INSERT OR REPLACE INTO library VALUES(?,?,?)",
        user,
        id,
        JSON.stringify(snapshot),
      );
      const rows = await tx.getAllAsync<{ deck_id: string; revision: string }>(
        "SELECT deck_id,revision FROM progress WHERE user_id=?",
        user,
      );
      for (const row of rows)
        if (
          !snapshot.decks.some(
            (d) => d.activityId === row.deck_id && d.content.revisionId === row.revision,
          )
        )
          await tx.runAsync(
            "DELETE FROM progress WHERE user_id=? AND deck_id=?",
            user,
            row.deck_id,
          );
      assertCurrent();
    });
  });
}
export async function readProgress(user: string, deck: MobileDeck): Promise<Progress> {
  const db = await opening;
  const row = await db.getFirstAsync<{ position: number; completed: number }>(
    "SELECT position,completed FROM progress WHERE user_id=? AND deck_id=? AND revision=?",
    user,
    deck.activityId,
    deck.content.revisionId,
  );
  return row && row.position >= 0 && row.position < deck.content.cards.length
    ? { position: row.position, completed: row.completed === 1 }
    : { position: 0, completed: false };
}
export function saveProgress(
  user: string,
  deck: MobileDeck,
  progress: Progress,
  assertCurrent: () => void,
) {
  return serialized(async () => {
    assertCurrent();
    const db = await opening;
    assertCurrent();
    await db.runAsync(
      "INSERT OR REPLACE INTO progress VALUES(?,?,?,?,?)",
      user,
      deck.activityId,
      deck.content.revisionId,
      progress.position,
      progress.completed ? 1 : 0,
    );
  });
}
export function clearLearning() {
  return serialized(async () => {
    const db = await opening;
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync("DELETE FROM library");
      await tx.runAsync("DELETE FROM progress");
    });
  });
}
export async function readPreference(key: string) {
  return (
    await (
      await opening
    ).getFirstAsync<{ value: string }>("SELECT value FROM preference WHERE key=?", key)
  )?.value;
}
export async function writePreference(key: string, value: string) {
  await (await opening).runAsync("INSERT OR REPLACE INTO preference VALUES(?,?)", key, value);
}

const verifiedKey = "nina-mobile-verified-user";
export const readVerifiedUser = () => SecureStore.getItemAsync(verifiedKey);
export function markVerifiedUser(user: string, assertCurrent: () => void) {
  return serialized(async () => {
    assertCurrent();
    await SecureStore.setItemAsync(verifiedKey, user);
    try {
      assertCurrent();
    } catch (error) {
      await SecureStore.deleteItemAsync(verifiedKey);
      throw error;
    }
  });
}
export function clearVerifiedUser() {
  return serialized(() => SecureStore.deleteItemAsync(verifiedKey));
}
