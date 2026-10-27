import { PACKS, WORDS } from './words.js';
import { getSeen, reserveWord, getGame, saveGame, removeGame, exportSeen, importSeen, requestPersistentStorage } from './storage.js';

const root = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const colors = ['#d9ff69', '#ff816b', '#80b7ff', '#b9a0ff', '#ffc77b', '#7be2d0'];
const allFamilies = new Set(WORDS.map(word => word.family));
const stealSpaces = target => [0.25, 0.5, 0.75].map(factor => Math.round(target * factor)).filter((value, index, list) => value > 0 && value < target && list.indexOf(value) === index);

let seen = new Set();
let game = null;
let view = 'home';
let busy = false;
let toastTimer;
let draft = {
  mode: 'classic', timerMode: 'round', roundSeconds: 120, wordSeconds: 30,
  scoreMode: 'round', targetScore: 30, category: 'all', difficulty: 'mixed', skipPenalty: 0,
  teams: [
    { id: 'team-a', name: 'Команда 1', players: ['Аня', 'Паша'] },
    { id: 'team-b', name: 'Команда 2', players: ['Маша', 'Илья'] }
  ]
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || low));
const activeTeam = () => game.teams[game.activeTeam];
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
    <a class="brand" href="#" data-action="home" aria-label="Alias — на главную"><span class="brand-mark">✦</span><span>Alias</span></a>
    <div class="top-actions">
    ${view !== 'home' ? '<button class="icon-button" type="button" data-action="home" aria-label="На главную">⌂</button>' : ''}</div>
  </header>`;
}

function renderHome() {
  const resume = game && game.phase !== 'finished';
  return `${header()}<main class="home-hero">
    <section class="home-copy"><div class="eyebrow">Игра для друзей</div>
      <h1>Сыграем <em>в Alias?</em></h1>
      <div class="hero-actions"><button class="button button-primary button-large" data-action="new-game">Начать игру <span aria-hidden="true">↗</span></button>
      ${resume ? '<button class="button button-secondary button-large" data-action="resume-game">Продолжить партию</button>' : ''}</div>
    </section>
  </main>`;
}

function teamFields() {
  return draft.teams.map((team, teamIndex) => `<div class="team-card">
    <div class="team-top"><span class="team-color" style="background:${colors[teamIndex % colors.length]}"></span>
      <input class="team-name" aria-label="Название команды ${teamIndex + 1}" data-field="team-name" data-team="${teamIndex}" value="${esc(team.name)}" maxlength="30">
      ${draft.teams.length > 2 ? `<button class="remove-button" data-action="remove-team" data-team="${teamIndex}" aria-label="Удалить команду">×</button>` : ''}</div>
    <div class="players">${team.players.map((player, playerIndex) => `<div class="player-row"><input class="player-input" aria-label="Игрок ${playerIndex + 1} команды ${teamIndex + 1}" data-field="player" data-team="${teamIndex}" data-player="${playerIndex}" value="${esc(player)}" maxlength="24">
      <button class="remove-button" data-action="remove-player" data-team="${teamIndex}" data-player="${playerIndex}" aria-label="Удалить игрока" ${team.players.length <= 2 ? 'disabled' : ''}>×</button></div>`).join('')}</div>
    <button class="link-button" data-action="add-player" data-team="${teamIndex}">+ Добавить участника</button>
  </div>`).join('');
}

function setupSummary() {
  const mode = draft.mode === 'classic' ? 'Классический' : 'Кастом';
  const roundScoring = draft.mode === 'custom' && draft.scoreMode === 'round';
  const timer = draft.mode === 'classic' ? '01:00 на все слова команды' : draft.timerMode === 'round' ? `${formatTime(draft.roundSeconds * 1000)} на все слова команды` : `${formatTime(draft.wordSeconds * 1000)} на каждое слово`;
  const selectedWords = WORDS.filter(word => draft.mode === 'classic' || (draft.category === 'all' || word.category === draft.category) && (draft.difficulty === 'mixed' || word.difficulty === draft.difficulty));
  const pool = selectedWords.filter(word => !seen.has(word.family));
  return `<aside class="panel setup-summary"><h3 style="margin-bottom:14px">Настройки игры</h3>
    <div class="summary-rule"><span>Режим</span><strong>${mode}</strong></div>
    <div class="summary-rule"><span>Команды</span><strong>${draft.teams.length}</strong></div>
    <div class="summary-rule"><span>Таймер</span><strong>${esc(timer)}</strong></div>
    <div class="summary-rule"><span>Победа</span><strong>${roundScoring ? 'больше очков за раунд' : `до ${draft.targetScore} очков`}</strong></div>
    <div class="summary-rule"><span>Не показано слов</span><strong>${pool.length}</strong></div>
    <div class="remaining-bar"><i style="width:${selectedWords.length ? pool.length / selectedWords.length * 100 : 0}%"></i></div>
    <p class="field-note">Слова берутся из встроенного набора. Счётчик показывает, сколько ещё не встречалось в выбранной теме и сложности.</p>
    <div class="setup-footer"><button class="button button-primary button-full button-large" data-action="start-game">Начать партию ↗</button><div id="setup-error"></div></div>
    <details class="history-panel"><summary>История слов</summary><p class="field-note">Сайт запоминает показанные слова в этом браузере, чтобы не выдать их снова в другой партии. Скачайте историю, если хотите перенести её на другой телефон или сохранить перед очисткой браузера. Загрузка добавит использованные слова, но не перенесёт текущую партию.</p><div class="settings-tools"><button class="button button-ghost button-small" data-action="export-history">Скачать историю</button>
      <button class="button button-ghost button-small" data-action="import-history">Загрузить историю</button><input type="file" id="history-file" accept="application/json,.json"></div></details>
  </aside>`;
}

function renderSetup() {
  return `${header()}<main><div class="section-head"><div><div class="eyebrow">Настройка партии</div><h1>Соберите команду.</h1><p>Несколько решений — и можно играть.</p></div></div>
    <div class="setup-grid"><div class="stack">
      <section class="panel"><div class="panel-head"><h3><span class="step">1</span> Правила</h3></div>
        <div class="mode-grid"><button class="mode-card ${draft.mode === 'classic' ? 'active' : ''}" data-action="set-mode" data-value="classic"><span class="mode-icon">⌛</span><strong>Классический</strong><small>1 минута на все слова команды. Очки копятся до финиша.</small></button>
        <button class="mode-card ${draft.mode === 'custom' ? 'active' : ''}" data-action="set-mode" data-value="custom"><span class="mode-icon">⚡</span><strong>Кастом</strong><small>Свои настройки времени, темы и подсчёта очков.</small></button></div>
      </section>
      <section class="panel"><div class="panel-head"><h3><span class="step">2</span> Участники</h3><span class="mini-pill">от 2 на команду</span></div>
        <div class="team-grid">${teamFields()}</div><button class="link-button" data-action="add-team" ${draft.teams.length >= 6 ? 'disabled' : ''}>+ Добавить команду</button>
      </section>
      <section class="panel"><div class="panel-head"><h3><span class="step">3</span> Темп игры</h3></div>
        ${draft.mode === 'custom' ? `<div class="field" style="margin-bottom:16px"><span>Таймер</span><div class="segmented">
          <button class="${draft.timerMode === 'round' ? 'active' : ''}" data-action="set-timer-mode" data-value="round">На все слова команды</button>
          <button class="${draft.timerMode === 'word' ? 'active' : ''}" data-action="set-timer-mode" data-value="word">На каждое слово</button></div></div>
          <div class="field" style="margin-bottom:16px"><span>Как определить победителя</span><div class="segmented">
          <button class="${draft.scoreMode === 'round' ? 'active' : ''}" data-action="set-score-mode" data-value="round">По итогам раунда</button>
          <button class="${draft.scoreMode === 'target' ? 'active' : ''}" data-action="set-score-mode" data-value="target">До нужных очков</button></div></div>` : '<p class="field-note">У каждой команды 1 минута, чтобы угадать как можно больше слов. Очки суммируются до финиша.</p>'}
        <div class="field-grid">${draft.mode === 'classic' || draft.scoreMode === 'target' ? `<label class="field"><span>Игра до очков</span><input type="number" min="5" max="200" data-field="target-score" value="${draft.targetScore}"></label>` : ''}
        ${draft.mode === 'custom' ? `<label class="field"><span>${draft.timerMode === 'round' ? 'Секунд на все слова команды' : 'Секунд на каждое слово'}</span><input type="number" min="10" max="600" data-field="${draft.timerMode === 'round' ? 'round-seconds' : 'word-seconds'}" value="${draft.timerMode === 'round' ? draft.roundSeconds : draft.wordSeconds}"></label>` : ''}
        ${draft.mode === 'custom' ? `<label class="field"><span>Тема</span><select data-field="category"><option value="all" ${draft.category === 'all' ? 'selected' : ''}>Все темы</option>${PACKS.map(pack => `<option value="${pack.id}" ${draft.category === pack.id ? 'selected' : ''}>${pack.emoji} ${pack.name}</option>`).join('')}</select></label>
        <label class="field"><span>Сложность</span><select data-field="difficulty"><option value="mixed" ${draft.difficulty === 'mixed' ? 'selected' : ''}>Смешанная</option><option value="easy" ${draft.difficulty === 'easy' ? 'selected' : ''}>Лёгкая</option><option value="medium" ${draft.difficulty === 'medium' ? 'selected' : ''}>Средняя</option><option value="hard" ${draft.difficulty === 'hard' ? 'selected' : ''}>Сложная</option></select></label>
        <label class="field"><span>Штраф за пропуск</span><select data-field="skip-penalty"><option value="0" ${draft.skipPenalty === 0 ? 'selected' : ''}>Без штрафа</option><option value="1" ${draft.skipPenalty === 1 ? 'selected' : ''}>−1 очко</option></select></label>` : ''}</div>
      </section>
    </div>${setupSummary()}</div></main>`;
}

function renderScores() {
  return `<div class="score-strip" aria-label="${game.mode === 'custom' && game.scoreMode === 'round' ? 'Очки в этом раунде' : 'Счёт команд'}">${game.teams.map((team, index) => `<div class="score-item ${index === game.activeTeam ? 'active' : ''}"><span><i class="status-dot" style="display:inline-block;background:${colors[index % colors.length]};box-shadow:none;margin-right:6px"></i>${esc(team.name)}</span><strong>${team.score}</strong></div>`).join('')}</div>`;
}

function gameHeader() {
  const roundScoring = game.mode === 'custom' && game.scoreMode === 'round';
  return `${header()}<div class="game-top"><div class="game-kicker"><span>${roundScoring ? `РАУНД ${game.roundNumber || 1}` : 'ПАРТИЯ'}</span><span>→</span><b>${game.mode === 'classic' ? 'Классический' : 'Кастом'}</b></div><span class="mini-pill">${roundScoring ? 'Очки за раунд' : `Финиш: ${game.targetScore}`}</span></div>${renderScores()}`;
}

function roleNames() {
  const team = activeTeam();
  return { explainer: team.players[game.roles.explainer] };
}

function renderHandoff() {
  const team = activeTeam();
  const { explainer } = roleNames();
  const special = game.mode === 'classic' && team.stealNext;
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">${game.mode === 'custom' && game.scoreMode === 'round' ? `Раунд ${game.roundNumber || 1}` : `Ход ${team.turns + 1}`} · ${esc(team.name)}</div>
    <div class="turn-emoji">${special ? '⚡' : '🎤'}</div><h1>${special ? 'Ход перехвата!' : 'Ваша очередь!'}</h1>
    <p>${special ? 'Пять слов без таймера. Угадывать могут все команды.' : 'Передайте телефон объясняющему. Слово появится после старта.'}</p>
    <div class="pair-line">${esc(explainer)} <span class="pair-arrow">→</span> вся команда</div>
    <button class="button button-primary button-large button-full" data-action="start-turn">Показать слово →</button></div></main>`;
}

