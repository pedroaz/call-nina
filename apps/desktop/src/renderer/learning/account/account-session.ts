export class AccountSession {
  #draft = { username: "", password: "" };
  #draftChanged = false;
  #requestPending = false;
  #version = 0;
  #changing = false;
  readonly #listeners = new Set<() => void>();
  get draft() {
    return this.#draft;
  }
  get draftChanged() {
    return this.#draftChanged;
  }
  get requestPending() {
    return this.#requestPending;
  }
  get version() {
    return this.#version;
  }
  get changing() {
    return this.#changing;
  }
  setDraft(value: { username: string; password: string }) {
    this.#draft = value;
  }
  editDraft(value: { username: string; password: string }) {
    this.#draftChanged = true;
    this.#draft = value;
  }
  setPending(value: boolean) {
    this.#requestPending = value;
  }
  transition(changing: boolean) {
    this.#changing = changing;
    this.#version++;
    for (const listener of this.#listeners) listener();
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
export const accountSession = new AccountSession();
