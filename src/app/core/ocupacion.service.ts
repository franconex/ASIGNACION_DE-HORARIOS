import { inject, Injectable } from '@angular/core';
import {
  Ambiente, CandidatoChoque, Choque, ClaseDesplazada, Conflicto, EstadoVivoAmbiente, IgnorarChoque, Ocupacion,
} from './modelos';
import { ErrorSistema, SupabaseService } from './supabase.service';

/**
 * Acceso a las funciones de ocupación, choques y guardado (RPC de Supabase).
 */
/** Texto corto de una clase desplazada: "Cedido por Escobar Alex (→ D04)" */
export function textoDesplazada(d: ClaseDesplazada): string {
  return `Cedido por ${d.docente} (${d.destino ? '→ ' + d.destino : 'clase suspendida'})`;
}

@Injectable({ providedIn: 'root' })
export class OcupacionService {
  private readonly supabase = inject(SupabaseService);

  /**
   * Todo lo que ocupa ambientes entre dos fechas (clases, cesiones, reservas).
   * A cada ocupación se le agregan las clases que ese día dejaron ese
   * laboratorio en ese horario (reubicadas), para mostrar a dónde se fueron.
   */
  async ocupaciones(desde: string, hasta: string): Promise<Ocupacion[]> {
    const [ocupaciones, { data, error }] = await Promise.all([
      this.supabase.rpc<Ocupacion[]>('fn_ocupaciones', { p_desde: desde, p_hasta: hasta }),
      this.supabase.cliente.from('reubicaciones')
        .select('fecha, aula_destino, destino:ambientes(codigo), horario:asignacion_horarios(id, ambiente_id, hora_inicio, hora_fin, asignacion:asignaciones(docente:docentes(nombres, apellidos), materia:materias(nombre)))')
        .gte('fecha', desde).lte('fecha', hasta),
    ]);
    if (error) throw new ErrorSistema(error);
    type FilaReubicacion = {
      fecha: string; aula_destino: string | null; destino: { codigo: string } | null;
      horario: { id: number; ambiente_id: number; hora_inicio: string; hora_fin: string;
        asignacion: { docente: { nombres: string; apellidos: string } | null; materia: { nombre: string } | null } | null } | null;
    };
    const filas = (data ?? []) as unknown as FilaReubicacion[];
    if (!filas.length) return ocupaciones;
    for (const o of ocupaciones) {
      const desplazadas: ClaseDesplazada[] = filas
        .filter((r) => r.horario && r.fecha === o.fecha && r.horario.ambiente_id === o.ambiente_id && r.horario.id !== o.asignacion_horario_id &&
          r.horario.hora_inicio < o.hora_fin && o.hora_inicio < r.horario.hora_fin)
        .map((r) => ({
          docente: `${r.horario?.asignacion?.docente?.apellidos ?? ''} ${r.horario?.asignacion?.docente?.nombres ?? ''}`.trim(),
          materia: r.horario?.asignacion?.materia?.nombre ?? '',
          destino: r.destino?.codigo ?? r.aula_destino,
        }));
      if (!desplazadas.length) continue;
      o.desplazadas = desplazadas;
      // La clase que ocupa el laboratorio se muestra como un ambiente cedido
      if (o.origen === 'clase') {
        o.estado = 'cedida';
        o.color = '#9333ea';
      }
    }
    return ocupaciones;
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

  // ----- Eliminar (por si se cargó mal): se borra todo lo que cuelga de ella -----

  /** Elimina una asignación completa: todos sus horarios y fechas, con sus cesiones y reubicaciones */
  async eliminarAsignacion(id: number): Promise<void> {
    const { error } = await this.supabase.cliente.from('asignaciones').delete().eq('id', id);
    if (error) throw new ErrorSistema(error);
  }

  /** Elimina un evento/reserva con todos sus días; las clases que movió vuelven a su laboratorio */
  async eliminarReserva(id: number): Promise<void> {
    const { error } = await this.supabase.cliente.from('reservas').delete().eq('id', id);
    if (error) throw new ErrorSistema(error);
  }

  /** Elimina la cesión y las demás de su lote (los otros horarios cedidos junto con ella) */
  async eliminarCesion(id: number): Promise<void> {
    const { data, error: errorLote } = await this.supabase.cliente.from('cesiones').select('lote').eq('id', id).maybeSingle();
    if (errorLote) throw new ErrorSistema(errorLote);
    const consulta = this.supabase.cliente.from('cesiones').delete();
    const { error } = await (data?.lote ? consulta.eq('lote', data.lote) : consulta.eq('id', id));
    if (error) throw new ErrorSistema(error);
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