function renderTimer() {
  if (game.special) return `<div class="timer-line"><span class="timer-label">⚡ Ход перехвата</span><span class="timer-value">${game.specialPlayed}/5</span></div>`;
  return `<div class="timer-line"><span class="timer-label">◷ ${game.mode === 'custom' && game.timerMode === 'word' ? 'На это слово' : 'На все слова команды'}</span><span class="timer-value" id="timer-value">${formatTime(timerLeft())}</span></div>
    <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>`;
}

function renderPlaying() {
  const word = game.word;
  const team = activeTeam();
  if (!word) return renderEmpty();
  const lastAction = game.actions.at(-1);
  return `${gameHeader()}<main class="game-frame"><div class="turn-card">
    ${renderTimer()}
    <div class="word-card ${game.timer?.paused ? 'paused-word' : ''}" id="word-card"><span class="word-hint">Объясни это слово</span><strong>${esc(word.text)}</strong>
      <div class="word-meta"><span>${word.emoji} ${esc(word.categoryName)}</span><span>${esc(word.difficultyName)}</span>${game.mode === 'classic' ? `<span>№ ${game.slot}</span>` : ''}</div></div>
    ${game.timer?.paused ? `<button class="button button-primary button-full button-large" style="margin-top:17px" data-action="resume-timer">▶ Продолжить</button>` : game.special ?
      `<p class="field-note">Кто первым угадал это слово?</p><div class="winner-grid">${game.teams.map((item, index) => `<button class="button button-secondary" data-action="special-answer" data-index="${index}">${esc(item.name)} +1</button>`).join('')}<button class="button button-ghost" data-action="special-answer" data-index="-1">Никто</button></div>` :
      `<div class="action-grid"><button class="button button-secondary" data-action="skip">Пропустить ${game.mode === 'classic' || game.skipPenalty ? '−1' : ''}</button><button class="button button-coral" data-action="correct">Угадали +1 ↗</button></div>`}
    <div class="sub-actions">${game.timer?.paused ? '' : `<button data-action="${game.timer ? 'pause-timer' : 'end-turn'}">${game.timer ? 'Ⅱ Пауза' : 'Завершить ход'}</button>`}
      ${game.mode === 'classic' && !game.special && !game.timer?.paused ? '<button data-action="mistake">Ошибка −1</button>' : ''}
      <button data-action="undo" ${lastAction ? '' : 'disabled'}>↶ Отменить очки</button>
      ${game.timer && !game.timer?.paused ? '<button data-action="end-turn">Завершить ход</button>' : ''}</div>
    <div class="answer-log">${lastAction ? `Последнее действие: <b>${esc(lastAction.label)}</b>. Слово уже показано и не вернётся в колоду.` : 'Карточка засчитывается использованной сразу после показа.'}</div>
  </div></main>`;
}

