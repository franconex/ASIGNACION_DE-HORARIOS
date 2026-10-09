/** Utilidades comunes de los gráficos SVG (líneas y barras) */

/** Una serie de datos: un valor por cada etiqueta del eje X */
export interface SerieGrafico {
  nombre: string;
  /** Color CSS (puede ser var(--serie-1)) */
  color: string;
  valores: number[];
  /** Trazo punteado: segunda forma de distinguir la serie además del color */
  punteada?: boolean;
}

/** Tope "redondo" para el eje Y (1, 2, 5, 10, 20, 50…) */
export function topeRedondo(max: number): number {
  if (max <= 0) return 1;
  if (max <= 4) return max <= 2 ? 2 : 4;
  const base = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((f) => f * base).find((v) => v >= max) ?? max;
}

/** 12.5 -> '12,5' (máx. 1 decimal) */
export function numero(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

/** Rectángulo con solo las esquinas de arriba redondeadas (barra anclada a la base) */
export function barraRedondeada(x: number, y: number, ancho: number, alto: number, radio: number): string {
  const r = Math.max(0, Math.min(radio, ancho / 2, alto));
  return `M${x},${y + alto} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + ancho - r},${y} ` +
    `Q${x + ancho},${y} ${x + ancho},${y + r} L${x + ancho},${y + alto} Z`;
}
