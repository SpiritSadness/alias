import { PACKS, WORDS } from './words.js?v=16';
import { getSeen, reserveWord, getGame, saveGame as storeGame, getSession, saveSession, getDefinitionReports, reportDefinition, exportSeen, importSeen, requestPersistentStorage } from './storage.js?v=20';
import { renderInstallHint, handleInstallAction, initPwa } from './pwa.js?v=21';
import { renderPreferences, togglePreference, unlockAudio, playSound } from './preferences.js?v=19';
import { matchesWordSettings, buildTurnSummary, TEAM_COLORS, teamColor, selectedCategories, tieContenders, targetOutcome, additionalTurnChanges } from './game-rules.js?v=21';
import { pauseGame, readCheckpoint, writeCheckpoint, restoreGame } from './session.js?v=18';
import { createNavigation } from './navigation.js?v=18';
import { DEFINITIONS } from './definitions.js?v=18';

import { canReview, reviewWords, turnWords } from './review.js?v=19';

import { PLAY_STYLES, playStyle, playStyleName, entrants, makePairSchedule, turnRoles, advanceTurn, nextCycle, lastGuessers, applyScore, undoScore } from './play-modes.js?v=20';

const root = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const allFamilies = new Set(WORDS.map(word => word.family));
const stealSpaces = target => [0.25, 0.5, 0.75].map(factor => Math.round(target * factor)).filter((value, index, list) => value > 0 && value < target && list.indexOf(value) === index);

let seen = new Set();
let game = null;
let view = 'home';
let busy = false;
let toastTimer;
let ready = false;
let navigation;
let uiSaveTimer;
let lastCheckpointAt = 0;
let colorTeamIndex = 0;
let startingConfirmed = false;
let definitionReports = {};
let reviewedWord = null;
let draft = {
  playStyle: 'teams', participants: [{id:'person-a',name:'Аня'},{id:'person-b',name:'Паша'},{id:'person-c',name:'Маша'}],
  mode: 'classic', timerMode: 'round', roundSeconds: 120, wordSeconds: 30,
  scoreMode: 'round', roundCount: 3, targetScore: 30, category: 'all', categories: [], difficulty: 'mixed', skipPenalty: 0, tieMode: 'round',
  teams: [
    { id: 'team-a', name: 'Команда 1', players: ['Аня', 'Паша'] },
    { id: 'team-b', name: 'Команда 2', players: ['Маша', 'Илья'] }
  ]
};

function persistCheckpoint() {
  if (!ready) return;
  writeCheckpoint({ view, draft, game });
  lastCheckpointAt = Date.now();
}
function persistUi() {
  if (!ready) return;
  persistCheckpoint();
  clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => saveSession({ view, draft: structuredClone(draft), savedAt: Date.now() }).catch(console.warn), 200);
}
async function saveGame(value) {
  value.updatedAt = Date.now();
  persistCheckpoint();
  await storeGame(value);
}
function closeOverlay() {
  const dialog = root.querySelector('dialog[open]');
  if (!dialog) return false;
  dialog.close();
  return true;
}
function pauseAndPersist() {
  if (!ready) return;
  pauseGame(game);
  persistCheckpoint();
  if (game) { game.updatedAt = Date.now(); storeGame(game).catch(console.warn); }
  saveSession({ view, draft: structuredClone(draft), savedAt: Date.now() }).catch(console.warn);
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || low));
const activeTeam = () => game.teams[game.activeTeam];
const roundWins = () => game.teams.map((_, index) => (game.roundHistory || []).filter(round => round.winnerIndex === index).length);
const roundName = (number = game.roundNumber || 1) => game.roundCount && number > game.roundCount ? `Доп. раунд ${number - game.roundCount}` : `Раунд ${number}`;
const formatTime = ms => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const timerLeft = () => game?.timer ? (game.timer.paused ? game.timer.remainingMs : Math.max(0, game.timer.deadline - Date.now())) : 0;
const showToast = message => {
  toastNode.textContent = message;
  toastNode.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 3600);
};

function header() {
  return `<header class="topbar">
    <a class="brand" href="#home" data-action="home" aria-label="Alias — на главную"><img class="brand-logo" src="./icon.svg?v=18" width="40" height="40" alt=""><span>Alias</span></a>
    <div class="top-actions">
    <span class="preference-buttons">${renderPreferences()}</span>
    ${view !== 'home' ? '<button class="icon-button" type="button" data-action="back" aria-label="Назад">←</button>' : ''}</div>
  </header>`;
}

function renderHome() {
  const resume = game && !['finished', 'roundFinished', 'drawFinished'].includes(game.phase);
  return `${header()}<main class="home-hero">
    <section class="home-copy"><div class="eyebrow">Игра для друзей</div>
      <h1>Сыграем <em>в Alias?</em></h1>
      <div class="hero-actions"><button class="button button-primary button-large" data-action="new-game">Начать игру <span aria-hidden="true">↗</span></button>
      ${resume ? '<button class="button button-secondary button-large" data-action="resume-game">Продолжить партию</button>' : ''}</div>
      <div id="install-panel">${renderInstallHint()}</div>
    </section>
  </main>`;
}

function teamFields() {
  if (playStyle(draft) === 'pairs') return draft.participants.map((person,index) => `<div class="participant-card"><span class="person-dot" style="background:${teamColor(person,index)}"></span><input class="player-input" aria-label="Участник ${index + 1}" data-field="participant-name" data-index="${index}" value="${esc(person.name)}" maxlength="24"><button class="remove-button" data-action="remove-participant" data-index="${index}" aria-label="Удалить участника ${index + 1}" ${draft.participants.length <= 3 ? 'disabled' : ''}>×</button></div>`).join('');
  return entrants(draft).map((team, teamIndex) => `<div class="team-card">
    <div class="team-top"><button class="team-color-button" data-action="open-colors" data-team="${teamIndex}" style="--team-color:${teamColor(team, teamIndex)}" aria-label="Цвет команды ${teamIndex + 1}" title="Выбрать цвет"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
      <input class="team-name" aria-label="Название команды ${teamIndex + 1}" data-field="team-name" data-team="${teamIndex}" value="${esc(team.name)}" maxlength="30">
      ${playStyle(draft) === 'teams' && draft.teams.length > 2 ? `<button class="remove-button" data-action="remove-team" data-team="${teamIndex}" aria-label="Удалить команду">×</button>` : ''}</div>
    <div class="players">${team.players.map((player, playerIndex) => `<div class="player-row"><input class="player-input" aria-label="Игрок ${playerIndex + 1} команды ${teamIndex + 1}" data-field="player" data-team="${teamIndex}" data-player="${playerIndex}" value="${esc(player)}" maxlength="24">
      <button class="remove-button" data-action="remove-player" data-team="${teamIndex}" data-player="${playerIndex}" aria-label="Удалить игрока" ${team.players.length <= (playStyle(draft) === 'versus' ? 1 : 2) ? 'disabled' : ''}>×</button></div>`).join('')}</div>
    <button class="link-button" data-action="add-player" data-team="${teamIndex}">+ Добавить участника</button>
  </div>`).join('');
}

function categoryLabel() {
  const selected = selectedCategories(draft);
  if (!selected.length) return 'Все темы';
  if (selected.length > 2) return `Выбрано тем: ${selected.length}`;
  return selected.map(id => PACKS.find(pack => pack.id === id)?.name || id).join(', ');
}
function setupDialogs() {
  const selected = selectedCategories(draft);
  return `<dialog class="sheet-dialog" id="categories-dialog" aria-labelledby="categories-title"><div class="sheet-heading"><h2 id="categories-title">Темы для игры</h2><button class="icon-button" data-action="close-dialog" aria-label="Закрыть выбор тем">×</button></div><p class="field-note">Выберите одну или несколько тем.</p><button class="category-all ${!selected.length ? 'selected' : ''}" data-action="categories-all" aria-pressed="${!selected.length}">Все темы</button><div class="category-options">${PACKS.map(pack => `<label><input type="checkbox" data-field="category-multi" value="${pack.id}" ${selected.includes(pack.id) ? 'checked' : ''}><span class="category-emoji">${pack.emoji}</span><span>${esc(pack.name)}</span></label>`).join('')}</div><div class="sheet-footer"><span id="category-selection">${esc(categoryLabel())}</span><button class="button button-primary" data-action="close-dialog">Готово</button></div></dialog>
  <dialog class="sheet-dialog" id="colors-dialog" aria-labelledby="colors-title"><div class="sheet-heading"><h2 id="colors-title">Цвет команды</h2><button class="icon-button" data-action="close-dialog" aria-label="Закрыть выбор цвета">×</button></div><div id="color-options" class="color-options"></div></dialog>
  <dialog class="sheet-dialog" id="new-game-dialog" aria-labelledby="new-game-title"><h2 id="new-game-title">Начать новую партию?</h2><p>Текущая партия ещё не завершена. История слов сохранится.</p><div class="dialog-actions"><button class="button button-primary" data-action="resume-game">Продолжить текущую</button><button class="button button-secondary" data-action="confirm-start">Начать новую</button><button class="button button-ghost" data-action="close-dialog">Остаться в настройках</button></div></dialog>`;
}

