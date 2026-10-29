import { BANK } from './word-bank.js?v=24';

export const PACKS = BANK.packs;
const packsById = new Map(PACKS.map(pack => [pack.id, pack]));
const difficultyNames = { easy: 'Легко', medium: 'Средне', hard: 'Сложно' };
const normalise = value => String(value).toLocaleLowerCase('ru').normalize('NFKC').replaceAll('ё', 'е').trim();
export function canonicalFamily(value) {
  let family = normalise(value);
  for (let i = 0; i < 4 && Object.hasOwn(BANK.aliases,family) && typeof BANK.aliases[family] === 'string'; i++) family = BANK.aliases[family];
  return family;
}
export const WORDS = BANK.words.map(([text, category, difficulty, family], index) => {
  const pack = packsById.get(category);
  return { id: `alias-${family}`, family: canonicalFamily(family), text, category,
    categoryName: pack.name, emoji: pack.emoji, slot: index % 8 + 1,
    difficulty, difficultyName: difficultyNames[difficulty] };
});
