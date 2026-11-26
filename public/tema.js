// Aplica el modo oscuro antes de dibujar (evita el parpadeo).
// Está en un archivo aparte (no dentro de index.html) para que la política
// de seguridad (CSP) pueda prohibir todo script escrito dentro de la página.
try {
  var t = localStorage.getItem('laboratorios-tema');
  if (t === 'oscuro' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('oscuro');
} catch (e) {}
