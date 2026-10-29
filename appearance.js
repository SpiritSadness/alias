// Runs before first paint; external script works with script-src 'self'.
try { document.documentElement.dataset.theme = localStorage.getItem('alias-theme') === 'light' ? 'light' : 'dark'; }
catch { document.documentElement.dataset.theme = 'dark'; }
document.querySelector('meta[name="theme-color"]').content = document.documentElement.dataset.theme === 'light' ? '#f4f6ee' : '#101629';
