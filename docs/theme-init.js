// pick the theme before the page draws, so it doesn't flash light first
  (function () {
    let t = 'auto'; try { t = localStorage.getItem('theme') || 'auto'; } catch {}
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  })();
