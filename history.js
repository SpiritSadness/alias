import { WORDS, canonicalFamily } from './words.js?v=24';

export const HISTORY_LIMITS = Object.freeze({ bytes:2 * 1024 * 1024, records:25000, familyLength:128, dateLength:40 });
const knownFamilies = new Set(WORDS.map(word => word.family));
const forbidden = new Set(['__proto__','constructor','prototype']);

export function prepareHistory(records, now = new Date().toISOString()) {
  if (!Array.isArray(records) || records.length > HISTORY_LIMITS.records) throw new Error('В истории должно быть не больше 25 000 записей.');
  const accepted = new Map();
  let unknown = 0, duplicates = 0;
  for (const item of records) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.family !== 'string' || !item.family.trim() || item.family.length > HISTORY_LIMITS.familyLength) throw new Error('В файле истории есть некорректная запись. История не изменена.');
    const family = canonicalFamily(item.family);
    if (forbidden.has(family)) throw new Error('В файле истории есть недопустимый ключ. История не изменена.');
    const date = item.firstSeenAt;
    if (date !== undefined && (typeof date !== 'string' || date.length > HISTORY_LIMITS.dateLength || !/^\d{4}-\d\d-\d\dT/.test(date) || !Number.isFinite(Date.parse(date)))) throw new Error('В файле истории есть некорректная дата. История не изменена.');
    if (!knownFamilies.has(family)) { unknown++; continue; }
    const firstSeenAt = date === undefined ? now : new Date(date).toISOString();
    const previous = accepted.get(family);
    if (previous) duplicates++;
    if (!previous || firstSeenAt < previous.firstSeenAt) accepted.set(family,{family,firstSeenAt});
  }
  if (!accepted.size) throw new Error('В файле нет известных слов для загрузки. История не изменена.');
  return { records:[...accepted.values()], unknown, duplicates, total:records.length };
}

export async function readHistoryFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 0 || file.size > HISTORY_LIMITS.bytes) throw new Error('Файл истории должен быть не больше 2 МБ.');
  const text = await file.text();
  if (new TextEncoder().encode(text).length > HISTORY_LIMITS.bytes) throw new Error('Файл истории должен быть не больше 2 МБ.');
  let contents;
  try { contents = JSON.parse(text.replace(/^\uFEFF/,'')); }
  catch { throw new Error('Не удалось прочитать JSON истории.'); }
  if (!contents || contents.format !== 'svoyi-slova-history-v1') throw new Error('Это не файл истории Alias.');
  return prepareHistory(contents.records);
}
