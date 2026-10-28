const DB_NAME = "plantao-facil";
const DB_VERSION = 1;
const STORE = "shifts";

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Erro no banco local."));
  });
}

export async function openDatabase() {
  if (!("indexedDB" in window)) throw new Error("Este navegador não oferece suporte ao armazenamento necessário.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Não foi possível abrir o banco local."));
  });
}

export async function getAllShifts(db) {
  return requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
}

export async function putShift(db, shift) {
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(shift);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(shift);
    tx.onerror = () => reject(tx.error || new Error("Não foi possível salvar o plantão."));
    tx.onabort = () => reject(tx.error || new Error("A gravação foi cancelada."));
  });
}

export async function putManyShifts(db, shifts) {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  shifts.forEach(shift => store.put(shift));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(shifts);
    tx.onerror = () => reject(tx.error || new Error("Não foi possível salvar a escala."));
    tx.onabort = () => reject(tx.error || new Error("A gravação da escala foi cancelada."));
  });
}

export async function deleteShift(db, id) {
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível excluir o plantão."));
  });
}

export async function replaceAllShifts(db, shifts) {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.clear();
  shifts.forEach(shift => store.put(shift));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível restaurar o backup."));
    tx.onabort = () => reject(tx.error || new Error("A restauração foi cancelada."));
  });
}