function refreshCategoryUi() {
  const selected = selectedCategories(draft);
  for (const input of root.querySelectorAll('[data-field="category-multi"]')) input.checked = selected.includes(input.value);
  const all = root.querySelector('[data-action="categories-all"]');
  all?.classList.toggle('selected', !selected.length);
  all?.setAttribute('aria-pressed', String(!selected.length));
  for (const node of root.querySelectorAll('#category-selection, #category-button-label')) node.textContent = categoryLabel();
  const summary = root.querySelector('#setup-summary-values');
  if (summary) summary.innerHTML = setupSummaryDetails();
  persistUi();
}

function setupSummaryDetails() {
  const mode = draft.mode === 'classic' ? 'Классический' : 'Кастом';
  const roundScoring = draft.mode === 'custom' && draft.scoreMode === 'round';
  const timer = draft.mode === 'classic' ? '01:00 на все слова хода' : draft.timerMode === 'round' ? `${formatTime(draft.roundSeconds * 1000)} на все слова хода` : `${formatTime(draft.wordSeconds * 1000)} на каждое слово`;
  const selectedWords = WORDS.filter(word => matchesWordSettings(word, draft));
  const pool = selectedWords.filter(word => !seen.has(word.family));
  return `<div class="summary-rule"><span>Режим</span><strong>${playStyleName(draft)}</strong></div><div class="summary-rule"><span>Правила</span><strong>${mode}</strong></div>
    <div class="summary-rule"><span>${playStyle(draft) === 'pairs' ? 'Игроки' : 'Команды'}</span><strong>${entrants(draft).length}</strong></div>
    <div class="summary-rule"><span>Темы</span><strong>${esc(categoryLabel())}</strong></div>
    <div class="summary-rule"><span>Таймер</span><strong>${esc(timer)}</strong></div>
    <div class="summary-rule"><span>Победа</span><strong>${roundScoring ? 'больше выигранных раундов' : `до ${draft.targetScore} очков`}</strong></div>
    <div class="summary-rule"><span>При ничьей</span><strong>${draft.mode === 'classic' || draft.tieMode === 'sudden' ? 'решающее слово' : 'полный раунд'}</strong></div>
    ${roundScoring ? `<div class="summary-rule"><span>Раундов</span><strong>${draft.roundCount}</strong></div>` : ''}
    <div class="summary-rule"><span>Не показано слов</span><strong>${pool.length}</strong></div>
    <div class="remaining-bar"><i style="width:${selectedWords.length ? pool.length / selectedWords.length * 100 : 0}%"></i></div>
    <p class="field-note">Счётчик показывает, сколько слов ещё не встречалось в выбранной теме${draft.mode === 'custom' ? ' и сложности' : ''}.</p>`;
}

function setupSummary() {
  return `<aside class="panel setup-summary"><h3 style="margin-bottom:14px">Настройки игры</h3><div id="setup-summary-values">${setupSummaryDetails()}</div>
    <div class="setup-footer"><button class="button button-primary button-full button-large" data-action="start-game">Начать партию ↗</button><div id="setup-error"></div></div>
    <details class="history-panel"><summary>История слов</summary><p class="field-note">Сайт запоминает показанные слова в этом браузере, чтобы не выдать их снова в другой партии. Скачайте историю, если хотите перенести её на другой телефон или сохранить перед очисткой браузера. Загрузка добавит использованные слова, но не перенесёт текущую партию.</p><div class="settings-tools"><button class="button button-ghost button-small" data-action="export-history">Скачать историю</button>
      <button class="button button-ghost button-small" data-action="import-history">Загрузить историю</button><input type="file" id="history-file" accept="application/json,.json"></div></details>
    <details class="history-panel"><summary>О словаре</summary><p class="field-note">${WORDS.length.toLocaleString('ru')} карточек. Уже показанные слова исключаются из всех новых ходов и партий на этом устройстве. Толкования доступны после хода в разделе «Разобрать слова» и после партии в списке слов. Темы и уровни прошли автоматическую разметку и выборочную проверку; неоднозначные слова оставлены в «Разном». <a href="./word-data-notice.txt" target="_blank" rel="noopener">Источник и лицензия</a></p></details>
  </aside>`;
}

function renderSetup() {
  return `${header()}<main><div class="section-head"><div><div class="eyebrow">Настройка партии</div><h1>${playStyle(draft) === 'pairs' ? 'Соберите друзей.' : 'Соберите команду.'}</h1><p>Несколько решений — и можно играть.</p></div>${game && !['finished','roundFinished','drawFinished'].includes(game.phase) ? '<button class="button button-secondary" data-action="resume-game">Вернуться к партии →</button>' : ''}</div>
    <div class="setup-grid"><div class="stack">
      <section class="panel"><div class="panel-head"><h3>Как играем</h3></div><div class="play-style-grid">${PLAY_STYLES.map(style => `<button class="mode-card ${playStyle(draft) === style.id ? 'active' : ''}" data-action="set-play-style" data-value="${style.id}" aria-pressed="${playStyle(draft) === style.id}"><strong>${style.name}</strong><small>${style.description}</small></button>`).join('')}</div></section>
      <section class="panel"><div class="panel-head"><h3><span class="step">1</span> Правила</h3></div>
        <div class="mode-grid"><button class="mode-card ${draft.mode === 'classic' ? 'active' : ''}" data-action="set-mode" data-value="classic"><span class="mode-icon">⌛</span><strong>Классический</strong><small>1 минута на ход. Очки копятся до финиша.</small></button>
        <button class="mode-card ${draft.mode === 'custom' ? 'active' : ''}" data-action="set-mode" data-value="custom"><span class="mode-icon">⚡</span><strong>Кастом</strong><small>Свои настройки времени, темы и подсчёта очков.</small></button></div>
      </section>
      <section class="panel"><div class="panel-head"><h3><span class="step">2</span> Участники</h3><span class="mini-pill">${playStyle(draft) === 'pairs' ? 'от 3 игроков' : playStyle(draft) === 'versus' ? 'от 1 на команду' : 'от 2 на команду'}</span></div>
        <div class="team-grid">${teamFields()}</div>${playStyle(draft) === 'pairs' ? `<button class="link-button" data-action="add-participant" ${draft.participants.length >= 12 ? 'disabled' : ''}>+ Добавить участника</button>` : playStyle(draft) === 'teams' ? `<button class="link-button" data-action="add-team" ${draft.teams.length >= 6 ? 'disabled' : ''}>+ Добавить команду</button>` : ''}
      </section>
      <section class="panel"><div class="panel-head"><h3><span class="step">3</span> Параметры игры</h3></div><p class="field-note">${playStyle(draft) === 'pairs' ? 'Один полный круг — все пары в обе стороны. За слово оба получают +1; штраф за пропуск, если включён, тоже получают оба. Финиш проверяется после полного круга.' : playStyle(draft) === 'versus' ? 'Все участники одной команды объясняют другой. Очки и штрафы получает только угадывающая команда. Раунд — два хода со сменой сторон.' : ''}${playStyle(draft) !== 'teams' && draft.mode === 'classic' ? ' Классический набор: минута на ход, пропуск −1. Ходы перехвата используются только в режиме «В своей команде».' : ''}</p>
        ${draft.mode === 'custom' ? `<div class="field" style="margin-bottom:16px"><span>Таймер</span><div class="segmented">
          <button class="${draft.timerMode === 'round' ? 'active' : ''}" data-action="set-timer-mode" data-value="round">На все слова хода</button>
          <button class="${draft.timerMode === 'word' ? 'active' : ''}" data-action="set-timer-mode" data-value="word">На каждое слово</button></div></div>
          <div class="field" style="margin-bottom:16px"><span>Как определить победителя</span><div class="segmented">
          <button class="${draft.scoreMode === 'round' ? 'active' : ''}" data-action="set-score-mode" data-value="round">По итогам раунда</button>
          <button class="${draft.scoreMode === 'target' ? 'active' : ''}" data-action="set-score-mode" data-value="target">До нужных очков</button></div></div>
          <div class="field" style="margin-bottom:16px"><span>При ничьей</span><div class="segmented"><button class="${draft.tieMode !== 'sudden' ? 'active' : ''}" data-action="set-tie-mode" data-value="round">Полный раунд</button><button class="${draft.tieMode === 'sudden' ? 'active' : ''}" data-action="set-tie-mode" data-value="sudden">Решающее слово</button></div><small class="field-note">${draft.tieMode === 'sudden' ? 'Ведущий объясняет одно слово всем финалистам. Первый правильный ответ определяет победителя.' : playStyle(draft) === 'pairs' ? 'Ещё один полный круг всех пар.' : 'Каждая команда получает ещё по одному ходу.'}</small></div>
          <p class="field-note">${draft.scoreMode === 'round' ? playStyle(draft) === 'pairs' ? 'Раунд включает все пары в обе стороны.' : 'В каждом раунде каждая команда играет один раз.' : 'Все команды играют одинаковое число ходов. После достижения цели круг доигрывается.'}</p>` : '<p class="field-note">На ход — 1 минута. Все участники доигрывают полный круг; при равном счёте на финише победителя определит решающее слово.</p>'}
        <div class="field-grid">${draft.mode === 'classic' || draft.scoreMode === 'target' ? `<label class="field"><span>Игра до очков</span><input type="number" min="5" max="200" data-field="target-score" value="${draft.targetScore}"></label>` : ''}
        ${draft.mode === 'custom' && draft.scoreMode === 'round' ? `<label class="field"><span>Раундов в партии</span><input type="number" min="2" max="20" data-field="round-count" value="${draft.roundCount}"></label>` : ''}
        ${draft.mode === 'custom' ? `<label class="field"><span>${draft.timerMode === 'round' ? 'Секунд на все слова хода' : 'Секунд на каждое слово'}</span><input type="number" min="10" max="600" data-field="${draft.timerMode === 'round' ? 'round-seconds' : 'word-seconds'}" value="${draft.timerMode === 'round' ? draft.roundSeconds : draft.wordSeconds}"></label>` : ''}
        <div class="field"><span>Темы</span><button class="category-select" data-action="open-categories" aria-haspopup="dialog" aria-controls="categories-dialog"><span id="category-button-label">${esc(categoryLabel())}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button></div>
        ${draft.mode === 'custom' ? `<label class="field"><span>Сложность</span><select data-field="difficulty"><option value="mixed" ${draft.difficulty === 'mixed' ? 'selected' : ''}>Смешанная</option><option value="easy" ${draft.difficulty === 'easy' ? 'selected' : ''}>Лёгкая</option><option value="medium" ${draft.difficulty === 'medium' ? 'selected' : ''}>Средняя</option><option value="hard" ${draft.difficulty === 'hard' ? 'selected' : ''}>Сложная</option></select></label>
        <label class="field"><span>Штраф за пропуск</span><select data-field="skip-penalty"><option value="0" ${draft.skipPenalty === 0 ? 'selected' : ''}>Без штрафа</option><option value="1" ${draft.skipPenalty === 1 ? 'selected' : ''}>−1 очко</option></select></label>` : ''}</div>
      </section>
    </div>${setupSummary()}</div></main>${setupDialogs()}`;
}

