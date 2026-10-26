/** Una parte del PDF: una tabla con columnas, o pares etiqueta / valor */
export type SeccionPdf =
  | { titulo?: string; columnas: string[]; filas: (string | null | undefined)[][] }
  | { titulo?: string; pares: [string, string | null | undefined][] };

/** Datos de un PDF tamaño carta */
export interface DocumentoPdf {
  /** Nombre del archivo, sin ".pdf" */
  archivo: string;
  titulo: string;
  /** Vertical para una ficha; horizontal para una lista ancha */
  orientacion: 'portrait' | 'landscape';
  /** Línea de totales debajo del título (opcional) */
  resumen?: string;
  secciones: SeccionPdf[];
}

/** Colores del sistema en RGB */
const TINTA: [number, number, number] = [15, 23, 42];
const GRIS: [number, number, number] = [71, 85, 105];
const FONDO_TITULO: [number, number, number] = [241, 245, 249];
const BORDE: [number, number, number] = [203, 213, 225];

/** Márgenes de la hoja en milímetros */
const MARGEN = 12;

/**
 * Genera y descarga un PDF tamaño CARTA (en la PC y en el celular), con la
 * cabecera de la universidad, las tablas, las líneas para firmar y el
 * número de página. jsPDF se carga recién aquí, al tocar el botón, para no
 * hacer más pesada la página.
 */
export async function exportarPdf(datos: DocumentoPdf): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const documento = new jsPDF({ orientation: datos.orientacion, unit: 'mm', format: 'letter' });
  const ancho = documento.internal.pageSize.getWidth();
  const alto = documento.internal.pageSize.getHeight();

  // Cabecera: institución, título y fecha
  documento.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS);
  documento.text('Universidad Privada Domingo Savio · Sistema de laboratorios', MARGEN, MARGEN + 2);
  const fecha = new Date().toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
  documento.text(`Generado el ${fecha}`, ancho - MARGEN, MARGEN + 2, { align: 'right' });
  documento.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...TINTA);
  documento.text(datos.titulo, MARGEN, MARGEN + 9);
  documento.setDrawColor(...TINTA).setLineWidth(0.5).line(MARGEN, MARGEN + 12, ancho - MARGEN, MARGEN + 12);

  let y = MARGEN + 17;
  if (datos.resumen) {
    documento.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GRIS);
    documento.text(datos.resumen, MARGEN, y);
    y += 4;
  }

  // Estilo común de las tablas
  const estilo = {
    margin: { left: MARGEN, right: MARGEN, bottom: MARGEN + 6 },
    styles: { font: 'helvetica', fontSize: 8.5, textColor: TINTA, lineColor: BORDE, lineWidth: 0.2, cellPadding: 1.6, overflow: 'linebreak' as const },
    headStyles: { fillColor: FONDO_TITULO, textColor: TINTA, fontStyle: 'bold' as const },
    theme: 'grid' as const,
  };
  // vacio pone una raya donde no hay dato
  const vacio = (valor: string | null | undefined) => (valor && valor.trim() ? valor : '—');
  // ultimaY es dónde terminó la última tabla
  const ultimaY = () => (documento as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  for (const seccion of datos.secciones) {
    if (seccion.titulo) {
      // Si el título quedaría solo al pie de la hoja, pasa a la siguiente
      if (y > alto - MARGEN - 20) {
        documento.addPage();
        y = MARGEN;
      }
      documento.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...GRIS);
      documento.text(seccion.titulo.toUpperCase(), MARGEN, y + 3);
      y += 5;
    }
    if ('pares' in seccion) {
      autoTable(documento, {
        ...estilo, startY: y,
        body: seccion.pares.map(([etiqueta, valor]) => [etiqueta, vacio(valor)]),
        columnStyles: { 0: { cellWidth: 55, textColor: GRIS } },
      });
    } else {
      autoTable(documento, {
        ...estilo, startY: y,
        head: [seccion.columnas],
        body: seccion.filas.map((fila) => fila.map(vacio)),
      });
    }
    y = ultimaY() + 6;
  }

  // Líneas para firmar al final
  if (y > alto - MARGEN - 25) {
    documento.addPage();
    y = MARGEN;
  }
  const yFirma = y + 16;
  const largoFirma = 70;
  documento.setDrawColor(...TINTA).setLineWidth(0.3);
  documento.line(MARGEN, yFirma, MARGEN + largoFirma, yFirma);
  documento.line(ancho - MARGEN - largoFirma, yFirma, ancho - MARGEN, yFirma);
  documento.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRIS);
  documento.text('Auxiliar de turno', MARGEN + largoFirma / 2, yFirma + 4, { align: 'center' });
  documento.text('Encargado de laboratorios', ancho - MARGEN - largoFirma / 2, yFirma + 4, { align: 'center' });

  // Número de página en todas las hojas
  const paginas = documento.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina++) {
    documento.setPage(pagina);
    documento.setFontSize(8).setTextColor(...GRIS);
    documento.text(`Página ${pagina} de ${paginas}`, ancho - MARGEN, alto - MARGEN + 4, { align: 'right' });
  }

  documento.save(`${datos.archivo}.pdf`);
}
