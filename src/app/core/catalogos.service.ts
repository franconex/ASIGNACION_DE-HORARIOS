import { computed, inject, Injectable, signal } from '@angular/core';
import {
  Ambiente, AmbientePc, BloqueHorario, Carrera, Docente, Feriado, Materia, SistemaAcademico, TipoReserva,
} from './modelos';
import { diaIso } from './fechas';
import { ErrorSistema, SupabaseService } from './supabase.service';

/** Tablas de catálogo que se guardan en memoria */
export type TablaCatalogo =
  | 'carreras' | 'docentes' | 'materias' | 'ambientes' | 'ambiente_pcs' | 'sistemas_academicos'
  | 'bloques_horario' | 'tipos_reserva' | 'feriados';

/**
 * Catálogos en memoria (carreras, docentes, ambientes, periodos…).
 * Se cargan una vez y se refrescan cuando se editan.
 */
@Injectable({ providedIn: 'root' })
export class CatalogosService {
  private readonly supabase = inject(SupabaseService);

  readonly carreras = signal<Carrera[]>([]);
  readonly docentes = signal<Docente[]>([]);
  readonly materias = signal<Materia[]>([]);
  readonly ambientes = signal<Ambiente[]>([]);
  readonly pcs = signal<AmbientePc[]>([]);
  readonly sistemas = signal<SistemaAcademico[]>([]);
  readonly bloques = signal<BloqueHorario[]>([]);
  readonly tiposReserva = signal<TipoReserva[]>([]);
  readonly feriados = signal<Feriado[]>([]);
  readonly cargado = signal(false);

  /** Mapas por id para búsquedas rápidas en las vistas */
  readonly mapaAmbientes = computed(() => new Map(this.ambientes().map((a) => [a.id, a])));
  /** PCs agrupadas por laboratorio (ambiente_id -> lista ordenada) */
  readonly pcsPorAmbiente = computed(() => {
    const mapa = new Map<number, AmbientePc[]>();
    for (const pc of this.pcs()) mapa.set(pc.ambiente_id, [...(mapa.get(pc.ambiente_id) ?? []), pc]);
    return mapa;
  });
  readonly mapaDocentes = computed(() => new Map(this.docentes().map((d) => [d.id, d])));
  readonly mapaCarreras = computed(() => new Map(this.carreras().map((c) => [c.id, c])));
  readonly mapaMaterias = computed(() => new Map(this.materias().map((m) => [m.id, m])));
  readonly mapaSistemas = computed(() => new Map(this.sistemas().map((s) => [s.id, s])));
  readonly conjuntoFeriados = computed(() => new Set(this.feriados().map((f) => f.fecha)));
  readonly mapaFeriados = computed(() => new Map(this.feriados().map((f) => [f.fecha, f.descripcion])));

  /** Por qué ese día no se trabaja (feriado o domingo); null si es un día hábil */
  motivoNoLaborable(fecha: string): string | null {
    const feriado = this.mapaFeriados().get(fecha);
    if (feriado !== undefined) return `Feriado: ${feriado}`;
    return diaIso(fecha) === 7 ? 'Domingo: no hay clases' : null;
  }

  /** Ambientes utilizables (no dados de baja) */
  readonly ambientesActivos = computed(() => this.ambientes().filter((a) => a.estado !== 'baja'));
  /** Solo laboratorios no dados de baja */
  readonly laboratorios = computed(() => this.ambientesActivos().filter((a) => a.tipo === 'laboratorio'));
  /** Docentes activos ordenados por apellido */
  readonly docentesActivos = computed(() => this.docentes().filter((d) => d.activo));

  private carga: Promise<void> | null = null;

  /** Carga todos los catálogos (solo la primera vez) */
  cargarTodo(): Promise<void> {
    if (!this.carga) {
      this.carga = Promise.all([
        this.recargar('carreras'), this.recargar('docentes'), this.recargar('materias'),
        this.recargar('ambientes'), this.recargar('ambiente_pcs'), this.recargar('sistemas_academicos'),
        this.recargar('bloques_horario'), this.recargar('tipos_reserva'), this.recargar('feriados'),
      ]).then(() => this.cargado.set(true))
        .catch((e) => { this.carga = null; throw e; });
    }
    return this.carga;
  }

