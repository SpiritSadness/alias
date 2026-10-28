export function matchesWordSettings(word, settings) {
  return (!settings.category || settings.category === 'all' || word.category === settings.category)
    && (settings.mode === 'classic' || !settings.difficulty || settings.difficulty === 'mixed' || word.difficulty === settings.difficulty);
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
    special: Boolean(game.special), allocations,
    lastWord: lastWord ? { word: lastWord.word, teamIndex: lastWord.teamIndex, teamName: game.teams[lastWord.teamIndex]?.name || null } : null
  };
}