function renderScores() {
  const highlighted = game.phase === 'round' ? (game.lastSummary?.teamIndex ?? game.teams.findIndex(team => team.name === game.lastSummary?.teamName)) : ['roundResult', 'roundFinished', 'roundTie', 'finished','gameTie','suddenHandoff','suddenWord','tieEmpty','drawFinished'].includes(game.phase) ? -1 : game.activeTeam;
  return `<div class="score-strip" aria-label="${game.mode === 'custom' && game.scoreMode === 'round' ? 'Очки в этом раунде' : playStyle(game) === 'pairs' ? 'Личный счёт' : 'Счёт команд'}">${game.teams.map((team, index) => `<div class="score-item ${index === highlighted ? 'active' : ''}" style="--team-color:${teamColor(team,index)}"><span><i class="status-dot" style="display:inline-block;background:${teamColor(team,index)};box-shadow:none;margin-right:6px"></i>${esc(team.name)}</span><strong>${team.score}</strong></div>`).join('')}</div>`;
}

function gameHeader() {
  const roundScoring = game.mode === 'custom' && game.scoreMode === 'round';
  const roundLabel = `${roundName().toLocaleUpperCase('ru')}${game.roundCount && game.roundNumber <= game.roundCount ? ` / ${game.roundCount}` : ''}`;
  return `${header()}<div class="game-top"><div class="game-kicker"><span>${roundScoring ? roundLabel : 'ПАРТИЯ'}</span><span>→</span><b>${game.mode === 'classic' ? 'Классический' : 'Кастом'}</b></div><span class="mini-pill">${roundScoring ? 'Очки за раунд' : `Финиш: ${game.targetScore}`}</span></div>${renderScores()}<p class="play-mode-caption">${playStyleName(game)}</p>`;
}

function roleNames() {
  const team = activeTeam();
  return { explainer: turnRoles(game).explainers };
}

function renderHandoff() {
  const team = activeTeam();
  const { explainer } = roleNames();
  const special = playStyle(game) === 'teams' && game.mode === 'classic' && team.stealNext;
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">${game.mode === 'custom' && game.scoreMode === 'round' ? roundName() : `Ход ${team.turns + 1}`} · ${esc(team.name)}</div>
    <div class="turn-emoji">${special ? '⚡' : '🎤'}</div><h1>${special ? 'Ход перехвата!' : 'Ваша очередь!'}</h1>
    <p>${special ? 'Пять слов без таймера. Угадывать могут все команды.' : 'Передайте телефон объясняющему. Слово появится после старта.'}</p>
    ${playStyle(game) === 'pairs' ? `<p class="field-note">Пара ${game.pairIndex + 1} из ${game.pairSchedule.length}</p>` : ''}<div class="pair-line">${esc(explainer)} <span class="pair-arrow">→</span> ${playStyle(game) === 'teams' ? 'вся команда' : esc(turnRoles(game).guessers)}</div>
    <button class="button button-primary button-large button-full" data-action="start-turn">Начать ход →</button></div></main>`;
}

function renderCountdown() {
  return `${gameHeader()}<main class="game-frame"><section class="countdown-stage"><p class="countdown-team">${game.countdownNext === 'sudden' ? 'Ведущий объясняет всем финалистам' : `${esc(roleNames().explainer)} → ${esc(turnRoles(game).guessers)}`}</p><div class="countdown-orbit"><div class="countdown-value" id="countdown-value" role="status" aria-live="polite">${game.countdownValue || 'Начали!'}</div></div><h1>Приготовьтесь</h1><p>Слово появится после отсчёта</p></section></main>`;
}

async function beginCountdown(next = 'turn') {
  game.phase = 'countdown';
  game.countdownNext = next;
  game.countdownValue = 3;
  game.countdownEndsAt = Date.now() + 3400;
  await saveGame(game);
  render();
  playSound('tick');
}

function renderTimer() {
  if (game.special) return `<div class="timer-line"><span class="timer-label">⚡ Ход перехвата</span><span class="timer-value">${game.specialPlayed}/5</span></div>`;
  return `<div class="timer-line"><span class="timer-label">◷ ${game.mode === 'custom' && game.timerMode === 'word' ? 'На это слово' : 'На все слова хода'}</span><span class="timer-value" id="timer-value">${formatTime(timerLeft())}</span></div>
    <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>`;
}

function renderPlaying() {
  const word = game.word;
  const team = activeTeam();
  if (!word) return renderEmpty();
  const lastAction = game.actions.at(-1);
  return `${gameHeader()}<main class="game-frame"><div class="turn-card">
    ${playStyle(game) !== 'teams' ? `<p class="play-role">${esc(turnRoles(game).explainers)} → ${esc(turnRoles(game).guessers)}</p>` : ''}${renderTimer()}
    <div class="word-card ${game.timer?.paused ? 'paused-word' : ''}" id="word-card"><span class="word-hint">Объясни это слово</span><strong>${esc(word.text)}</strong>
      <div class="word-meta"><span>${word.emoji} ${esc(word.categoryName)}</span><span>${esc(word.difficultyName)}</span>${game.mode === 'classic' ? `<span>№ ${game.slot}</span>` : ''}</div></div>
    ${game.timer?.paused ? `<button class="button button-primary button-full button-large" style="margin-top:17px" data-action="resume-timer">▶ Продолжить</button>` : game.special ?
      `<p class="field-note">Кто первым угадал это слово?</p><div class="winner-grid">${game.teams.map((item, index) => `<button class="button button-secondary" data-action="special-answer" data-index="${index}">${esc(item.name)} +1</button>`).join('')}<button class="button button-ghost" data-action="special-answer" data-index="-1">Никто</button></div>` :
      `<div class="action-grid"><button class="button button-secondary" data-action="skip">Пропустить ${game.mode === 'classic' || game.skipPenalty ? '−1' : ''}</button><button class="button button-coral" data-action="correct">Угадали +1 ↗</button></div>`}
    <div class="sub-actions">${game.timer?.paused ? '' : `<button data-action="${game.timer ? 'pause-timer' : 'end-turn'}">${game.timer ? 'Ⅱ Пауза' : 'Завершить ход'}</button>`}
      <button data-action="undo" ${lastAction ? '' : 'disabled'}>↶ Отменить очки</button>
      ${game.timer && !game.timer?.paused ? '<button data-action="end-turn">Завершить ход</button>' : ''}</div>
  </div></main>`;
}

function renderLastWord() {
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">Время вышло</div><div class="turn-emoji">⏱️</div><h1>Последнее слово</h1>
    <p>${playStyle(game) === 'versus' ? 'Можно договорить начатое объяснение. Угадала ли другая команда?' : playStyle(game) === 'pairs' ? 'Начатое объяснение можно закончить. Отвечают все, кроме объясняющего. Кто угадал первым?' : 'Если объяснение уже началось, угадывать могут все команды. Кто ответил первым?'}</p>
    <div class="last-word-card"><span>Последнее слово</span><strong>${esc(game.word?.text || '—')}</strong></div>
    <div class="winner-grid">${game.teams.flatMap((team, index) => lastGuessers(game).includes(index) ? [`<button class="button button-secondary" data-action="last-word" data-index="${index}">${esc(team.name)} +1</button>`] : []).join('')}
    <button class="button button-ghost" data-action="last-word" data-index="-1">Никто не угадал</button></div></div></main>`;
}