function renderLastWord() {
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">Время вышло</div><div class="turn-emoji">⏱️</div><h1>Последнее слово</h1>
    <p>Если объяснение уже началось, угадывать могут все команды. Кто ответил первым?</p>
    <div class="winner-grid">${game.teams.map((team, index) => `<button class="button button-secondary" data-action="last-word" data-index="${index}">${esc(team.name)} +1</button>`).join('')}
    <button class="button button-ghost" data-action="last-word" data-index="-1">Никто не угадал</button></div></div></main>`;
}

function renderRound() {
  const summary = game.lastSummary;
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="eyebrow">Ход завершён</div><div class="turn-emoji">👏</div><h1>${esc(summary.teamName)}</h1>
    <p>${summary.special ? 'Все команды проверили скорость реакции.' : 'Отличная работа! Вот результат хода.'}</p>
    <div class="turn-results"><div class="turn-result"><strong>+${summary.correct}</strong><small>угадали</small></div><div class="turn-result"><strong>${summary.skipped}</strong><small>пропущено</small></div><div class="turn-result"><strong>${summary.net >= 0 ? '+' : ''}${summary.net}</strong><small>очков за ход</small></div></div>
    <p class="fine-print">Следующая: ${esc(activeTeam().name)}. ${game.mode === 'classic' && activeTeam().stealNext ? 'Для этой команды готов ход перехвата.' : ''}</p>
    <button class="button button-primary button-large button-full" data-action="next-turn">Передать ход →</button></div></main>`;
}

