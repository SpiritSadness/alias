export const SESSION_KEY = 'alias-session-v3';
export function pauseGame(game, now = Date.now()) {
  if (!game) return;
  if (game.phase === 'playing' && game.timer && !game.timer.paused) {
    game.timer.remainingMs = Math.max(0, game.timer.deadline - now);
    game.timer.deadline = null;
    game.timer.paused = true;
  }
  if (game.phase === 'countdown') {
    game.phase = game.countdownNext === 'sudden' ? 'suddenHandoff' : 'handoff';
    delete game.countdownEndsAt;
    delete game.countdownValue;
  }
}
export function checkpoint(state, now = Date.now()) {
  const snapshot = structuredClone({ version: 3, savedAt: now, view: state.view, draft: state.draft, game: state.game });
  if (snapshot.game?.timer && !snapshot.game.timer.paused) snapshot.game.timer.remainingMs = Math.max(0, snapshot.game.timer.deadline - now);
  return snapshot;
}
export function readCheckpoint(storage) {
  try { const value = JSON.parse((storage || globalThis.localStorage).getItem(SESSION_KEY)); return value?.version === 3 && ['home','setup','game'].includes(value.view) ? value : null; } catch { return null; }
}
export function writeCheckpoint(state, storage, now = Date.now()) {
  try { const value = checkpoint(state, now); (storage || globalThis.localStorage).setItem(SESSION_KEY, JSON.stringify(value)); return value; } catch { return null; }
}
export function restoreGame(game) {
  if (!game) return game;
  if (game.phase === 'playing' && game.timer && !game.timer.paused) {
    game.timer.remainingMs = Math.max(0, game.timer.remainingMs || 0);
    game.timer.paused = true;
    game.timer.deadline = null;
  }
  if (game.phase === 'countdown') pauseGame(game);
  return game;
}
