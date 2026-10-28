let theme = document.documentElement.dataset.theme || 'dark';
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('alias-sound') !== 'off'; } catch { /* Defaults are usable without storage. */ }
let audioContext;
let masterGain;
const icon = enabled => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${enabled ? '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>' : '<path d="m16 9 5 6m0-6-5 6"/>'}</svg>`;
export function renderPreferences() {
  return `<button class="icon-button" data-action="toggle-theme" aria-label="${theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}" title="Сменить тему">${theme === 'dark' ? '☀' : '☾'}</button><button class="icon-button" data-action="toggle-sound" aria-label="${soundEnabled ? 'Выключить звуки' : 'Включить звуки'}" aria-pressed="${soundEnabled}" title="${soundEnabled ? 'Звук включён' : 'Звук выключен'}">${icon(soundEnabled)}</button>`;
}
export function unlockAudio() {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (!masterGain) { masterGain = audioContext.createGain(); masterGain.connect(audioContext.destination); }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}
const melodies = {
  tap: [[660,0,.045]], correct: [[660,0,.10],[880,.07,.12],[1046,.14,.16]],
  skip: [[392,0,.10],[330,.08,.12]], tick: [[740,0,.09]],
  go: [[523,0,.12],[659,.08,.12],[784,.16,.22]],
  time: [[880,0,.17],[659,.15,.17],[523,.30,.25]],
  win: [[523,0,.14],[659,.12,.14],[784,.24,.14],[1046,.38,.30]],
  turn: [[587,0,.11],[784,.08,.15]]
};
export function playSound(kind = 'tap') {
  if (!soundEnabled || document.hidden) return;
  unlockAudio();
  if (!audioContext) return;
  const context = audioContext;
  const play = () => {
    if (!soundEnabled || context.state !== 'running') return;
    const now = context.currentTime + .01;
    for (const [frequency, delay, duration] of melodies[kind] || melodies.tap) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(.075, now + delay + .012);
      gain.gain.exponentialRampToValueAtTime(.001, now + delay + duration);
      oscillator.connect(gain).connect(masterGain);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  };
  if (context.state === 'suspended') context.resume().then(play).catch(() => {}); else play();
}
export function togglePreference(action) {
  if (action === 'toggle-theme') {
    document.documentElement.classList.add('theme-changing');
    theme = theme === 'dark' ? 'light' : 'dark';
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('theme-changing')));
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101629' : '#f4f6ee');
    try { localStorage.setItem('alias-theme', theme); } catch { /* Optional preference. */ }
  } else {
    soundEnabled = !soundEnabled;
    if (masterGain) masterGain.gain.setValueAtTime(soundEnabled ? 1 : 0, audioContext.currentTime);
    try { localStorage.setItem('alias-sound', soundEnabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
  }
  for (const holder of document.querySelectorAll('.preference-buttons')) holder.innerHTML = renderPreferences();
  playSound('tap');
}