function renderRoundResult() {
  const best = Math.max(...game.teams.map(team => team.score));
  const winners = game.teams.filter(team => team.score === best);
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="finish-trophy">★</div><div class="eyebrow">Раунд ${game.roundNumber || 1} завершён</div>
    <h1>${winners.length === 1 ? `${esc(winners[0].name)} выиграла раунд!` : 'Ничья в раунде!'}</h1>
    <p>${game.teams.map(team => `${esc(team.name)} — ${team.score} ${team.score % 10 === 1 && team.score % 100 !== 11 ? 'очко' : [2, 3, 4].includes(team.score % 10) && ![12, 13, 14].includes(team.score % 100) ? 'очка' : 'очков'}`).join(' · ')}</p>
    <p class="fine-print">Победитель определяется только по очкам этого раунда. В следующем счёт начнётся с нуля.</p>
    <div class="game-actions"><button class="button button-primary button-large" data-action="new-round">Следующий раунд ↗</button><button class="button button-secondary button-large" data-action="new-game">Новая игра</button></div></div></main>`;
}

function renderFinished() {
  const winner = game.teams.reduce((best, team) => team.score > best.score ? team : best, game.teams[0]);
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="finish-trophy">★</div><div class="eyebrow">Партия завершена</div>
    <h1>Победа у ${esc(winner.name)}!</h1><p>Вы набрали ${winner.score} очков. Сыграем ещё? Новая партия начнётся с новых слов.</p>
    <div class="game-actions"><button class="button button-primary button-large" data-action="new-game">Новая партия ↗</button><button class="button button-secondary button-large" data-action="home">На главную</button></div></div></main>`;
}

