import type { Borders, Cell, Fill, Workbook, Worksheet } from 'exceljs';

/**
 * Exporta a un Excel (.xlsx) de verdad, con formato: título y periodo
 * arriba, encabezados de color, columnas con su ancho, números como
 * números (con su formato de horas o porcentaje), filas alternadas, una
 * fila de totales y lista para imprimir en hoja horizontal.
 * La librería (ExcelJS) se carga solo al exportar.
 */

/** Cómo se muestra una columna */
export type FormatoColumna = 'texto' | 'entero' | 'decimal' | 'horas' | 'porcentaje' | 'fecha' | 'fechaHora';

export interface ColumnaExcel {
  titulo: string;
  formato?: FormatoColumna;
  /** Suma esta columna en la fila de totales (solo columnas de número) */
  sumar?: boolean;
}

export interface TablaExcel {
  titulo: string;
  /** Explicación corta debajo del título */
  nota?: string;
  columnas: ColumnaExcel[];
  filas: (string | number | null | undefined)[][];
  /** Agrega una fila "Total" con la suma de las columnas marcadas con sumar */
  totales?: boolean;
}

export interface IndicadorExcel {
  texto: string;
  valor: string | number;
  formato?: FormatoColumna;
  detalle?: string;
}

export interface HojaExcel {
  /** Nombre de la pestaña (hasta 31 letras) */
  nombre: string;
  /** Cuadro de indicadores al inicio de la hoja */
  indicadores?: IndicadorExcel[];
  /** Título de ese cuadro (por defecto "Indicadores principales") */
  tituloIndicadores?: string;
  tablas: TablaExcel[];
}

export interface OpcionesExcel {
  /** Nombre del archivo, sin extensión */
  archivo: string;
  titulo: string;
  /** Periodo u otra aclaración que va debajo del título en cada hoja */
  subtitulo: string;
  hojas: HojaExcel[];
}

/** Colores del sistema */
const MARCA = 'FF2747A8';
const MARCA_SUAVE = 'FFEEF1FA';
const GRIS_TEXTO = 'FF64748B';
const GRIS_BORDE = 'FFCBD5E1';
const ZEBRA = 'FFF8FAFC';

const FORMATOS: Record<FormatoColumna, string | undefined> = {
  texto: undefined,
  entero: '#,##0',
  decimal: '#,##0.0',
  horas: '#,##0.0" h"',
  porcentaje: '0" %"',
  fecha: 'dd/mm/yyyy',
  fechaHora: 'dd/mm/yyyy hh:mm',
};

const NUMERICOS = new Set<FormatoColumna>(['entero', 'decimal', 'horas', 'porcentaje']);

function relleno(color: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function bordes(color = GRIS_BORDE): Partial<Borders> {
  const linea = { style: 'thin' as const, color: { argb: color } };
  return { top: linea, left: linea, bottom: linea, right: linea };
}

/** "2026-11-15" o "2026-11-15T10:20:00Z" -> Date (sin correrse por la zona horaria en las fechas solas) */
function aFecha(valor: string): Date | string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d));
  }
  const f = new Date(valor);
  if (Number.isNaN(f.getTime())) return valor;
  // Excel no guarda zona horaria: se escribe la hora local tal cual se ve en el sistema
  return new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate(), f.getHours(), f.getMinutes()));
}

/** Valor de una celda según el formato de su columna */
function valorCelda(valor: string | number | null | undefined, formato: FormatoColumna): string | number | Date | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (NUMERICOS.has(formato)) {
    const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
    return Number.isFinite(n) ? n : String(valor);
  }
  if ((formato === 'fecha' || formato === 'fechaHora') && typeof valor === 'string') return aFecha(valor);
  return valor;
}

/** Largo que ocupa un valor ya formateado (para el ancho de la columna) */
function largo(valor: string | number | null | undefined, formato: FormatoColumna): number {
  if (valor === null || valor === undefined) return 0;
  if (formato === 'fecha') return 10;
  if (formato === 'fechaHora') return 16;
  if (typeof valor === 'number') return valor.toLocaleString('es-BO', { maximumFractionDigits: 1 }).length + (formato === 'horas' ? 2 : formato === 'porcentaje' ? 2 : 0);
  // Textos largos se cortan en varias líneas: el ancho llega hasta 50
  return Math.max(...String(valor).split('\n').map((l) => l.length));
}

