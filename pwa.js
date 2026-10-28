let installPrompt = null;
let installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let offlineReady = false;
let onChange = () => {};
let dismissedAt = 0;
try { dismissedAt = Number(localStorage.getItem('alias-install-dismissed')) || 0; } catch { /* Optional preference. */ }

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  onChange();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  installPrompt = null;
  onChange();
});
window.matchMedia('(display-mode: standalone)').addEventListener('change', event => {
  installed = event.matches || navigator.standalone === true;
  onChange();
});

function installationSteps() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(navigator.userAgent);
  if (ios) return '<p>В Safari откройте меню «Поделиться» и выберите «На экран Домой». Включите «Открывать как веб-приложение», если такой переключатель есть, и нажмите «Добавить».</p>';
  if (android) return '<p>Откройте меню браузера ⋮ и выберите «Установить приложение» или «Добавить на главный экран».</p>';
  return '<p>В Chrome или Edge нажмите значок установки в адресной строке или выберите «Установить Alias» в меню браузера.</p>';
}

export function renderInstallHint() {
  if (installed) return offlineReady ? '<p class="offline-note" role="status">✓ Готово к игре без интернета</p>' : '';
  const hidden = Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000;
  return `${hidden ? '<button class="install-link" data-action="install-help">Добавить на главный экран</button>' : `<aside class="install-hint" aria-label="Установка приложения"><span class="install-icon" aria-hidden="true">↗</span><div><strong>Alias под рукой</strong><p>${offlineReady ? 'Сохраните на главный экран и играйте без интернета.' : 'Добавьте на главный экран, чтобы открывать как приложение.'}</p><button class="install-link" data-action="install-open">${installPrompt ? 'Установить приложение' : 'Как добавить'} →</button></div><button class="install-dismiss" data-action="install-dismiss" aria-label="Скрыть подсказку установки">×</button></aside>`}
    <dialog class="install-dialog" id="install-dialog" aria-labelledby="install-title"><div class="install-dialog-head"><h2 id="install-title">Alias как приложение</h2><button class="icon-button" data-action="install-close" aria-label="Закрыть инструкцию">×</button></div>${installationSteps()}<p class="field-note">${offlineReady ? 'Игра и весь словарь уже сохранены для работы без интернета.' : 'После первого открытия дождитесь загрузки игры и словаря — тогда они будут доступны без интернета.'}</p><button class="button button-primary button-full" data-action="install-close">Понятно</button></dialog>`;
}

export async function handleInstallAction(action) {
  if (action === 'install-dismiss') {
    dismissedAt = Date.now();
    try { localStorage.setItem('alias-install-dismissed', String(dismissedAt)); } catch { /* Optional preference. */ }
    onChange();
  } else if (action === 'install-close') document.querySelector('#install-dialog')?.close();
  else if (action === 'install-help' || (action === 'install-open' && !installPrompt)) document.querySelector('#install-dialog')?.showModal();
  else if (action === 'install-open') {
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice;
    onChange();
  }
}

async function checkOffline(registration) {
  const worker = registration.active;
  if (!worker) return;
  const channel = new MessageChannel();
  channel.port1.onmessage = event => {
    channel.port1.close();
    if (offlineReady !== Boolean(event.data?.ready)) {
      offlineReady = Boolean(event.data?.ready);
      onChange();
    }
  };
  worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
}

export async function initPwa(callback) {
  onChange = callback;
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js?v=21');
    await navigator.serviceWorker.ready;
    await checkOffline(registration);
    navigator.serviceWorker.addEventListener('controllerchange', () => checkOffline(registration));
  } catch (error) { console.warn('Офлайн-режим пока недоступен', error); }
}