function renderEmpty() {
  return `${gameHeader()}<main class="game-frame"><div class="turn-card center"><div class="turn-emoji">📚</div><h1>Новые слова закончились</h1>
    <p>В выбранном наборе больше нет непоказанных слов. Повторять старые карточки мы не будем. Попробуйте другую тему или сложность в новой партии.</p>
    <div class="game-actions"><button class="button button-primary" data-action="end-turn">Завершить ход</button><button class="button button-secondary" data-action="new-game">Новая настройка</button></div></div></main>`;
}

function render() {
  root.innerHTML = view === 'home' ? renderHome() : view === 'setup' ? renderSetup() : game ? (
    game.phase === 'handoff' ? renderHandoff() : game.phase === 'playing' ? renderPlaying() :
    game.phase === 'lastWord' ? renderLastWord() : game.phase === 'round' ? renderRound() : game.phase === 'roundResult' ? renderRoundResult() :
    game.phase === 'finished' ? renderFinished() : renderEmpty()
  ) : renderHome();
  updateTimer();
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
  if (draft.teams.length < 2 || draft.teams.some(team => team.players.length < 2)) return 'Нужно минимум две команды и по два участника в каждой.';
  const names = draft.teams.flatMap(team => team.players.map(name => name.trim().toLocaleLowerCase('ru')));
  if (draft.teams.some(team => !team.name.trim()) || names.some(name => !name)) return 'Заполните названия команд и имена участников.';
  if (new Set(names).size !== names.length) return 'Участников с одинаковыми именами будет сложно различать. Переименуйте их.';
  if (new Set(draft.teams.map(team => team.name.trim().toLocaleLowerCase('ru'))).size !== draft.teams.length) return 'Названия команд должны различаться.';
  if ((draft.mode === 'classic' || draft.scoreMode === 'target') && (draft.targetScore < 5 || draft.targetScore > 200)) return 'Цель по очкам должна быть от 5 до 200.';
  if (draft.mode === 'custom' && (draft.timerMode === 'round' ? draft.roundSeconds : draft.wordSeconds) < 10) return 'Минимальное время — 10 секунд.';
  const pool = WORDS.filter(word => !seen.has(word.family) && (draft.mode === 'classic' || (draft.category === 'all' || word.category === draft.category) && (draft.difficulty === 'mixed' || word.difficulty === draft.difficulty)));
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
  if (game.mode === 'classic') return WORDS;
  return WORDS.filter(word => (game.category === 'all' || word.category === game.category) && (game.difficulty === 'mixed' || word.difficulty === game.difficulty));
}

