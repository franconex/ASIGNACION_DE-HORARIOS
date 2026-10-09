/**
 * Utilidades de fechas y horas.
 * Todas las fechas se manejan como texto 'YYYY-MM-DD' en hora local
 * para evitar desfases por zona horaria.
 */

/** Nombres de días ISO (1 = lunes … 7 = domingo) */
export const DIAS_SEMANA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTOS = ['', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Convierte un Date a 'YYYY-MM-DD' (hora local) */
export function aIso(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Convierte 'YYYY-MM-DD' a Date local (a medianoche) */
export function deIso(texto: string): Date {
  const [anio, mes, dia] = texto.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Fecha de hoy en 'YYYY-MM-DD' */
export function hoyIso(): string {
  return aIso(new Date());
}

/** Suma días a una fecha ISO */
export function sumarDias(texto: string, dias: number): string {
  const fecha = deIso(texto);
  fecha.setDate(fecha.getDate() + dias);
  return aIso(fecha);
}

/** Día ISO de la semana (1 = lunes … 7 = domingo) */
export function diaIso(texto: string): number {
  const dia = deIso(texto).getDay();
  return dia === 0 ? 7 : dia;
}

/** Lista de fechas entre dos fechas (incluidas) */
export function rangoFechas(desde: string, hasta: string): string[] {
  const resultado: string[] = [];
  let actual = desde;
  while (actual <= hasta) {
    resultado.push(actual);
    actual = sumarDias(actual, 1);
  }
  return resultado;
}

/** '19:00:00' -> '19:00' */
export function hhmm(hora: string | null | undefined): string {
  return hora ? hora.slice(0, 5) : '';
}

/** '19:30' -> minutos desde medianoche */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** ¿Se solapan dos rangos de horas? */
export function seSolapan(ini1: string, fin1: string, ini2: string, fin2: string): boolean {
  return aMinutos(ini1) < aMinutos(fin2) && aMinutos(ini2) < aMinutos(fin1);
}

/** 'martes 13/10/2026' */
export function fechaLarga(texto: string): string {
  const fecha = deIso(texto);
  return `${DIAS_SEMANA[diaIso(texto)].toLowerCase()} ${String(fecha.getDate()).padStart(2, '0')}/` +
    `${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
}

/** '13/10' */
export function fechaCorta(texto: string): string {
  const [, mes, dia] = texto.split('-');
  return `${dia}/${mes}`;
}

/** Hora actual 'HH:MM' en la zona horaria de la universidad */
export function horaActual(zonaHoraria: string): string {
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zonaHoraria })
    .format(new Date());
}

/** Fecha actual 'YYYY-MM-DD' en la zona horaria de la universidad */
export function fechaActual(zonaHoraria: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria }).format(new Date());
}

/** Suma meses a una fecha ISO (si el día no existe, usa el último del mes) */
export function sumarMeses(texto: string, meses: number): string {
  const fecha = deIso(texto);
  const dia = fecha.getDate();
  const destino = new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
  const ultimo = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
  destino.setDate(Math.min(dia, ultimo));
  return aIso(destino);
}

/** Texto de duración: "6 meses y 5 días" */
export function textoDuracion(desde: string, hasta: string): string {
  let meses = 0;
  while (sumarMeses(desde, meses + 1) <= sumarDias(hasta, 1)) meses++;
  const resto = rangoFechas(sumarMeses(desde, meses), hasta).length;
  const partes: string[] = [];
  if (meses) partes.push(`${meses} ${meses === 1 ? 'mes' : 'meses'}`);
  if (resto > 0) partes.push(`${resto} ${resto === 1 ? 'día' : 'días'}`);
  return partes.join(' y ') || '1 día';
}