function renderWordReview(scope = 'all') {
  const words = reviewWords(game, scope);
  if (!words.length) return '';
  const labels = { guessed:'Угадано', skipped:'Пропущено', unanswered:'Без ответа', shown:'Без ответа' };
  return `<details class="word-review"><summary>${scope === 'all' ? 'Слова партии' : 'Разобрать слова'} · ${words.length}</summary><p class="field-note">Нажмите на слово, чтобы посмотреть значение.</p><div class="review-list">${words.map(word => `<button class="review-word" data-action="open-definition" data-word="${esc(word.text)}"><span>${esc(word.text)}</span><small>${labels[word.status] || 'Без ответа'}</small></button>`).join('')}</div></details>`;
}
function resolvedReviewWord(text) {
  const entry = reviewWords(game).find(word => word.text === text);
  if (!entry) return null;
  return WORDS.find(word => word.text === text) || entry;
}

function renderLastWordAward(summary) {
  if (!summary?.lastWord) return '';
  return `<div class="last-word-award"><span>Последнее слово «${esc(summary.lastWord.word)}»</span><strong>${summary.lastWord.teamName ? `+1 → ${esc(summary.lastWord.recipients?.join(', ') || summary.lastWord.teamName)}` : 'Никто не угадал'}</strong></div>`;
}

function renderLastWordsHistory(currentRound = false) {
  const turns = (game.turnHistory || (game.lastSummary ? [game.lastSummary] : [])).filter(turn => turn.lastWord && (!currentRound || turn.roundNumber === game.roundNumber));
  if (!turns.length) return '';
  return `<details class="round-history"><summary>Последние слова · ${turns.length}</summary>${turns.map(turn => `<div><span>${esc(turn.teamName)}: «${esc(turn.lastWord.word)}»</span><span>${turn.lastWord.teamName ? `+1 → ${esc(turn.lastWord.teamName)}` : 'Не угадали'}</span></div>`).join('')}</details>`;
}

function renderAdditionalTurnChanges(summary) {
  const changes = additionalTurnChanges(summary);
  if (!changes.length) return '';
  return `<div class="turn-allocations" aria-label="Другие изменения счёта"><span>Другие изменения счёта</span>${changes.map(item => `<div><span>${esc(item.teamName)}${item.excludingLastWord ? '<br><small class="field-note">За остальные слова</small>' : ''}</span><strong>${item.delta > 0 ? '+' : ''}${item.delta}</strong></div>`).join('')}</div>`;
}

function renderRound() {
  const previous = game.lastSummary;
  const summary = previous.allocations ? previous : buildTurnSummary({ ...game, special: previous.special }, Math.max(0, game.teams.findIndex(team => team.name === previous.teamName)));
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">Ход завершён</div><div class="turn-emoji">👏</div><h1>${esc(summary.teamName)}</h1>
    <p>${summary.special ? 'Результат хода перехвата для всех команд.' : playStyle(game) === 'pairs' ? 'Личный результат за этот ход.' : 'Результат угадывающей команды за этот ход.'}</p>
    <div class="turn-results"><div class="turn-result"><strong>${summary.correct}</strong><small>${summary.special ? 'угадано всего' : 'угадано'}</small></div><div class="turn-result"><strong>${summary.skipped}</strong><small>пропущено</small></div><div class="turn-result"><strong>${summary.net >= 0 ? '+' : ''}${summary.net}</strong><small>${summary.special ? 'очков всем командам' : 'очков за ход'}</small></div></div>
    ${renderLastWordAward(summary)}${renderWordReview('turn')}
    ${renderAdditionalTurnChanges(summary)}
    <p class="fine-print">${playStyle(game) === 'teams' ? `Следующая: ${esc(activeTeam().name)}.` : `Далее: ${esc(turnRoles(game).explainers)} → ${esc(turnRoles(game).guessers)}.`} ${game.mode === 'classic' && activeTeam().stealNext ? 'Для этой команды готов ход перехвата.' : ''}</p>
    <button class="button button-primary button-large button-full" data-action="next-turn">Передать ход →</button></div></main>`;
}

function renderRoundResult() {
  const best = Math.max(...game.teams.map(team => team.score));
  const winners = game.teams.filter(team => team.score === best);
  const wins = roundWins();
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="finish-trophy">★</div><div class="eyebrow">Раунд ${game.roundNumber || 1} завершён</div>
    <h1>${winners.length === 1 ? `${esc(winners[0].name)} выиграла раунд!` : 'Ничья в раунде!'}</h1>
    <p>${game.teams.map(team => `${esc(team.name)} — ${team.score} ${team.score % 10 === 1 && team.score % 100 !== 11 ? 'очко' : [2, 3, 4].includes(team.score % 10) && ![12, 13, 14].includes(team.score % 100) ? 'очка' : 'очков'}`).join(' · ')}</p>
    ${game.roundCount ? `<p class="fine-print">Выиграно раундов: ${game.teams.map((team, index) => `${esc(team.name)} — ${wins[index]}`).join(' · ')}. В следующем раунде очки за слова начнутся с нуля.</p>` : '<p class="fine-print">В следующем раунде очки начнутся с нуля.</p>'}
    ${renderLastWordAward(game.lastSummary)}${renderLastWordsHistory(true)}${renderWordReview('round')}
    <div class="game-actions"><button class="button button-primary button-large" data-action="new-round">Следующий раунд ↗</button><button class="button button-secondary button-large" data-action="new-game">Новая игра</button></div></div></main>`;
}

