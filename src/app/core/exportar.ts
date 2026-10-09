/**
 * Descarga un archivo CSV (separado por ';' y con BOM UTF-8
 * para que Excel en español lo abra con tildes y columnas correctas).
 */
export function descargarCsv(nombreArchivo: string, encabezados: string[], filas: (string | number)[][]): void {
  const escapar = (valor: string | number) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const contenido = [encabezados, ...filas].map((fila) => fila.map(escapar).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombreArchivo.replace(/\s+/g, '_');
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}
