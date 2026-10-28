import { turnWords } from './review.js?v=19';
export const TEAM_COLORS = [
  ['Лайм','#d9ff69'],['Коралл','#ff816b'],['Небо','#80b7ff'],['Лаванда','#b9a0ff'],
  ['Персик','#ffc77b'],['Мята','#7be2d0'],['Роза','#ff9dca'],['Солнце','#ffe16b'],
  ['Бирюза','#62cbd2'],['Ирис','#9bafff'],['Фисташка','#a9d98b'],['Малина','#ed7f9d'],
  ['Абрикос','#efa66d'],['Сирень','#d4a9e8'],['Лёд','#a8d8ec'],['Шалфей','#95c7ac']
];
export function teamColor(team, index = 0) {
  return TEAM_COLORS.some(([, value]) => value === team?.color) ? team.color : TEAM_COLORS[index % TEAM_COLORS.length][1];
}
export function selectedCategories(settings) {
  return Array.isArray(settings.categories) ? [...new Set(settings.categories.filter(value => typeof value === 'string' && value !== 'all'))] : settings.category && settings.category !== 'all' ? [settings.category] : [];
}
export function matchesWordSettings(word, settings) {
  const categories = selectedCategories(settings);
  return (categories.length ? categories.includes(word.category) : word.category !== 'adult')
    && (settings.mode === 'classic' || !settings.difficulty || settings.difficulty === 'mixed' || word.difficulty === settings.difficulty);
}

export function tieContenders(game) {
  const values = game.mode === 'custom' && game.scoreMode === 'round'
    ? game.teams.map((_, index) => (game.roundHistory || []).filter(round => round.winnerIndex === index).length)
    : game.teams.map(team => team.score);
  const best = Math.max(...values);
  return values.flatMap((value, index) => value === best ? [index] : []);
}

export function targetOutcome(game) {
  const best = Math.max(...game.teams.map(team => team.score));
  return best < game.targetScore ? 'round' : tieContenders(game).length === 1 ? 'finished' : 'gameTie';
}

export function buildTurnSummary(game, teamIndex = game.activeTeam) {
  const actions = game.actions || [];
  const team = game.teams[teamIndex];
  const lastAction = actions.filter(action => action.type === 'last').pop();
  const lastWord = game.lastWordResult || (lastAction ? { word: lastAction.word, teamIndex: lastAction.teamIndex } : null);
  const allocations = game.teams.map((item, index) => {
    const firstAction = actions.find(action => action.teamIndex === index);
    const start = game.turnStartScores?.[index] ?? firstAction?.previousScore ?? (index === teamIndex ? game.turnStartScore : item.score);
    return { teamIndex: index, teamName: item.name, delta: item.score - (start ?? item.score) };
  });
  const ownLast = actions.filter(action => action.type === 'last' && action.teamIndex === teamIndex).length;
  const specialCorrect = actions.filter(action => action.type === 'special').length;
  return {
    teamIndex, teamName: team.name, roundNumber: game.roundNumber || 1,
    correct: game.special ? specialCorrect : (game.turnStats?.correct || 0) + ownLast,
    skipped: game.special ? Math.max(0, (game.specialPlayed || 0) - specialCorrect) : game.turnStats?.skipped || 0,
    net: game.special ? allocations.reduce((sum, item) => sum + item.delta, 0) : allocations[teamIndex].delta,
    special: Boolean(game.special), allocations, words: turnWords(game),
    lastWord: lastWord ? { word: lastWord.word, teamIndex: lastWord.teamIndex, teamName: game.teams[lastWord.teamIndex]?.name || null, ...(lastAction?.previousScores?.length > 1 ? {recipients:lastAction.previousScores.map(item => game.teams[item.teamIndex].name)} : {}) } : null
  };
}

// Show only information not already explained by the main result or last-word card.
export function additionalTurnChanges(summary) {
  const allocations = summary.allocations || [];
  const changed = allocations.filter(item => item.delta !== 0);
  const showOwn = Boolean(summary.special && changed.length > 1);
  const last = summary.lastWord;
  return allocations.flatMap(item => {
    if (item.teamIndex === summary.teamIndex && !showOwn) return [];
    const coveredByLastWord = Boolean(last?.teamName && (last.recipients?.length
      ? last.recipients.includes(item.teamName) : item.teamIndex === last.teamIndex));
    const delta = item.delta - (coveredByLastWord ? 1 : 0);
    return delta ? [{...item,delta,excludingLastWord:coveredByLastWord}] : [];
  });
}