function renderRoundFinished() {
  const history = game.roundHistory || [];
  const wins = roundWins();
  const best = Math.max(...wins);
  const winnerIndex = game.tiebreak?.winnerIndex ?? wins.indexOf(best);
  const tied = !game.tiebreak && wins.filter(value => value === best).length > 1;
  const needsDecision = game.phase === 'roundTie';
  const sudden = game.tieMode === 'sudden';
  const canContinue = needsDecision && poolForTurn().filter(word => !seen.has(word.family)).length >= (sudden ? 1 : game.teams.length);
  const played = history.length;
  const extraRounds = Math.max(0, played - game.roundCount);
  const roundNoun = played % 10 === 1 && played % 100 !== 11 ? 'раунд' : [2, 3, 4].includes(played % 10) && ![12, 13, 14].includes(played % 100) ? 'раунда' : 'раундов';
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="finish-trophy">★</div><div class="eyebrow">${needsDecision ? 'Ничья по раундам' : `Партия завершена · ${played} ${roundNoun}`}</div>
    <h1>${tied ? 'Ничья!' : `Победитель — ${esc(game.teams[winnerIndex].name)}`}</h1>
    <p>Победы в раундах${extraRounds ? ' · дополнительные учтены' : ''}</p>
    <div class="round-standings">${game.teams.map((team, index) => `<div><span>${esc(team.name)}</span><strong>${wins[index]}</strong></div>`).join('')}</div>
    ${extraRounds ? `<p class="fine-print">Основных раундов: ${game.roundCount} · дополнительных: ${extraRounds}</p>` : ''}
    <p class="fine-print">${needsDecision ? canContinue ? sudden ? 'Решающее слово отгадывают команды с одинаковым числом побед. Первый правильный ответ определит победителя партии.' : 'Дополнительный раунд даёт полный круг: все команды или все пары получают свои ходы. При новой ничьей можно повторить или закончить вничью.' : 'Для продолжения не хватает новых слов. Партию можно закончить вничью.' : 'Ничьи в раундах не дают победу ни одной команде.'}</p>
    <details class="round-history"><summary>Результаты раундов</summary>${history.map((round, index) => `<div><span>${roundName(index + 1)}</span><span>${round.scores.map((score, teamIndex) => `${esc(game.teams[teamIndex].name)} ${score}`).join(' · ')}</span></div>`).join('')}</details>
    ${renderTiebreakResult()}${renderLastWordAward(game.lastSummary)}${renderLastWordsHistory()}${renderWordReview() }
    <div class="game-actions">${needsDecision ? `${canContinue ? `<button class="button button-primary button-large" data-action="${sudden ? 'start-tiebreak' : 'new-round'}">${sudden ? 'Решающее слово' : 'Дополнительный раунд'} ↗</button>` : ''}<button class="button button-secondary button-large" data-action="finish-draw">Закончить вничью</button>` : '<button class="button button-primary button-large" data-action="new-game">Новая партия ↗</button><button class="button button-secondary button-large" data-action="home">На главную</button>'}</div></div></main>`;
}

function renderTiebreakResult() {
  return game.tiebreak ? `<div class="last-word-award"><span>Решающее слово «${esc(game.tiebreak.word)}»</span><strong>${esc(game.teams[game.tiebreak.winnerIndex].name)} ответила первой</strong><small>Решающий ответ учтён отдельно и не добавляет полный раунд.</small></div>` : '';
}

function renderGameTie() {
  const sudden = game.mode === 'classic' || game.tieMode === 'sudden';
  return `${gameHeader()}<main class="game-frame"><section class="turn-card center"><div class="eyebrow">Равный счёт на финише</div><h1>Ничья!</h1><p>${playStyle(game) === 'pairs' ? 'Все пары завершили полный круг.' : 'Все команды сыграли одинаковое число ходов.'} ${sudden ? 'Победителя определит одно слово: кто ответит первым.' : playStyle(game) === 'pairs' ? 'Ещё один полный круг всех пар.' : 'Каждая команда получит ещё по одному ходу.'}</p>${renderWordReview()}<div class="game-actions"><button class="button button-primary" data-action="${sudden ? 'start-tiebreak' : 'extra-target'}">${sudden ? 'Решающее слово' : 'Ещё полный круг'} →</button><button class="button button-secondary" data-action="finish-draw">Закончить вничью</button></div></section></main>`;
}

function renderSuddenHandoff() {
  const contenders = game.suddenContenders || tieContenders(game);
  return `${gameHeader()}<main class="game-frame"><section class="turn-card center"><div class="eyebrow">Финал</div><h1>Решающее слово</h1><p>Передайте телефон ведущему, который не участвует в отгадывании. Он объясняет слово всем финалистам одновременно.</p><div class="finalists">${contenders.map(index => `<span style="--team-color:${teamColor(game.teams[index],index)}">${esc(game.teams[index].name)}</span>`).join('')}</div><p class="fine-print">Первый правильный ответ приносит победу. Экран со словом видит только ведущий.</p><button class="button button-primary button-full" data-action="start-sudden">Начать отсчёт →</button></section></main>`;
}

function renderSuddenWord() {
  return `${gameHeader()}<main class="game-frame"><section class="turn-card center"><div class="eyebrow">Решающее слово</div><div class="word-card"><span class="word-hint">Ведущий объясняет всем финалистам</span><strong>${esc(game.word.text)}</strong></div><p class="field-note" style="margin-top:18px">Кто ответил первым?</p><div class="winner-grid">${game.suddenContenders.map(index => `<button class="button button-secondary" data-action="sudden-answer" data-index="${index}">${esc(game.teams[index].name)} угадала</button>`).join('')}</div><button class="button button-ghost" data-action="skip-sudden">Другое слово</button></section></main>`;
}

function renderTieEmpty() {
  return `${gameHeader()}<main class="game-frame"><section class="turn-card center"><h1>Новые слова закончились</h1><p>Для решающего слова нужен свежий набор. Эту партию можно завершить вничью.</p>${renderWordReview()}<button class="button button-primary" data-action="finish-draw">Завершить вничью</button></section></main>`;
}

function renderDrawFinished() {
  return `${gameHeader()}<main class="game-frame"><section class="turn-card center"><div class="eyebrow">Партия завершена</div><h1>Ничья!</h1><p>${game.teams.map(team => `${esc(team.name)} — ${team.score}`).join(' · ')}</p>${renderLastWordsHistory()}${renderWordReview() }<button class="button button-primary" data-action="new-game">Новая партия →</button></section></main>`;
}

function renderFinished() {
  const winner = game.teams.reduce((best, team) => team.score > best.score ? team : best, game.teams[0]);
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="finish-trophy">★</div><div class="eyebrow">Партия завершена</div>
    <h1>Победитель — ${esc(winner.name)}</h1><p>Вы набрали ${winner.score} очков. Сыграем ещё? Новая партия начнётся с новых слов.</p>
    ${renderTiebreakResult()}${renderLastWordAward(game.lastSummary)}${renderLastWordsHistory()}${renderWordReview() }
    <div class="game-actions"><button class="button button-primary button-large" data-action="new-game">Новая партия ↗</button><button class="button button-secondary button-large" data-action="home">На главную</button></div></div></main>`;
}

