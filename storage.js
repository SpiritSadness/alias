const DB_NAME = 'svoyi-slova-v1';
let opening;

function openDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('seen', { keyPath: 'family' });
        db.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return opening;
}

function transactionResult(db, storeName, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Операция с памятью отменена'));
    work(tx.objectStore(storeName), value => { result = value; });
  });
}

export async function getSeen() {
  const db = await openDb();
  return new Set(await transactionResult(db, 'seen', 'readonly', (store, set) => {
    store.getAllKeys().onsuccess = event => set(event.target.result);
  }));
}

export async function reserveWord(pool) {
  const db = await openDb();
  return transactionResult(db, 'seen', 'readwrite', (store, set) => {
    store.getAllKeys().onsuccess = event => {
      const seen = new Set(event.target.result);
      const available = pool.filter(word => !seen.has(word.family));
      if (!available.length) {
        set({ word: null, remaining: 0 });
        return;
      }
      const word = available[Math.floor(Math.random() * available.length)];
      store.add({ family: word.family, firstSeenAt: new Date().toISOString() });
      set({ word, remaining: available.length - 1 });
    };
  });
}

export async function getGame() {
  const db = await openDb();
  return transactionResult(db, 'meta', 'readonly', (store, set) => {
    store.get('game').onsuccess = event => set(event.target.result || null);
  });
}

export async function saveGame(game) {
  const db = await openDb();
  await transactionResult(db, 'meta', 'readwrite', store => store.put(game, 'game'));
}

export async function removeGame() {
  const db = await openDb();
  await transactionResult(db, 'meta', 'readwrite', store => store.delete('game'));
}

export async function exportSeen() {
  const db = await openDb();
  return transactionResult(db, 'seen', 'readonly', (store, set) => {
    store.getAll().onsuccess = event => set(event.target.result);
  });
}

export async function importSeen(records) {
  if (!Array.isArray(records) || records.some(item => typeof item?.family !== 'string')) {
    throw new Error('Файл истории имеет неверный формат');
  }
  const db = await openDb();
  await transactionResult(db, 'seen', 'readwrite', store => {
    for (const record of records) store.put({
      family: record.family,
      firstSeenAt: typeof record.firstSeenAt === 'string' ? record.firstSeenAt : new Date().toISOString()
    });
  });
  return records.length;
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* The game still works when persistence is unavailable. */ }
}
