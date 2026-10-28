export function createNavigation(initialView, onChange, closeOverlay, onRoot) {
  let current = initialView;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const set = (screen, replace = false) => history[replace ? 'replaceState' : 'pushState']({ alias: true, screen }, '', `#${screen}`);
  if (!history.state?.alias) {
    set(standalone ? 'root' : 'home', true);
    if (standalone) set('home');
    if (initialView === 'setup') set('setup');
    if (initialView === 'game') { set('setup'); set('game'); }
  } else set(initialView, true);
  window.addEventListener('popstate', event => {
    if (closeOverlay()) { set(current); return; }
    if (event.state?.screen === 'root') { set('home'); current = 'home'; onChange('home'); onRoot(); return; }
    if (!event.state?.alias) return;
    current = event.state.screen;
    onChange(current);
  });
  let touch;
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || event.target.closest('input,select,button,a,summary,dialog')) return;
    touch = { x: event.clientX, y: event.clientY, time: Date.now() };
  }, { passive: true });
  document.addEventListener('pointercancel', () => { touch = null; });
  document.addEventListener('pointerup', event => {
    if (!touch) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
    const valid = Date.now() - touch.time < 850 && Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.8;
    const edge = dx > 0 ? touch.x < 45 : touch.x > innerWidth - 45;
    touch = null;
    if (!valid || !edge) return;
    if (dx > 0) { if (!closeOverlay()) history.back(); } else history.forward();
  }, { passive: true });
  return {
    sync(view) {
      if (view === current) return;
      if (view === 'game' && current === 'home') set('setup');
      set(view); current = view;
    },
    back() { if (!closeOverlay()) history.back(); }
  };
}