function renderEmpty() {
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="turn-emoji">📚</div><h1>Новые слова закончились</h1>
    <p>В выбранном наборе больше нет непоказанных слов. Повторять старые карточки мы не будем. Попробуйте другую тему или сложность в новой партии.</p>
    <div class="game-actions"><button class="button button-primary" data-action="end-turn">Завершить ход</button><button class="button button-secondary" data-action="new-game">Новая настройка</button></div></div></main>`;
}

function render() {
  const page = view === 'home' ? renderHome() : view === 'setup' ? renderSetup() : game ? (
    game.phase === 'handoff' ? renderHandoff() : game.phase === 'countdown' ? renderCountdown() : game.phase === 'playing' ? renderPlaying() :
    game.phase === 'lastWord' ? renderLastWord() : game.phase === 'round' ? renderRound() : game.phase === 'roundResult' ? renderRoundResult() : ['roundTie', 'roundFinished'].includes(game.phase) ? renderRoundFinished() :
    game.phase === 'gameTie' ? renderGameTie() : game.phase === 'suddenHandoff' ? renderSuddenHandoff() : game.phase === 'suddenWord' ? renderSuddenWord() : game.phase === 'tieEmpty' ? renderTieEmpty() : game.phase === 'drawFinished' ? renderDrawFinished() : game.phase === 'finished' ? renderFinished() : renderEmpty()
  ) : renderHome();
  root.innerHTML = page + '<dialog class="sheet-dialog definition-dialog" id="definition-dialog" aria-labelledby="definition-title"><div class="sheet-heading"><h2 id="definition-title" tabindex="-1" autofocus></h2><button class="icon-button" data-action="close-dialog" aria-label="Закрыть значение слова">×</button></div><div id="definition-body"></div><button class="button button-primary button-full" data-action="close-dialog">Понятно</button></dialog>';
  updateTimer();
  navigation?.sync(view);
  persistUi();
}

function updateTimer() {
  if (!game || game.phase !== 'playing' || !game.timer) return;
  const remaining = timerLeft();
  const value = root.querySelector('#timer-value');
  const fill = root.querySelector('#timer-fill');
  if (value) value.textContent = formatTime(remaining);
  if (fill) {
    fill.style.width = `${Math.min(100, Math.max(0, remaining / game.timer.durationMs * 100))}%`;
    fill.classList.toggle('urgent', remaining < 10000);
  }
}

async function run(work) {
  if (busy) return;
  busy = true;
  try { await work(); } catch (error) { console.error(error); showToast(error.message || 'Что-то пошло не так'); }
  finally { busy = false; }
}

function validateDraft() {
  const roster = entrants(draft), individual = playStyle(draft) === 'pairs';
  if (individual && (roster.length < 3 || roster.length > 12)) return 'Нужно от 3 до 12 участников.';
  if (!individual && (roster.length < 2 || roster.some(team => team.players.length < (playStyle(draft) === 'versus' ? 1 : 2)))) return playStyle(draft) === 'versus' ? 'Нужно две команды хотя бы по одному человеку.' : 'Нужно минимум две команды по два участника.';
  const names = roster.flatMap(team => team.players.map(name => name.trim().toLocaleLowerCase('ru')));
  if (roster.some(team => !team.name.trim()) || names.some(name => !name)) return 'Заполните имена участников и названия команд.';
  if (new Set(names).size !== names.length) return 'Имена участников должны различаться.';
  if (!individual && new Set(roster.map(team => team.name.trim().toLocaleLowerCase('ru'))).size !== roster.length) return 'Названия команд должны различаться.';
  if ((draft.mode === 'classic' || draft.scoreMode === 'target') && (draft.targetScore < 5 || draft.targetScore > 200)) return 'Цель по очкам должна быть от 5 до 200.';
  if (draft.mode === 'custom' && draft.scoreMode === 'round' && (!Number.isInteger(draft.roundCount) || draft.roundCount < 2 || draft.roundCount > 20)) return 'Число раундов должно быть от 2 до 20.';
  if (draft.mode === 'custom' && (draft.timerMode === 'round' ? draft.roundSeconds : draft.wordSeconds) < 10) return 'Минимальное время — 10 секунд.';
  const pool = WORDS.filter(word => !seen.has(word.family) && matchesWordSettings(word, draft));
  if (!pool.length) return 'В этом наборе больше нет новых слов. Выберите другую тему или сложность.';
  return null;
}

function defaultRoles(team) {
  return { explainer: ((team.explainerStart ?? 0) + team.turns) % team.players.length };
}

function randomExplainer(team) {
  return Math.floor(Math.random() * team.players.length);
}

function poolForTurn() {
  return WORDS.filter(word => matchesWordSettings(word, game));
}

async function nextWord() {
  game.word = null;
  game.pendingWord = true;
  persistCheckpoint();
  const { word } = await reserveWord(poolForTurn());
  game.word = word;
  game.pendingWord = false;
  if (!word) { game.phase = 'empty'; game.timer = null; }
  else if (game.mode === 'custom' && game.timerMode === 'word') {
    game.timer.remainingMs = game.timer.durationMs;
    game.timer.deadline = Date.now() + game.timer.durationMs;
  }
  if (word) { seen.add(word.family); game.turnWords ||= []; game.turnWords.push({text:word.text,family:word.family,status:'unanswered'}); }
  await saveGame(game);
  render();
}

async function reserveSuddenWord() {
  game.decidingWords ||= [];
  const previous = game.decidingWords.at(-1);
  if (previous && previous.status !== 'guessed') previous.status = 'skipped';
  delete game.countdownNext;
  delete game.countdownEndsAt;
  delete game.countdownValue;
  game.timer = null;
  game.word = null;
  game.pendingWord = true;
  persistCheckpoint();
  const { word } = await reserveWord(poolForTurn());
  game.word = word;
  game.pendingWord = false;
  game.phase = word ? 'suddenWord' : 'tieEmpty';
  if (word) { seen.add(word.family); game.decidingWords.push({text:word.text,family:word.family,status:'unanswered'}); }
  await saveGame(game);
  render();
}

async function startTurn() {
  if (game.countdownNext === 'sudden') return reserveSuddenWord();
  const team = activeTeam();
  delete game.countdownNext;
  delete game.countdownEndsAt;
  delete game.countdownValue;
  game.special = playStyle(game) === 'teams' && game.mode === 'classic' && team.stealNext;
  team.stealNext = false;
  game.slot = (team.score % 8) + 1;
  game.turnStartScore = team.score;
  game.turnStartScores = game.teams.map(item => item.score);
  game.lastWordResult = null;
  game.turnStats = { correct: 0, skipped: 0, mistakes: 0 };
  game.specialPlayed = 0;
  game.actions = [];
  game.turnWords = [];
  game.phase = 'playing';
  game.timer = game.special ? null : {
    durationMs: (game.mode === 'classic' ? 60 : game.timerMode === 'round' ? game.roundSeconds : game.wordSeconds) * 1000,
    remainingMs: 0, deadline: null, paused: false
  };
  if (game.timer) {
    game.timer.remainingMs = game.timer.durationMs;
    game.timer.deadline = Date.now() + game.timer.durationMs;
  }
  await nextWord();
}

function recordScore(teamIndex, delta, type, label) {
  const team = game.teams[teamIndex];
  const review = game.turnWords?.find(word => word.text === game.word?.text);
  if (review) review.status = ['correct','special','last'].includes(type) ? 'guessed' : 'skipped';
  game.actions.push({ ...applyScore(game,teamIndex,delta,type), label });
  if (type === 'correct') game.turnStats.correct++;
  if (type === 'skip') game.turnStats.skipped++;
  if (type === 'mistake') game.turnStats.mistakes++;
}

async function answer(type) {
  if (game.phase !== 'playing' || game.timer?.paused || game.special) return;
  if (timerLeft() <= 0) { await timeout(); return; }
  const delta = type === 'correct' ? 1 : game.mode === 'classic' ? -1 : -game.skipPenalty;
  recordScore(game.activeTeam, delta, type, type === 'correct' ? 'Угадали +1' : `Пропуск ${delta || '0'}`);
  await nextWord();
}

async function specialAnswer(index) {
  if (game.phase !== 'playing' || !game.special) return;
  if (index >= 0) recordScore(index, 1, 'special', `${game.teams[index].name} +1`);
  if (index < 0 && game.turnWords?.at(-1)) game.turnWords.at(-1).status = 'skipped';
  game.specialPlayed++;
  if (game.specialPlayed >= 5) await finishTurn(); else await nextWord();
}

async function timeout() {
  if (game.phase !== 'playing' || game.special || game.timer?.paused || timerLeft() > 0) return;
  game.timer.deadline = Date.now();
  game.timer.remainingMs = 0;
  game.phase = 'lastWord';
  playSound('time');
  await saveGame(game);
  render();
}

async function finishTurn() {
  if (!game || !['playing', 'lastWord', 'empty'].includes(game.phase)) return;
  const team = activeTeam();
  if (playStyle(game) === 'teams' && game.mode === 'classic' && !game.special) {
    if (stealSpaces(game.targetScore).some(space => team.score >= space && game.turnStartScore < space)) team.stealNext = true;
  }
  game.lastSummary = buildTurnSummary(game);
  game.turnHistory ||= [];
  game.turnHistory.push(game.lastSummary);
  team.turns++;
  game.word = null;
  game.timer = null;
  game.special = false;
  const cycleComplete = advanceTurn(game);
  const leaders = game.teams.filter(item => item.score === Math.max(...game.teams.map(t => t.score)));
  if (cycleComplete && game.mode === 'custom' && game.scoreMode === 'round') {
    game.roundHistory ||= [];
    game.roundHistory.push({ scores: game.teams.map(item => item.score), winnerIndex: leaders.length === 1 ? game.teams.indexOf(leaders[0]) : null });
    if (game.roundCount && game.roundNumber >= game.roundCount) {
      const wins = roundWins();
      game.phase = wins.filter(value => value === Math.max(...wins)).length > 1 ? 'roundTie' : 'roundFinished';
    } else game.phase = 'roundResult';
  }
  else if (cycleComplete) game.phase = targetOutcome(game);
  else game.phase = 'round';
  game.roles = defaultRoles(activeTeam());
  playSound(['finished', 'roundFinished', 'roundResult'].includes(game.phase) ? 'win' : 'turn');
  await saveGame(game);
  render();
}

async function showHome() {
  pauseGame(game);
  if (game) await saveGame(game);
  view = 'home'; render();
}

async function handleAction(action, button) {
  if (action.startsWith('install-')) return handleInstallAction(action);
  if (action === 'back') return navigation?.back();
  if (action === 'close-dialog') { closeOverlay(); return; }
  if (action === 'open-categories') { root.querySelector('#categories-dialog').showModal(); return; }
  if (action === 'categories-all') { draft.categories = []; draft.category = 'all'; refreshCategoryUi(); return; }
  if (action === 'open-colors') {
    colorTeamIndex = Number(button.dataset.team);
    const team = draft.teams[colorTeamIndex];
    root.querySelector('#colors-title').textContent = `Цвет: ${team.name || `команда ${colorTeamIndex + 1}`}`;
    root.querySelector('#color-options').innerHTML = TEAM_COLORS.map(([name,color], index) => `<button class="color-option" style="--team-color:${color}" data-action="set-color" data-index="${index}" aria-label="${name}" aria-pressed="${teamColor(team,colorTeamIndex) === color}"><span style="background:${color}">${teamColor(team,colorTeamIndex) === color ? '✓' : ''}</span><small>${name}</small></button>`).join('');
    root.querySelector('#colors-dialog').showModal();
    return;
  }
  if (action === 'set-color') {
    const choice = TEAM_COLORS[Number(button.dataset.index)];
    if (!choice || !draft.teams[colorTeamIndex]) return;
    draft.teams[colorTeamIndex].color = choice[1];
    root.querySelector(`[data-action="open-colors"][data-team="${colorTeamIndex}"]`)?.style.setProperty('--team-color', choice[1]);
    closeOverlay(); persistUi(); return;
  }
  if (action === 'open-definition') {
    if (!canReview(game) || view !== 'game') return;
    const word = resolvedReviewWord(button.dataset.word);
    if (!word) return;
    reviewedWord = word;
    root.querySelector('#definition-title').textContent = word.text;
    const meanings = DEFINITIONS[word.family] || [];
    root.querySelector('#definition-body').innerHTML = (meanings.length ? meanings.map(text => `<p>${esc(text)}</p>`).join('') : '<p>Короткое толкование пока не добавлено.</p>') + `<p class="definition-source"><a href="https://ru.wiktionary.org/wiki/${encodeURIComponent(word.text)}" target="_blank" rel="noopener">Викисловарь · источник</a></p><button class="definition-report" data-action="report-definition" aria-pressed="${Boolean(definitionReports[word.family])}">${definitionReports[word.family] ? 'Отмечено · отменить' : 'Непонятное значение'}</button><p class="field-note">Отметки хранятся на этом устройстве.</p>`;
    root.querySelector('#definition-dialog').showModal();
    root.querySelector('#definition-title').focus({preventScroll:true});
    return;
  }
  if (action === 'report-definition') {
    if (!canReview(game) || !reviewedWord || !root.querySelector('#definition-dialog')?.open) return;
    const enabled = !definitionReports[reviewedWord.family];
    await reportDefinition(reviewedWord, enabled);
    if (enabled) definitionReports[reviewedWord.family] = true; else delete definitionReports[reviewedWord.family];
    button.setAttribute('aria-pressed', String(enabled)); button.textContent = enabled ? 'Отмечено · отменить' : 'Непонятное значение';
    showToast(enabled ? 'Толкование отмечено' : 'Отметка отменена'); return;
  }
  if (action === 'home') return showHome();
  if (action === 'new-game') { pauseGame(game); if (game) await saveGame(game); startingConfirmed = false; view = 'setup'; render(); return; }
  if (action === 'resume-game') { closeOverlay(); view = 'game'; if (game.phase === 'countdown') return beginCountdown(game.countdownNext || 'turn'); render(); return; }
  if (action === 'confirm-start') { startingConfirmed = true; return handleAction('start-game', button); }
  if (action === 'set-play-style') { draft.playStyle = ['pairs','versus'].includes(button.dataset.value) ? button.dataset.value : 'teams'; render(); return; }
  if (action === 'add-participant') { if (draft.participants.length < 12) draft.participants.push({id:crypto.randomUUID(),name:''}); render(); return; }
  if (action === 'remove-participant') { if (draft.participants.length > 3) draft.participants.splice(Number(button.dataset.index),1); render(); return; }
  if (action === 'set-mode') { draft.mode = button.dataset.value; render(); return; }
  if (action === 'set-timer-mode') { draft.timerMode = button.dataset.value; render(); return; }
  if (action === 'set-score-mode') { draft.scoreMode = button.dataset.value; render(); return; }
  if (action === 'set-tie-mode') { draft.tieMode = button.dataset.value; render(); return; }
  if (action === 'add-team') {
    if (draft.teams.length < 6) draft.teams.push({ id: crypto.randomUUID(), name: `Команда ${draft.teams.length + 1}`, players: ['', ''] });
    render(); return;
  }
  if (action === 'remove-team') { draft.teams.splice(Number(button.dataset.team), 1); render(); return; }
  if (action === 'add-player') { draft.teams[Number(button.dataset.team)].players.push(''); render(); return; }
  if (action === 'remove-player') { draft.teams[Number(button.dataset.team)].players.splice(Number(button.dataset.player), 1); render(); return; }
  if (action === 'start-game') {
    const error = validateDraft();
    if (error) { root.querySelector('#setup-error').innerHTML = `<div class="error-box">${esc(error)}</div>`; return; }
    if (game && !['finished','roundFinished','drawFinished'].includes(game.phase) && !startingConfirmed) { root.querySelector('#new-game-dialog').showModal(); return; }
    startingConfirmed = false;
    game = {
      ...structuredClone(draft),
      categories: selectedCategories(draft), tieMode: draft.mode === 'classic' ? 'sudden' : draft.tieMode,
      teams: entrants(draft).map((team,index) => ({ ...structuredClone(team), color: teamColor(team,index), score: 0, turns: 0, stealNext: false, explainerStart: randomExplainer(team) })),
      activeTeam: Math.floor(Math.random() * entrants(draft).length), phase: 'handoff', roles: null, roundNumber: 1, roundHistory: [],
      actions: [], word: null, timer: null, special: false, specialPlayed: 0, turnHistory: [], classicCategoryEnabled: true,
      createdAt: new Date().toISOString()
    };
    if (playStyle(game) === 'pairs') { game.pairSchedule = makePairSchedule(game.teams.length); game.pairIndex = 0; game.activeTeam = game.pairSchedule[0][1]; }
    game.roundStartTeam = game.activeTeam;
    game.roles = defaultRoles(activeTeam());
    view = 'game'; await saveGame(game); render(); return;
  }
  if (action === 'start-turn' && game.phase === 'handoff') return beginCountdown();
  if (action === 'start-tiebreak' && ['roundTie','gameTie'].includes(game.phase)) {
    game.suddenContenders = tieContenders(game); game.phase = 'suddenHandoff'; await saveGame(game); render(); return;
  }
  if (action === 'start-sudden' && game.phase === 'suddenHandoff') return beginCountdown('sudden');
  if (action === 'skip-sudden' && game.phase === 'suddenWord') return reserveSuddenWord();
  if (action === 'sudden-answer' && game.phase === 'suddenWord') {
    const index = Number(button.dataset.index);
    if (!game.suddenContenders.includes(index)) return;
    if (game.decidingWords?.at(-1)) game.decidingWords.at(-1).status = 'guessed';
    game.tiebreak = { winnerIndex: index, word: game.word.text };
    const roundMode = game.mode === 'custom' && game.scoreMode === 'round';
    if (!roundMode) game.teams[index].score++;
    game.word = null; game.phase = roundMode ? 'roundFinished' : 'finished';
    await saveGame(game); playSound('win'); render(); return;
  }
  if (action === 'extra-target' && game.phase === 'gameTie') {
    game.extraCycles = (game.extraCycles || 0) + 1;
    nextCycle(game); game.roles = defaultRoles(activeTeam()); game.phase = 'handoff';
    await saveGame(game); render(); return;
  }
  if (action === 'correct' || action === 'skip') return answer(action);
  if (action === 'special-answer') return specialAnswer(Number(button.dataset.index));
  if (action === 'last-word') {
    if (game?.phase !== 'lastWord') return;
    const index = Number(button.dataset.index);
    if (!Number.isInteger(index) || (index !== -1 && !lastGuessers(game).includes(index))) return;
    game.lastWordResult = { word: game.word?.text || '', teamIndex: index >= 0 ? index : null };
    if (index >= 0) recordScore(index, 1, 'last', `${game.teams[index].name} перехватила +1`);
    return finishTurn();
  }
  if (action === 'end-turn') return finishTurn();
  if (action === 'next-turn') { game.phase = 'handoff'; await saveGame(game); render(); return; }
  if (action === 'new-round' && ['roundResult', 'roundTie'].includes(game.phase)) {
    if (game.phase === 'roundTie' && poolForTurn().filter(word => !seen.has(word.family)).length < game.teams.length) return;
    game.roundNumber = (game.roundNumber || 1) + 1;
    game.teams.forEach(team => { team.score = 0; });
    nextCycle(game); game.roles = defaultRoles(activeTeam()); game.phase = 'handoff';
    game.lastSummary = null;
    await saveGame(game); render(); return;
  }
  if (action === 'finish-draw' && ['roundTie','gameTie','tieEmpty'].includes(game.phase)) {
    game.phase = game.mode === 'custom' && game.scoreMode === 'round' ? 'roundFinished' : 'drawFinished';
    game.drawAccepted = true;
    await saveGame(game); render(); return;
  }
  if (action === 'pause-timer') {
    game.timer.remainingMs = timerLeft(); game.timer.paused = true; game.timer.deadline = null;
    await saveGame(game); render(); return;
  }
  if (action === 'resume-timer') {
    game.timer.deadline = Date.now() + game.timer.remainingMs; game.timer.paused = false;
    await saveGame(game); render(); return;
  }
  if (action === 'undo') {
    const previous = game.actions.pop();
    if (!previous) return;
    const review = game.turnWords?.find(word => word.text === previous.word);
    if (review) review.status = 'unanswered';
    undoScore(game,previous);
    if (previous.type === 'correct') game.turnStats.correct--;
    if (previous.type === 'skip') game.turnStats.skipped--;
    if (previous.type === 'mistake') game.turnStats.mistakes--;
    await saveGame(game); render(); showToast('Начисление отменено'); return;
  }
  if (action === 'export-history') {
    const records = await exportSeen();
    const blob = new Blob([JSON.stringify({ format: 'svoyi-slova-history-v1', records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `alias-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('История слов сохранена'); return;
  }
  if (action === 'import-history') { root.querySelector('#history-file')?.click(); return; }
}

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  unlockAudio();
  if (['toggle-theme', 'toggle-sound'].includes(button.dataset.action)) { togglePreference(button.dataset.action); return; }
  const sound = button.dataset.action === 'correct' ? 'correct' : button.dataset.action === 'skip' ? 'skip' : 'tap';
  if (!['start-turn', 'end-turn', 'last-word'].includes(button.dataset.action)) playSound(sound);
  run(() => handleAction(button.dataset.action, button));
});