async function nextWord() {
  const { word } = await reserveWord(poolForTurn());
  game.word = word;
  if (!word) { game.phase = 'empty'; game.timer = null; }
  else if (game.mode === 'custom' && game.timerMode === 'word') {
    game.timer.remainingMs = game.timer.durationMs;
    game.timer.deadline = Date.now() + game.timer.durationMs;
  }
  if (word) seen.add(word.family);
  await saveGame(game);
  render();
}

async function startTurn() {
  const team = activeTeam();
  game.special = game.mode === 'classic' && team.stealNext;
  team.stealNext = false;
  game.slot = (team.score % 8) + 1;
  game.turnStartScore = team.score;
  game.turnStats = { correct: 0, skipped: 0, mistakes: 0 };
  game.specialPlayed = 0;
  game.actions = [];
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
  const previousScore = team.score;
  team.score = Math.max(0, team.score + delta);
  game.actions.push({ teamIndex, previousScore, type, label, word: game.word?.text || '' });
  if (type === 'correct') game.turnStats.correct++;
  if (type === 'skip') game.turnStats.skipped++;
  if (type === 'mistake') game.turnStats.mistakes++;
}

async function answer(type) {
  if (game.phase !== 'playing' || game.timer?.paused || game.special) return;
  if (timerLeft() <= 0) { await timeout(); return; }
  const delta = type === 'correct' ? 1 : type === 'skip' ? (game.mode === 'classic' ? -1 : -game.skipPenalty) : -1;
  recordScore(game.activeTeam, delta, type, type === 'correct' ? 'Угадали +1' : type === 'skip' ? `Пропуск ${delta || '0'}` : 'Ошибка −1');
  await nextWord();
}

async function specialAnswer(index) {
  if (game.phase !== 'playing' || !game.special) return;
  if (index >= 0) recordScore(index, 1, 'special', `${game.teams[index].name} +1`);
  game.specialPlayed++;
  if (game.specialPlayed >= 5) await finishTurn(); else await nextWord();
}

async function timeout() {
  if (game.phase !== 'playing' || game.special || game.timer?.paused || timerLeft() > 0) return;
  game.timer.deadline = Date.now();
  game.timer.remainingMs = 0;
  if (game.mode === 'classic') {
    game.phase = 'lastWord';
    await saveGame(game);
    render();
  } else await finishTurn();
}

async function finishTurn() {
  if (!game || !['playing', 'lastWord', 'empty'].includes(game.phase)) return;
  const team = activeTeam();
  if (game.mode === 'classic' && !game.special) {
    if (stealSpaces(game.targetScore).some(space => team.score >= space && game.turnStartScore < space)) team.stealNext = true;
  }
  game.lastSummary = {
    teamName: team.name,
    correct: game.turnStats.correct,
    skipped: game.turnStats.skipped,
    net: team.score - game.turnStartScore,
    special: game.special
  };
  team.turns++;
  game.word = null;
  game.timer = null;
  game.special = false;
  game.activeTeam = (game.activeTeam + 1) % game.teams.length;
  const leaders = game.teams.filter(item => item.score === Math.max(...game.teams.map(t => t.score)));
  if (game.activeTeam === 0 && game.mode === 'custom' && game.scoreMode === 'round') game.phase = 'roundResult';
  else if (game.activeTeam === 0 && leaders.length === 1 && leaders[0].score >= game.targetScore) game.phase = 'finished';
  else game.phase = 'round';
  game.roles = defaultRoles(activeTeam());
  await saveGame(game);
  render();
}

