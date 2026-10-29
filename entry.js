// An embedded copy never opens storage, starts a game or registers a worker.
if (window.self !== window.top) {
  const panel = document.createElement('main');
  panel.className = 'panel embedded-notice';
  const title = document.createElement('h1');
  title.textContent = 'Откройте Alias отдельно';
  const link = document.createElement('a');
  link.className = 'button button-primary';
  link.textContent = 'Открыть игру ↗';
  link.href = new URL('./',import.meta.url).href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  panel.append(title,link);
  document.querySelector('#app').replaceChildren(panel);
} else {
  import('./app.js?v=24').catch(error => {
    console.error(error);
    document.querySelector('#app').textContent = 'Не удалось загрузить игру. Обновите страницу.';
  });
}
