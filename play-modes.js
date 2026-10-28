export const PLAY_STYLES = [
  {id:'teams',name:'В своей команде',description:'Один объясняет, его команда угадывает.'},
  {id:'pairs',name:'Каждый с каждым',description:'Личный счёт. Каждый объясняет каждому, за слово оба получают +1.'},
  {id:'versus',name:'Объясняем соперникам',description:'Две команды от одного человека. Очки получает угадывающая сторона.'}
];
export const playStyle = settings => ['pairs','versus'].includes(settings?.playStyle) ? settings.playStyle : 'teams';
export const playStyleName = settings => PLAY_STYLES.find(s => s.id === playStyle(settings)).name;
export function entrants(settings) {
  return playStyle(settings) === 'pairs' ? (settings.participants || []).map(person => ({...person,players:[person.name]})) : playStyle(settings) === 'versus' ? settings.teams.slice(0,2) : settings.teams;
}
export function makePairSchedule(count, random = Math.random) {
  const order = Array.from({length:count},(_,i)=>i);
  for(let i=count-1;i>0;i--) {const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  const schedule=[];
  for(let distance=1;distance<count;distance++) for(let i=0;i<count;i++) schedule.push([order[i],order[(i+distance)%count]]);
  return schedule;
}
export function turnRoles(game) {
  const style=playStyle(game),receiver=game.activeTeam;
  if(style==='pairs') {const pair=game.pairSchedule[game.pairIndex];return {explainerIndex:pair[0],receiverIndex:pair[1],explainers:game.teams[pair[0]].name,guessers:game.teams[pair[1]].name};}
  if(style==='versus') return {explainerIndex:1-receiver,receiverIndex:receiver,explainers:game.teams[1-receiver].players.join(', '),guessers:game.teams[receiver].players.join(', ')};
  return {explainerIndex:receiver,receiverIndex:receiver,explainers:game.teams[receiver].players[game.roles?.explainer || 0],guessers:'своя команда'};
}
export function advanceTurn(game) {
  if(playStyle(game)==='pairs') {game.pairIndex=(game.pairIndex+1)%game.pairSchedule.length;game.activeTeam=game.pairSchedule[game.pairIndex][1];return game.pairIndex===0;}
  game.activeTeam=(game.activeTeam+1)%game.teams.length;
  return game.activeTeam===game.roundStartTeam;
}
export function nextCycle(game) {
  if(playStyle(game)==='pairs') {game.pairSchedule.push(game.pairSchedule.shift());game.pairIndex=0;game.activeTeam=game.pairSchedule[0][1];}
  else {game.roundStartTeam=(game.roundStartTeam+1)%game.teams.length;game.activeTeam=game.roundStartTeam;}
}
export function lastGuessers(game) {
  if(playStyle(game)==='versus') return [game.activeTeam];
  return game.teams.flatMap((_,index)=> playStyle(game)==='pairs' && index===turnRoles(game).explainerIndex ? [] : [index]);
}
export function applyScore(game,index,delta,type) {
  const recipients=[index];
  if(playStyle(game)==='pairs' && ['correct','skip','last'].includes(type)) recipients.push(turnRoles(game).explainerIndex);
  const unique=[...new Set(recipients)],previousScores=unique.map(teamIndex=>({teamIndex,score:game.teams[teamIndex].score}));
  for(const teamIndex of unique) game.teams[teamIndex].score=Math.max(0,game.teams[teamIndex].score+delta);
  return {teamIndex:index,previousScore:previousScores[0].score,previousScores,delta:game.teams[index].score-previousScores[0].score,type,word:game.word?.text || ''};
}
export function undoScore(game,action) {
  for(const previous of action.previousScores || [{teamIndex:action.teamIndex,score:action.previousScore}]) game.teams[previous.teamIndex].score=previous.score;
}
