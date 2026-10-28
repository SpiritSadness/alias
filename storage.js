import { isValidGame, gameIdentity } from './session.js?v=23';
import { canonicalFamily } from './words.js?v=23';

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
    store.getAllKeys().onsuccess = event => set(event.target.result.map(canonicalFamily));
  }));
}

export async function reserveWord(pool) {
  const db = await openDb();
  return transactionResult(db, 'seen', 'readwrite', (store, set) => {
    store.getAllKeys().onsuccess = event => {
      const seen = new Set(event.target.result.map(canonicalFamily));
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

const GAME_KEY='game-v4',REVISION_KEY='game-revision-v4',UI_KEY='ui-session-v4';
export class GameConflictError extends Error {
  constructor() {super('Партия изменена в другом окне. Откройте актуальную версию.');this.code='STALE_GAME';}
}
function loadRecord(store,done) {
  const values={};let left=3;
  for(const [label,key] of [['current',GAME_KEY],['legacy','game'],['revision',REVISION_KEY]]) {
    store.get(key).onsuccess=event=>{values[label]=event.target.result;if(--left===0){
      const raw=values.current===undefined?values.legacy:values.current;
      const revision=Number.isInteger(values.revision)?values.revision:Number.isInteger(raw?._rev)?raw._rev:0;
      const game=isValidGame(raw)?{...raw,gameId:gameIdentity(raw),_rev:revision}:null;
      done({game,revision});
    }};
  }
}
export async function getGameRecord() {
  const db=await openDb();return transactionResult(db,'meta','readonly',(store,set)=>loadRecord(store,set));
}
export async function getGame() {return (await getGameRecord()).game;}
async function commit(game,pool,assignWord,options={}) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(pool?['meta','seen']:['meta'],'readwrite'),meta=tx.objectStore('meta');let result,failure;
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('Не удалось сохранить ход'));
    loadRecord(meta,record=>{
      try {
        if((game._rev||0)!==record.revision || (record.game && gameIdentity(record.game)!==gameIdentity(game) && !options.replace)) throw new GameConflictError();
        const candidate=structuredClone(game);candidate.gameId=gameIdentity(game);candidate._rev=record.revision+1;candidate.updatedAt=Date.now();
        const finish=word=>{
          try {if(assignWord) assignWord(candidate,word);if(!isValidGame(candidate)) throw new Error('Не удалось сохранить некорректную партию');meta.put(candidate,GAME_KEY);meta.put(candidate._rev,REVISION_KEY);result=candidate;}
          catch(error){failure=error;tx.abort();}
        };
        if(!pool) return finish(null);
        const seenStore=tx.objectStore('seen');seenStore.getAllKeys().onsuccess=event=>{
          try {const used=new Set(event.target.result.map(canonicalFamily)),available=pool.filter(word=>!used.has(word.family));const word=available.length?available[Math.floor(Math.random()*available.length)]:null;
            if(word) seenStore.add({family:word.family,firstSeenAt:new Date().toISOString()});finish(word);
          } catch(error){failure=error;tx.abort();}
        };
      } catch(error){failure=error;tx.abort();}
    });
  });
}
export async function saveGame(game,options) {return commit(game,null,null,options);}
export async function saveGameAndReserveWord(game,pool,assignWord) {return commit(game,pool,assignWord);}
export async function getSession() {
  const db=await openDb();return transactionResult(db,'meta','readonly',(store,set)=>{
    store.get(UI_KEY).onsuccess=event=>{if(event.target.result) set(event.target.result);else store.get('ui-session').onsuccess=legacy=>set(legacy.target.result||null);};
  });
}
export async function saveSession(session) {
  const db=await openDb();await transactionResult(db,'meta','readwrite',store=>{
    store.get(UI_KEY).onsuccess=event=>{if((event.target.result?.gameRev||0)<=(session.gameRev||0))store.put(session,UI_KEY);};
  });
}

export async function removeGame() {
  const db = await openDb();
  await transactionResult(db, 'meta', 'readwrite', store => {for(const key of [GAME_KEY,REVISION_KEY,'game']) store.delete(key);});
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
      family: canonicalFamily(record.family),
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

export async function getDefinitionReports() {
  const db = await openDb();
  return transactionResult(db, 'meta', 'readonly', (store, set) => {
    store.get('definition-reports').onsuccess = event => set(event.target.result || {});
  });
}
export async function reportDefinition(word, enabled = true) {
  const db = await openDb();
  await transactionResult(db, 'meta', 'readwrite', store => {
    store.get('definition-reports').onsuccess = event => {
      const reports = event.target.result || {};
      if (enabled) reports[word.family] = { text:word.text, reportedAt:new Date().toISOString() };
      else delete reports[word.family];
      store.put(reports, 'definition-reports');
    };
  });
}
