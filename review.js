const RESULTS = new Set(['round','roundResult','roundTie','roundFinished','gameTie','finished','drawFinished','tieEmpty']);
export const canReview = game => Boolean(game && RESULTS.has(game.phase));
export function turnWords(game) {
  if (game.turnWords) return structuredClone(game.turnWords);
  const words = (game.actions || []).filter(a => a.word).map(a => ({ text:a.word, status:['correct','special','last'].includes(a.type) ? 'guessed' : 'skipped' }));
  const last = game.lastWordResult;
  if (last?.word && !words.some(w => w.text === last.word)) words.push({text:last.word,status:last.teamIndex == null ? 'unanswered' : 'guessed'});
  if (game.word?.text && !words.some(w => w.text === game.word.text)) words.push({...game.word,status:'unanswered'});
  return words;
}
export function reviewWords(game, scope = 'all') {
  if (!canReview(game)) return [];
  const turns = game.turnHistory?.length ? game.turnHistory : game.lastSummary ? [game.lastSummary] : [];
  const selected = scope === 'turn' ? [game.lastSummary].filter(Boolean) : scope === 'round' ? turns.filter(turn => turn.roundNumber === game.roundNumber) : turns;
  const words = selected.flatMap(turn => turn.words || (turn.lastWord ? [{text:turn.lastWord.word,status:turn.lastWord.teamIndex == null ? 'unanswered' : 'guessed'}] : []));
  if (scope === 'all') words.push(...(game.decidingWords || (game.tiebreak ? [{text:game.tiebreak.word,status:'guessed'}] : [])));
  const unique = new Map();
  for (const word of words) if (word?.text) unique.set(word.family || word.text, {...word});
  return [...unique.values()].sort((a,b) => Number(a.status === 'guessed') - Number(b.status === 'guessed'));
}