  /** Vuelve a leer una tabla desde Supabase */
  async recargar(tabla: TablaCatalogo): Promise<void> {
    const cliente = this.supabase.cliente;
    switch (tabla) {
      case 'carreras':
        this.carreras.set(await this.leer(cliente.from('carreras').select('*').order('nombre')));
        break;
      case 'docentes':
        this.docentes.set(await this.leer(cliente.from('docentes')
          .select('*, docente_carreras(carrera_id), docente_materias(materia_id)')
          .order('apellidos').order('nombres')));
        break;
      case 'materias':
        this.materias.set(await this.leer(cliente.from('materias').select('*').order('nombre')));
        break;
      case 'ambientes':
        // El sistema maneja solo laboratorios (las aulas se registran como texto al reubicar)
        this.ambientes.set(await this.leer(cliente.from('ambientes').select('*').eq('tipo', 'laboratorio').order('orden').order('codigo')));
        break;
      case 'ambiente_pcs':
        this.pcs.set(await this.leer(cliente.from('ambiente_pcs').select('*, cambio:perfiles!ambiente_pcs_estado_por_fkey(nombre_completo)').order('ambiente_id').order('orden').order('etiqueta')));
        break;
      case 'sistemas_academicos':
        this.sistemas.set(await this.leer(cliente.from('sistemas_academicos').select('*').eq('activo', true).order('id')));
        break;
      case 'bloques_horario':
        this.bloques.set(await this.leer(cliente.from('bloques_horario').select('*').order('orden')));
        break;
      case 'tipos_reserva':
        this.tiposReserva.set(await this.leer(cliente.from('tipos_reserva').select('*').order('id')));
        break;
      case 'feriados':
        this.feriados.set(await this.leer(cliente.from('feriados').select('*').order('fecha')));
        break;
    }
  }

  /**
   * Inserta o actualiza una fila de un catálogo y refresca la lista.
   * @returns la fila guardada
   */
  async guardar<T extends object>(tabla: TablaCatalogo, fila: T, clave = 'id'): Promise<T> {
    const datos = { ...fila } as Record<string, unknown>;
    const valorClave = datos[clave];
    let consulta;
    if (valorClave !== undefined && valorClave !== null && clave === 'id') {
      delete datos['id'];
      consulta = this.supabase.cliente.from(tabla).update(datos).eq('id', valorClave).select().single();
    } else if (clave !== 'id') {
      consulta = this.supabase.cliente.from(tabla).upsert(datos).select().single();
    } else {
      delete datos['id'];
      consulta = this.supabase.cliente.from(tabla).insert(datos).select().single();
    }
    const { data, error } = await consulta;
    if (error) throw new ErrorSistema(error);
    await this.recargar(tabla);
    return data as T;
  }

  /** Elimina una fila de un catálogo y refresca la lista */
  async eliminar(tabla: TablaCatalogo, valor: unknown, clave = 'id'): Promise<void> {
    const { error } = await this.supabase.cliente.from(tabla).delete().eq(clave, valor);
    if (error) throw new ErrorSistema(error);
    await this.recargar(tabla);
  }

  /** Nombre "Apellidos Nombres" de un docente */
  nombreDocente(id: number | null | undefined): string {
    if (!id) return '';
    const docente = this.mapaDocentes().get(id);
    return docente ? `${docente.apellidos} ${docente.nombres}` : `Docente #${id}`;
  }

  /** Código del ambiente (LAB-01…) */
  codigoAmbiente(id: number | null | undefined): string {
    if (!id) return '—';
    return this.mapaAmbientes().get(id)?.codigo ?? `#${id}`;
  }

  /** Ejecuta una consulta y devuelve sus filas o lanza error */
  private async leer<T>(consulta: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const { data, error } = await consulta;
    if (error) throw new ErrorSistema(error as { message: string });
    return (data ?? []) as T[];
  }
}
