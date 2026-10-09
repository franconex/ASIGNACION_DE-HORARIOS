import { inject, Injectable } from '@angular/core';
import {
  Ambiente, CandidatoChoque, Choque, Conflicto, EstadoVivoAmbiente, IgnorarChoque, Ocupacion,
} from './modelos';
import { SupabaseService } from './supabase.service';

/**
 * Acceso a las funciones de ocupación, choques y guardado (RPC de Supabase).
 */
@Injectable({ providedIn: 'root' })
export class OcupacionService {
  private readonly supabase = inject(SupabaseService);

  /** Todo lo que ocupa ambientes entre dos fechas (clases, cesiones, reservas) */
  ocupaciones(desde: string, hasta: string): Promise<Ocupacion[]> {
    return this.supabase.rpc<Ocupacion[]>('fn_ocupaciones', { p_desde: desde, p_hasta: hasta });
  }

  /** Choques existentes en un rango */
  conflictos(desde: string, hasta: string): Promise<Conflicto[]> {
    return this.supabase.rpc<Conflicto[]>('fn_conflictos', { p_desde: desde, p_hasta: hasta });
  }

  /** Verifica candidatos antes de guardar (validación en vivo) */
  async verificarChoques(items: CandidatoChoque[], ignorar: IgnorarChoque = {}): Promise<Choque[]> {
    if (!items.length) return [];
    return this.supabase.rpc<Choque[]>('fn_verificar_choques', { p_items: items, p_ignorar: ignorar });
  }

  /** Ambientes libres en una fecha y rango de horas */
  ambientesLibres(fecha: string, horaInicio: string, horaFin: string, ignorar: IgnorarChoque = {}, tipo: string | null = null): Promise<Ambiente[]> {
    return this.supabase.rpc<Ambiente[]>('fn_ambientes_libres', {
      p_fecha: fecha, p_hora_inicio: horaInicio, p_hora_fin: horaFin, p_tipo: tipo, p_ignorar: ignorar,
    });
  }

  /** Ambientes libres en TODAS las fechas dadas (ej. todos los martes marcados) */
  async ambientesLibresFechas(fechas: string[], horaInicio: string, horaFin: string,
    ignorar: IgnorarChoque = {}, tipo: string | null = null): Promise<Ambiente[]> {
    if (!fechas.length) return [];
    return this.supabase.rpc<Ambiente[]>('fn_ambientes_libres_fechas', {
      p_fechas: fechas, p_hora_inicio: horaInicio, p_hora_fin: horaFin, p_tipo: tipo, p_ignorar: ignorar,
    });
  }

  /** Estado libre/ocupado de cada ambiente en este momento */
  estadoAmbientes(): Promise<EstadoVivoAmbiente[]> {
    return this.supabase.rpc<EstadoVivoAmbiente[]>('fn_estado_ambientes');
  }

  /** Guarda una asignación completa con sus horarios */
  guardarAsignacion(datos: object): Promise<number> {
    return this.supabase.rpc<number>('rpc_guardar_asignacion', { p: datos });
  }

  /** Guarda un lote de cesiones (uno o varios horarios, cada uno con sus fechas) */
  guardarCesiones(datos: object): Promise<string> {
    return this.supabase.rpc<string>('rpc_guardar_cesiones', { p: datos });
  }

  /** Guarda un evento/defensa con sus horarios y reubicaciones obligatorias */
  guardarReserva(datos: object): Promise<number> {
    return this.supabase.rpc<number>('rpc_guardar_reserva', { p: datos });
  }

  /** Mueve o suspende una clase en una fecha concreta */
  reubicarClase(datos: object): Promise<number> {
    return this.supabase.rpc<number>('rpc_reubicar_clase', { p: datos });
  }
}
