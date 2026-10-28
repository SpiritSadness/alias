export const SESSION_KEY = 'alias-session-v4';
export const LEGACY_SESSION_KEY = 'alias-session-v3';
const PHASES = new Set(['handoff','countdown','playing','lastWord','round','roundResult','roundTie','roundFinished','gameTie','suddenHandoff','suddenWord','tieEmpty','drawFinished','finished','empty','depleted','stopped']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const gameIdentity = game => game?.gameId || (game ? `legacy-${game.createdAt || 'game'}` : null);
export function isValidGame(game) {
  try {
    if (!game || !PHASES.has(game.phase) || !['classic','custom'].includes(game.mode)) return false;
    const teams=game.teams,n=teams?.length,style=game.playStyle || 'teams';
    if(!['teams','pairs','versus'].includes(style)||(style==='versus'&&n!==2))return false;
    if (!Array.isArray(teams) || n < (style==='pairs'?3:2) || n > (style==='pairs'?12:6)) return false;
    if (!teams.every(team=>team && typeof team.name==='string' && team.name.trim() && Array.isArray(team.players) && team.players.length >= (style==='teams'?2:1) && team.players.every(name=>typeof name==='string'&&name.trim()) && finite(team.score)&&team.score>=0 && Number.isInteger(team.turns)&&team.turns>=0)) return false;
    if (!Number.isInteger(game.activeTeam)||game.activeTeam<0||game.activeTeam>=n) return false;
    if (style==='pairs' && (!Array.isArray(game.pairSchedule)||game.pairSchedule.length!==n*(n-1)||!Number.isInteger(game.pairIndex)||game.pairIndex<0||game.pairIndex>=game.pairSchedule.length||!game.pairSchedule.every(pair=>Array.isArray(pair)&&pair.length===2&&pair[0]!==pair[1]&&pair.every(index=>Number.isInteger(index)&&index>=0&&index<n))||new Set(game.pairSchedule.map(pair=>pair.join(':'))).size!==game.pairSchedule.length)) return false;
    if (game.phase==='playing' && !game.special) {
      const timer=game.timer;
      if (!timer||!finite(timer.durationMs)||timer.durationMs<=0||!finite(timer.remainingMs)||timer.remainingMs<0||(!timer.paused&&!finite(timer.deadline))) return false;
    }
    if (['playing','lastWord','suddenWord'].includes(game.phase) && !game.pendingWord && (!game.word||typeof game.word.text!=='string'||typeof game.word.family!=='string')) return false;
    if (game.phase==='round' && !game.lastSummary) return false;
    if (game.roundHistory && (!Array.isArray(game.roundHistory)||game.roundHistory.some(round=>!Array.isArray(round.scores)||round.scores.length!==n||round.scores.some(score=>!finite(score))||(round.winnerIndex!=null&&(!Number.isInteger(round.winnerIndex)||round.winnerIndex<0||round.winnerIndex>=n))))) return false;
    return true;
  } catch { return false; }
}
export function normaliseSettings(settings) {
  const bounds={targetScore:[5,200,30],roundCount:[2,20,3],roundSeconds:[10,600,120],wordSeconds:[10,600,30]};
  const result={...settings};
  for(const [key,[min,max,fallback]] of Object.entries(bounds)) result[key]=Math.min(max,Math.max(min,Number.isFinite(Number(settings[key]))?Math.round(Number(settings[key])):fallback));
  return result;
}
export function pauseGame(game, now = Date.now()) {
  if (!game) return;
  if (game.phase === 'playing' && game.timer && !game.timer.paused) {
    game.timer.remainingMs = Math.max(0, game.timer.deadline - now);
    game.timer.deadline = null; game.timer.paused = true;
  }
  if (game.phase === 'countdown') {
    game.phase = game.countdownNext === 'sudden' ? 'suddenHandoff' : 'handoff';
    delete game.countdownEndsAt; delete game.countdownValue;
  }
}
export function checkpoint(state, now = Date.now()) {
  const snapshot = structuredClone({ version:4,savedAt:now,view:state.view,draft:state.draft,game:state.game });
  if (snapshot.game?.timer && !snapshot.game.timer.paused) snapshot.game.timer.remainingMs=Math.max(0,snapshot.game.timer.deadline-now);
  return snapshot;
}
export function readCheckpoint(storage) {
  try {
    const target=storage||globalThis.localStorage;
    for(const key of [SESSION_KEY,LEGACY_SESSION_KEY]) {
      try {const value=JSON.parse(target.getItem(key));if([3,4].includes(value?.version)&&['home','setup','game'].includes(value.view)&&(value.game==null||isValidGame(value.game))&&(value.view!=='game'||value.game)) return value;} catch { /* Try the other valid copy. */ }
    }
    return null;
  } catch { return null; }
}
export function writeCheckpoint(state, storage, now = Date.now()) {
  try {
    if(state.game && !isValidGame(state.game)) return null;
    const target=storage||globalThis.localStorage,value=checkpoint(state,now),previous=readCheckpoint(target);
    if ((previous?.game?._rev||0)>(value.game?._rev||0)) return null;
    target.setItem(SESSION_KEY,JSON.stringify(value));return value;
  } catch { return null; }
}
export function restoreGame(game) {
  if (!game) return game;
  if (game.phase==='playing'&&game.timer&&!game.timer.paused) {game.timer.remainingMs=Math.max(0,game.timer.remainingMs||0);game.timer.paused=true;game.timer.deadline=null;}
  if (game.phase==='countdown') pauseGame(game);
  return game;
}
