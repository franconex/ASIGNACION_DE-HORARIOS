/**
 * Descarga un archivo CSV (separado por ';' y con BOM UTF-8
 * para que Excel en español lo abra con tildes y columnas correctas).
 */
export function descargarCsv(nombreArchivo: string, encabezados: string[], filas: (string | number)[][]): void {
  // Un texto que empieza con = + - @ (o tab / salto) Excel lo ejecuta como fórmula:
  // se antepone ' para que quede como texto (inyección de fórmulas / CSV injection)
  const escapar = (valor: string | number) => {
    let s = String(valor ?? '');
    if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const contenido = [encabezados, ...filas].map((fila) => fila.map(escapar).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  // Sin la extensión .csv, Windows no lo abre con Excel
  enlace.download = nombreArchivo.replace(/\s+/g, '_').replace(/(\.csv)?$/i, '.csv');
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}