root.addEventListener('input', event => {
  const input = event.target;
  const field = input.dataset.field;
  if (field === 'team-name') draft.teams[Number(input.dataset.team)].name = input.value;
  else if (field === 'participant-name') draft.participants[Number(input.dataset.index)].name = input.value;
  else if (field === 'player') draft.teams[Number(input.dataset.team)].players[Number(input.dataset.player)] = input.value;
  else {
    const fields = { 'target-score': 'targetScore', 'round-count': 'roundCount', 'round-seconds': 'roundSeconds', 'word-seconds': 'wordSeconds' };
    if (!fields[field] || input.value === '' || !Number.isFinite(Number(input.value))) return;
    draft[fields[field]] = Number(input.value);
  }
  const summary = root.querySelector('#setup-summary-values');
  if (view === 'setup' && summary) summary.innerHTML = setupSummaryDetails();
  persistUi();
});

root.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'history-file') {
    run(async () => {
      const file = input.files?.[0]; if (!file) return;
      const contents = JSON.parse(await file.text());
      if (contents.format !== 'svoyi-slova-history-v1') throw new Error('Это не история слов игры');
      await importSeen(contents.records);
      seen = await getSeen(); render(); showToast('История слов восстановлена');
    });
    return;
  }
  const field = input.dataset.field;
  if (!field) return;
  if (field === 'category-multi') {
    const selected = new Set(selectedCategories(draft));
    if (input.checked) selected.add(input.value); else selected.delete(input.value);
    draft.categories = [...selected];
    draft.category = selected.size === 1 ? [...selected][0] : 'all';
    refreshCategoryUi(); return;
  }
  if (field === 'team-name') draft.teams[Number(input.dataset.team)].name = input.value;
  if (field === 'player') draft.teams[Number(input.dataset.team)].players[Number(input.dataset.player)] = input.value;
  if (field === 'target-score') draft.targetScore = clamp(input.value, 5, 200);
  if (field === 'round-count') draft.roundCount = clamp(input.value, 2, 20);
  if (field === 'round-seconds') draft.roundSeconds = clamp(input.value, 10, 600);
  if (field === 'word-seconds') draft.wordSeconds = clamp(input.value, 10, 600);
  if (field === 'category') draft.category = input.value;
  if (field === 'difficulty') draft.difficulty = input.value;
  if (field === 'skip-penalty') draft.skipPenalty = Number(input.value);
  const numericFields = { 'target-score': 'targetScore', 'round-count': 'roundCount', 'round-seconds': 'roundSeconds', 'word-seconds': 'wordSeconds' };
  if (numericFields[field]) input.value = draft[numericFields[field]];
  if (view === 'setup' && ['category', 'difficulty', 'skip-penalty'].includes(field)) {
    const summary = root.querySelector('#setup-summary-values');
    if (summary) summary.innerHTML = setupSummaryDetails();
  }
  persistUi();
});