/** Nombre de pestaña válido para Excel (sin []:*?/\ y hasta 31 letras), sin repetir */
function nombreHoja(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let final = base;
  for (let i = 2; usados.has(final.toLowerCase()); i++) final = `${base.slice(0, 28)} ${i}`;
  usados.add(final.toLowerCase());
  return final;
}

function escribirHoja(libro: Workbook, hoja: HojaExcel, opciones: OpcionesExcel, usados: Set<string>): void {
  const ws = libro.addWorksheet(nombreHoja(hoja.nombre, usados), {
    pageSetup: { orientation: 'landscape', paperSize: 1 as never, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } },
    headerFooter: { oddFooter: `&L${opciones.titulo}&RPágina &P de &N` },
    views: [{ showGridLines: false }],
  });
  const anchoTabla = Math.max(3, ...hoja.tablas.map((t) => t.columnas.length));
  const anchos: number[] = Array.from({ length: anchoTabla }, () => 8);
  const medir = (col: number, n: number) => { anchos[col] = Math.max(anchos[col] ?? 8, n); };

  // Título y periodo
  ws.mergeCells(1, 1, 1, anchoTabla);
  const titulo = ws.getCell(1, 1);
  titulo.value = `${opciones.titulo} · ${hoja.nombre}`;
  titulo.font = { bold: true, size: 15, color: { argb: MARCA } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, anchoTabla);
  const sub = ws.getCell(2, 1);
  const generado = new Date().toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  sub.value = `${opciones.subtitulo}   ·   Generado el ${generado}`;
  sub.font = { italic: true, size: 10, color: { argb: GRIS_TEXTO } };
  let fila = 4;
  /** Fila del encabezado de la única tabla (para fijarla y filtrar) */
  let encabezadoUnico: { fila: number; columnas: number; ultima: number } | null = null;

  // Indicadores: Indicador | Valor | Detalle
  if (hoja.indicadores?.length) {
    fila = encabezadoTabla(ws, fila, hoja.tituloIndicadores ?? 'Indicadores principales', undefined, ['Indicador', 'Valor', 'Detalle'], anchoTabla);
    hoja.indicadores.forEach((ind, i) => {
      const formato = ind.formato ?? (typeof ind.valor === 'number' ? 'entero' : 'texto');
      const celdas = [ind.texto, valorCelda(ind.valor, formato), ind.detalle ?? null];
      celdas.forEach((v, c) => {
        const celda = ws.getCell(fila, c + 1);
        celda.value = v;
        estiloDato(celda, i, c === 1 ? formato : 'texto');
        if (c === 0) celda.font = { bold: true };
        if (c === 1) { celda.font = { bold: true, size: 12, color: { argb: MARCA } }; celda.alignment = { horizontal: 'right', vertical: 'middle' }; }
      });
      medir(0, ind.texto.length);
      medir(1, largo(typeof ind.valor === 'number' ? ind.valor : String(ind.valor), formato) + 2);
      medir(2, (ind.detalle ?? '').length);
      fila++;
    });
    fila += 2;
  }

  for (const tabla of hoja.tablas) {
    const inicio = encabezadoTabla(ws, fila, tabla.titulo, tabla.nota, tabla.columnas.map((c) => c.titulo), anchoTabla);
    const filaEncabezado = inicio - 1;
    tabla.columnas.forEach((c, i) => medir(i, Math.min(30, c.titulo.length + 2)));
    fila = inicio;
    if (!tabla.filas.length) {
      ws.mergeCells(fila, 1, fila, tabla.columnas.length);
      const celda = ws.getCell(fila, 1);
      celda.value = 'Sin datos en este periodo';
      celda.font = { italic: true, color: { argb: GRIS_TEXTO } };
      celda.border = bordes();
      fila++;
    }
    tabla.filas.forEach((valores, i) => {
      tabla.columnas.forEach((col, c) => {
        const formato = col.formato ?? 'texto';
        const celda = ws.getCell(fila, c + 1);
        celda.value = valorCelda(valores[c], formato);
        estiloDato(celda, i, formato);
        medir(c, largo(valores[c], formato) + 1);
      });
      fila++;
    });
    // Totales con fórmula (si se cambia un número en Excel, el total se actualiza)
    if (tabla.totales && tabla.filas.length) {
      tabla.columnas.forEach((col, c) => {
        const celda = ws.getCell(fila, c + 1);
        if (c === 0) celda.value = 'Total';
        else if (col.sumar) {
          const letra = ws.getColumn(c + 1).letter;
          const suma = tabla.filas.reduce((s, f) => s + (Number(f[c]) || 0), 0);
          celda.value = { formula: `SUM(${letra}${inicio}:${letra}${fila - 1})`, result: Math.round(suma * 10) / 10 };
          celda.numFmt = FORMATOS[col.formato ?? 'entero'] ?? '#,##0';
          celda.alignment = { horizontal: 'right' };
        }
        celda.font = { bold: true };
        celda.fill = relleno(MARCA_SUAVE);
        celda.border = { ...bordes(), top: { style: 'medium', color: { argb: MARCA } } };
      });
      fila++;
    }
    if (hoja.tablas.length === 1 && !hoja.indicadores?.length) {
      encabezadoUnico = { fila: filaEncabezado, columnas: tabla.columnas.length, ultima: fila - 1 };
    }
    fila += 2;
  }

  anchos.forEach((a, i) => { ws.getColumn(i + 1).width = Math.min(50, Math.max(i === 0 ? 14 : 9, a + 1)); });
  // Una sola tabla: el encabezado queda fijo al bajar y con filtros
  if (encabezadoUnico) {
    ws.views = [{ state: 'frozen', ySplit: encabezadoUnico.fila, showGridLines: false }];
    ws.autoFilter = { from: { row: encabezadoUnico.fila, column: 1 }, to: { row: encabezadoUnico.ultima, column: encabezadoUnico.columnas } };
  }
}

