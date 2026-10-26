import { EstadoPc } from './modelos';

/** Texto de cada estado de PC para las hojas impresas */
export const TEXTOS_ESTADO_PC: Record<EstadoPc, string> = {
  operativa: 'Activa', inactiva: 'Inactiva', mantenimiento: 'Mantenimiento', baja: 'De baja',
};

/**
 * Escapa un valor para ponerlo dentro del HTML de una hoja impresa.
 * Los datos vienen de las PCs (nombre, modelo…): sin escapar, una PC con
 * un nombre armado a propósito podría meter código en la hoja.
 */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Estilos de las hojas: tamaño CARTA, letra del sistema, tablas con borde */
const ESTILOS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'IBM Plex Sans', Arial, sans-serif; color: #0f172a; font-size: 11px; }
  h1, h2, p { margin: 0; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
              border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .institucion { color: #475569; font-size: 10px; }
  h1 { font-size: 17px; margin-top: 2px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #475569; margin: 14px 0 5px; }
  .fecha { color: #475569; font-size: 10px; white-space: nowrap; }
  .resumen { display: flex; gap: 16px; flex-wrap: wrap; color: #475569; margin-bottom: 8px; }
  .resumen b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; background: #f1f5f9; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; vertical-align: top; }
  td.vacio { color: #64748b; }
  td.etiqueta { width: 32%; color: #475569; }
  tr { break-inside: avoid; }
  .mono { font-family: 'IBM Plex Mono', Consolas, monospace; }
  .firmas { display: flex; justify-content: space-between; margin-top: 40px; }
  .firma { border-top: 1px solid #0f172a; padding-top: 4px; width: 210px; text-align: center; color: #475569; }
`;

/**
 * Imprime un documento en hoja tamaño CARTA desde un marco oculto (no abre
 * ventanas, así el navegador no lo bloquea). También se puede "Guardar como PDF".
 * @param titulo nombre del documento (sale como nombre del PDF)
 * @param cuerpo HTML del contenido: todo dato variable debe pasar por escaparHtml
 * @param orientacion vertical para una ficha; horizontal para una lista ancha
 */
export function imprimirDocumento(titulo: string, cuerpo: string, orientacion: 'portrait' | 'landscape'): void {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(marco);

  const documento = marco.contentDocument;
  const ventana = marco.contentWindow;
  if (!documento || !ventana) {
    marco.remove();
    return;
  }
  documento.open();
  documento.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>
    <style>@page { size: letter ${orientacion}; margin: 12mm; } ${ESTILOS}</style></head><body>${cuerpo}</body></html>`);
  documento.close();

  // Se quita el marco cuando se cierra el diálogo de impresión
  const quitar = () => setTimeout(() => marco.remove(), 500);
  ventana.addEventListener('afterprint', quitar, { once: true });
  setTimeout(() => {
    ventana.focus();
    ventana.print();
    // Respaldo por si el navegador no avisa "afterprint"
    setTimeout(() => marco.isConnected && marco.remove(), 60_000);
  }, 100);
}

/** Cabecera común: institución, título y fecha de impresión */
export function cabeceraHoja(titulo: string): string {
  const fecha = new Date().toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
  return `<div class="cabecera"><div><p class="institucion">Universidad Privada Domingo Savio · Sistema de laboratorios</p>
    <h1>${escaparHtml(titulo)}</h1></div><p class="fecha">Impreso el ${escaparHtml(fecha)}</p></div>`;
}

/** Líneas para firmar al pie de la hoja */
export const FIRMAS_HOJA = '<div class="firmas"><span class="firma">Auxiliar de turno</span><span class="firma">Encargado de laboratorios</span></div>';