setInterval(() => {
  if (view === 'game' && game?.phase === 'countdown') {
    if (document.hidden) return;
    const value = Math.max(0, Math.ceil((game.countdownEndsAt - Date.now() - 400) / 1000));
    if (value !== game.countdownValue) {
      game.countdownValue = value;
      const node = root.querySelector('#countdown-value');
      if (node) { node.textContent = value || 'Начали!'; node.classList.toggle('go', !value); node.classList.remove('countdown-pop'); void node.offsetWidth; node.classList.add('countdown-pop'); }
      playSound(value ? 'tick' : 'go');
    }
    if (Date.now() >= game.countdownEndsAt) run(startTurn);
    return;
  }
  if (view !== 'game' || game?.phase !== 'playing' || !game.timer || game.timer.paused) return;
  updateTimer();
  if (Date.now() - lastCheckpointAt >= 1000) persistCheckpoint();
  if (timerLeft() <= 0) run(timeout);
}, 120);

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAndPersist(); else if (ready) render(); });
window.addEventListener('pagehide', pauseAndPersist);
window.addEventListener('pageshow', event => { if (event.persisted && ready) render(); });

async function init() {
  try {
    const [savedSeen, savedGame, savedUi, savedReports] = await Promise.all([getSeen(), getGame(), getSession(), getDefinitionReports()]);
    definitionReports = savedReports;
    seen = savedSeen;
    const backup = readCheckpoint();
    const ui = backup && (!savedUi || backup.savedAt >= savedUi.savedAt) ? backup : savedUi;
    if (ui?.draft && Array.isArray(ui.draft.teams) && ui.draft.teams.length >= 2 && ui.draft.teams.length <= 6) {
      draft = { ...draft, ...ui.draft, teams: ui.draft.teams.map((team,index) => ({ id: team.id || crypto.randomUUID(), name: String(team.name || ''), players: Array.isArray(team.players) ? team.players.map(String) : ['', ''], color: teamColor(team,index) })) };
      draft.playStyle = playStyle(draft);
      if (!Array.isArray(draft.participants) || draft.participants.length < 3) draft.participants = [{id:'person-a',name:'Аня'},{id:'person-b',name:'Паша'},{id:'person-c',name:'Маша'}];
      draft.categories = selectedCategories(ui.draft).filter(id => PACKS.some(pack => pack.id === id));
      draft.tieMode = draft.tieMode === 'sudden' ? 'sudden' : 'round';
    }
    game = backup && backup.savedAt >= (savedGame?.updatedAt || 0) ? backup.game : savedGame;
    view = ['home','setup','game'].includes(ui?.view) ? ui.view : game && !['finished','roundFinished','drawFinished'].includes(game.phase) ? 'game' : 'home';
    if (view === 'game' && !game) view = 'home';
    restoreGame(game);
    if (game && ['playing','lastWord'].includes(game.phase) && !game.turnWords) game.turnWords = turnWords(game);
    if (game) game.tieMode ||= game.mode === 'classic' ? 'sudden' : 'round';
    if (game && ['playing','suddenWord'].includes(game.phase) && (!game.word || game.pendingWord)) {
      const { word } = await reserveWord(poolForTurn());
      game.word = word; game.pendingWord = false;
      if (word) seen.add(word.family); else game.phase = game.phase === 'suddenWord' ? 'tieEmpty' : 'empty';
      await saveGame(game);
    }
    if (game?.lastSummary && !game.lastSummary.allocations && ['round', 'roundResult', 'roundTie', 'roundFinished', 'finished'].includes(game.phase)) {
      const teamIndex = Math.max(0, game.teams.findIndex(team => team.name === game.lastSummary.teamName));
      game.lastSummary = buildTurnSummary({ ...game, special: game.lastSummary.special }, teamIndex);
      game.turnHistory ||= [game.lastSummary];
      await saveGame(game);
    }
    if (game?.mode === 'classic' && !game.classicCategoryEnabled) {
      game.category = 'all';
      game.classicCategoryEnabled = true;
      await saveGame(game);
    }
    if (game && game.roundStartTeam == null) {
      game.roundStartTeam = 0;
      await saveGame(game);
    }
    if (game?.mode === 'custom' && game.scoreMode === 'round' && game.phase === 'roundFinished' && !game.drawAccepted && !game.tiebreak) {
      const wins = roundWins();
      if (wins.filter(value => value === Math.max(...wins)).length > 1) {
        game.phase = 'roundTie';
        await saveGame(game);
      }
    }
    if (game?.teams.some(team => team.explainerStart == null)) {
      // Старые партии уже шли по порядку от первого участника: сохраняем этот круг без повторов.
      game.teams.forEach(team => { if (team.explainerStart == null) team.explainerStart = 0; });
      if (game.phase === 'handoff' || game.phase === 'round' || game.phase === 'roundResult') game.roles = defaultRoles(activeTeam());
      await saveGame(game);
    }
    ready = true;
    navigation = createNavigation(view, next => {
      if (view === 'game' && next !== 'game') { pauseGame(game); if (game) storeGame(game).catch(console.warn); }
      view = next === 'game' && !game ? 'setup' : next;
      render();
    }, closeOverlay, () => showToast('Вы на главном экране'));
    render();
    requestPersistentStorage();
    initPwa(() => {
      const panel = root.querySelector('#install-panel');
      if (view === 'home' && panel && !document.querySelector('#install-dialog')?.open) panel.innerHTML = renderInstallHint();
    });
  } catch (error) {
    console.error(error);
    root.innerHTML = `${header()}<div class="panel"><h1>Не удалось открыть память игры</h1><p>Проверьте, что браузер разрешает хранить данные сайта, и перезагрузите страницу.</p></div>`;
  }
}

init();