/** Título de la tabla, su nota y la fila de encabezados. Devuelve la primera fila de datos. */
function encabezadoTabla(ws: Worksheet, fila: number, titulo: string, nota: string | undefined, columnas: string[], ancho: number): number {
  const t = ws.getCell(fila, 1);
  t.value = titulo;
  t.font = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
  ws.getRow(fila).height = 20;
  fila++;
  if (nota) {
    ws.mergeCells(fila, 1, fila, ancho);
    const n = ws.getCell(fila, 1);
    n.value = nota;
    n.font = { italic: true, size: 9, color: { argb: GRIS_TEXTO } };
    n.alignment = { wrapText: true, vertical: 'top' };
    fila++;
  }
  columnas.forEach((texto, c) => {
    const celda = ws.getCell(fila, c + 1);
    celda.value = texto;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = relleno(MARCA);
    celda.border = bordes(MARCA);
    celda.alignment = { vertical: 'middle', horizontal: c === 0 ? 'left' : 'center', wrapText: true };
  });
  ws.getRow(fila).height = 30;
  return fila + 1;
}

function estiloDato(celda: Cell, i: number, formato: FormatoColumna): void {
  celda.border = bordes();
  if (i % 2 === 1) celda.fill = relleno(ZEBRA);
  const numFmt = FORMATOS[formato];
  if (numFmt) celda.numFmt = numFmt;
  celda.alignment = NUMERICOS.has(formato) || formato === 'fecha' || formato === 'fechaHora'
    ? { horizontal: 'right', vertical: 'top' }
    : { vertical: 'top', wrapText: true };
}

/** Arma el libro (sin descargarlo) */
export async function crearLibro(opciones: OpcionesExcel): Promise<Workbook> {
  const modulo = await import('exceljs');
  const ExcelJS = (modulo as unknown as { default?: typeof modulo }).default ?? modulo;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de Laboratorios';
  libro.created = new Date();
  const usados = new Set<string>();
  for (const hoja of opciones.hojas) escribirHoja(libro, hoja, opciones, usados);
  return libro;
}

/** Arma el libro y lo descarga como .xlsx */
export async function exportarExcel(opciones: OpcionesExcel): Promise<void> {
  const libro = await crearLibro(opciones);
  const datos = await libro.xlsx.writeBuffer();
  const blob = new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `${opciones.archivo.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_')}.xlsx`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}
