// Images exceed sessionStorage's small quota. Keep the identity-bound login
// checkpoint in IndexedDB, with only its random, tab-local key in sessionStorage.
const key = "shell:conversation-login";

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("shell-login-checkpoints", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function checkpoint(value) {
  const id = value
    ? (sessionStorage.getItem(key) ?? crypto.randomUUID())
    : sessionStorage.getItem(key);
  if (!id) return null;
  const db = await database();
  try {
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite");
      const store = tx.objectStore("checkpoints");
      const request = value ? store.put(value, id) : store.get(id);
      if (!value) store.delete(id); // consume once, even if the identity changed
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (Date.now() - entry.value.savedAt > 10 * 60_000) entry.delete();
        entry.continue();
      };
      tx.oncomplete = () => resolve(value ? null : request.result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Unable to save conversation"));
      tx.onerror = () => reject(tx.error);
    });
    if (value) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
    return result;
  } finally {
    db.close();
  }
}