async function showHome() {
  if (game?.phase === 'playing' && game.timer && !game.timer.paused) {
    game.timer.remainingMs = timerLeft();
    game.timer.paused = true;
    game.timer.deadline = null;
    await saveGame(game);
  }
  view = 'home'; render();
}

async function handleAction(action, button) {
  if (action === 'home') return showHome();
  if (action === 'new-game') { view = 'setup'; render(); return; }
  if (action === 'resume-game') { view = 'game'; render(); return; }
  if (action === 'set-mode') { draft.mode = button.dataset.value; render(); return; }
  if (action === 'set-timer-mode') { draft.timerMode = button.dataset.value; render(); return; }
  if (action === 'set-score-mode') { draft.scoreMode = button.dataset.value; render(); return; }
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
    game = {
      ...structuredClone(draft),
      teams: draft.teams.map(team => ({ ...structuredClone(team), score: 0, turns: 0, stealNext: false, explainerStart: randomExplainer(team) })),
      activeTeam: 0, phase: 'handoff', roles: null, roundNumber: 1,
      actions: [], word: null, timer: null, special: false, specialPlayed: 0,
      createdAt: new Date().toISOString()
    };
    game.roles = defaultRoles(activeTeam());
    view = 'game'; await saveGame(game); render(); return;
  }
  if (action === 'start-turn') return startTurn();
  if (action === 'correct' || action === 'skip' || action === 'mistake') return answer(action);
  if (action === 'special-answer') return specialAnswer(Number(button.dataset.index));
  if (action === 'last-word') {
    const index = Number(button.dataset.index);
    if (index >= 0) recordScore(index, 1, 'last', `${game.teams[index].name} перехватила +1`);
    return finishTurn();
  }
  if (action === 'end-turn') return finishTurn();
  if (action === 'next-turn') { game.phase = 'handoff'; await saveGame(game); render(); return; }
  if (action === 'new-round' && game.phase === 'roundResult') {
    game.roundNumber = (game.roundNumber || 1) + 1;
    game.teams.forEach(team => { team.score = 0; });
    game.activeTeam = 0; game.roles = defaultRoles(activeTeam()); game.phase = 'handoff';
    game.lastSummary = null;
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
    game.teams[previous.teamIndex].score = previous.previousScore;
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
  run(() => handleAction(button.dataset.action, button));
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
  if (field === 'team-name') draft.teams[Number(input.dataset.team)].name = input.value;
  if (field === 'player') draft.teams[Number(input.dataset.team)].players[Number(input.dataset.player)] = input.value;
  if (field === 'target-score') draft.targetScore = clamp(input.value, 5, 200);
  if (field === 'round-seconds') draft.roundSeconds = clamp(input.value, 10, 600);
  if (field === 'word-seconds') draft.wordSeconds = clamp(input.value, 10, 600);
  if (field === 'category') draft.category = input.value;
  if (field === 'difficulty') draft.difficulty = input.value;
  if (field === 'skip-penalty') draft.skipPenalty = Number(input.value);
  if (view === 'setup') render();
});

setInterval(() => {
  if (view !== 'game' || game?.phase !== 'playing' || !game.timer || game.timer.paused) return;
  updateTimer();
  if (timerLeft() <= 0) run(timeout);
}, 120);

async function init() {
  try {
    seen = await getSeen();
    game = await getGame();
    if (game?.teams.some(team => team.explainerStart == null)) {
      // Старые партии уже шли по порядку от первого участника: сохраняем этот круг без повторов.
      game.teams.forEach(team => { if (team.explainerStart == null) team.explainerStart = 0; });
      if (game.phase === 'handoff' || game.phase === 'round' || game.phase === 'roundResult') game.roles = defaultRoles(activeTeam());
      await saveGame(game);
    }
    render();
    requestPersistentStorage();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=10').catch(console.warn);
  } catch (error) {
    console.error(error);
    root.innerHTML = `${header()}<div class="panel"><h1>Не удалось открыть память игры</h1><p>Проверьте, что браузер разрешает хранить данные сайта, и перезагрузите страницу.</p></div>`;
  }
}

init();
