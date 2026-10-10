import { inject, Injectable, signal } from '@angular/core';
import { Atencion, EstadoAtencion, FallaPc, FichaReparacion, HorarioTurno, PcBajaCierre, Perfil, ReporteTurno, RotacionSabado, SolicitudBaja, TareaReporte, TurnoCodigo, TurnoProgramado, TurnoTrabajo } from './modelos';
import { AuthService } from './auth.service';
import { ErrorSistema, SupabaseService } from './supabase.service';
import { comprimirFoto } from './fotos';
import { aMinutos, fechaActual } from './fechas';
import { environment } from '../../environments/environment';

/** Bucket privado de las fotos del cierre de turno */
const BUCKET_REPORTES = 'reportes-turno';

/**
 * Turno que corre a una hora 'HH:MM': entre los que la contienen, el que
 * empezó último (los turnos se solapan); si ninguno, el último que empezó.
 */
export function turnoDeLaHora(horarios: HorarioTurno[], hora: string): TurnoCodigo | null {
  const m = aMinutos(hora);
  const empezados = horarios.filter((h) => aMinutos(h.hora_inicio) <= m)
    .sort((a, b) => aMinutos(b.hora_inicio) - aMinutos(a.hora_inicio));
  const enCurso = empezados.find((h) => m < aMinutos(h.hora_fin));
  return (enCurso ?? empezados[0] ?? [...horarios].sort((a, b) => aMinutos(b.hora_inicio) - aMinutos(a.hora_inicio))[0])?.turno ?? null;
}

/** 85 -> '1 h 25 min' */
export function textoRetraso(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/**
 * Turno vigente y próximo de un auxiliar, según sus turnos programados.
 * `hoy` es 'YYYY-MM-DD' (hora de La Paz). Compara las fechas como texto.
 */
export function turnosDeHoy(programados: TurnoProgramado[], perfilId: string, hoy: string):
  { actual: TurnoProgramado | null; proximo: TurnoProgramado | null } {
  const mios = programados.filter((t) => t.perfil_id === perfilId).sort((a, b) => a.desde.localeCompare(b.desde));
  const actual = [...mios].reverse().find((t) => t.desde <= hoy) ?? null;
  const proximo = mios.find((t) => t.desde > hoy) ?? null;
  return { actual, proximo };
}

/**
 * Turno de un auxiliar en un día (igual que fn_turno_del_dia): el sábado,
 * si hay rotación cargada para esa fecha, vale el turno de la rotación
 * (o ninguno si no está en ella); si no, el de lunes a viernes.
 */
export function turnoDelDia(programados: TurnoProgramado[], rotacion: RotacionSabado[], perfilId: string, hoy: string):
  { turno: TurnoCodigo | null; sabado: boolean } {
  const delDia = new Date(hoy + 'T00:00:00').getDay() === 6 ? rotacion.filter((r) => r.fecha === hoy) : [];
  if (delDia.length) return { turno: delDia.find((r) => r.auxiliar_id === perfilId)?.turno ?? null, sabado: true };
  return { turno: turnosDeHoy(programados, perfilId, hoy).actual?.turno ?? null, sabado: false };
}

/** Columnas con relaciones embebidas para las atenciones */
const SELECT_ATENCION =
  '*, ambiente:ambientes(codigo), pc:ambiente_pcs(etiqueta), docente:docentes(nombres, apellidos), ' +
  'autor:perfiles!atenciones_auxiliar_id_fkey(nombre_completo, rol)';

/** Columnas con relaciones embebidas para el turno */
const SELECT_TURNO =
  '*, apertura:perfiles!turnos_trabajo_auxiliar_apertura_id_fkey(nombre_completo), ' +
  'cierre:perfiles!turnos_trabajo_auxiliar_cierre_id_fkey(nombre_completo)';

/** Columnas con relaciones embebidas para los reportes de turno */
const SELECT_TAREA =
  '*, ambiente:ambientes(codigo), ejecutor:perfiles!reporte_tareas_hecha_por_fkey(nombre_completo)';
const SELECT_REPORTE =
  `*, autor:perfiles!reportes_turno_auxiliar_id_fkey(nombre_completo), tareas:reporte_tareas(${SELECT_TAREA})`;

/** Filtros de la lista de atenciones / mantenimiento */
export interface FiltroOperacion {
  desde?: string;
  hasta?: string;
  estado?: string;
  ambienteId?: number | null;
  /** Tickets que registró o en los que colaboró este perfil */
  participante?: string;
}

/**
 * Operación de auxiliares: turno actual, pase de turno, atenciones y
 * mantenimiento. Mantiene en memoria el turno abierto y los pendientes.
 */
@Injectable({ providedIn: 'root' })
export class OperacionService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  /** Turno abierto ahora (null si no hay ninguno) */
  readonly turnoActual = signal<TurnoTrabajo | null>(null);
  /** Último turno cerrado (para el pase de turno) */
  readonly ultimoCerrado = signal<TurnoTrabajo | null>(null);
  /** Catálogo de fallas (se carga con cargarFallas) */
  readonly fallas = signal<FallaPc[]>([]);
  /** Hora de inicio y fin de cada turno (se cargan con cargarHorarios) */
  readonly horarios = signal<HorarioTurno[]>([]);
  /** Atenciones sin resolver que vienen arrastradas (pase de turno) */
  readonly pendientes = signal<Atencion[]>([]);
  readonly cargando = signal(false);

  private get cliente() {
    return this.supabase.cliente;
  }

  /** Refresca el turno actual, el último cerrado y los pendientes */
  async refrescar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [abierto, cerrado, pend] = await Promise.all([
        this.cliente.from('turnos_trabajo').select(SELECT_TURNO).eq('estado', 'abierto').maybeSingle(),
        this.cliente.from('turnos_trabajo').select(SELECT_TURNO).eq('estado', 'cerrado').order('cerrado_en', { ascending: false }).limit(1).maybeSingle(),
        this.cliente.from('atenciones').select(SELECT_ATENCION).in('estado', ['pendiente', 'en_proceso']).order('prioridad').order('creado_en'),
      ]);
      if (abierto.error) throw new ErrorSistema(abierto.error);
      if (cerrado.error) throw new ErrorSistema(cerrado.error);
      if (pend.error) throw new ErrorSistema(pend.error);
      this.turnoActual.set((abierto.data as unknown as TurnoTrabajo) ?? null);
      this.ultimoCerrado.set((cerrado.data as unknown as TurnoTrabajo) ?? null);
      this.pendientes.set((pend.data as unknown as Atencion[]) ?? []);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Abre un turno (falla si ya hay uno abierto, por el índice único) */
  async abrirTurno(turno: TurnoCodigo, esSabado: boolean, notas: string): Promise<void> {
    const { error } = await this.cliente.from('turnos_trabajo').insert({
      turno,
      es_sabado_rotativo: esSabado,
      notas_apertura: notas.trim() || null,
      auxiliar_apertura_id: this.auth.perfil()?.id,
    });
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
  }

  /** Cierra el turno dejando la nota de pase */
  async cerrarTurno(id: number, notas: string): Promise<void> {
    const { error } = await this.cliente.from('turnos_trabajo').update({
      estado: 'cerrado',
      cerrado_en: new Date().toISOString(),
      auxiliar_cierre_id: this.auth.perfil()?.id,
      notas_cierre: notas.trim() || null,
    }).eq('id', id);
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
  }

  // ----- Atenciones -----

  /** Lista de atenciones con filtros (para reportes) */
  async listarAtenciones(filtro: FiltroOperacion = {}): Promise<Atencion[]> {
    let q = this.cliente.from('atenciones').select(SELECT_ATENCION).order('creado_en', { ascending: false });
    if (filtro.desde) q = q.gte('creado_en', filtro.desde);
    if (filtro.hasta) q = q.lte('creado_en', `${filtro.hasta}T23:59:59`);
    if (filtro.estado) q = q.eq('estado', filtro.estado);
    if (filtro.ambienteId) q = q.eq('ambiente_id', filtro.ambienteId);
    if (filtro.participante) q = q.or(`auxiliar_id.eq.${filtro.participante},colaboradores.cs.{${filtro.participante}}`);
    const { data, error } = await q;
    if (error) throw new ErrorSistema(error);
    return (data as unknown as Atencion[]) ?? [];
  }

  /** Crea o actualiza una atención */
  async guardarAtencion(fila: Partial<Atencion>): Promise<void> {
    const datos = { ...fila } as Record<string, unknown>;
    const id = datos['id'];
    delete datos['id'];
    // No persistir relaciones embebidas
    for (const k of ['ambiente', 'pc', 'docente', 'autor']) delete datos[k];
    const consulta = id
      ? this.cliente.from('atenciones').update(datos).eq('id', id)
      : this.cliente.from('atenciones').insert(datos);
    const { error } = await consulta;
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
  }

  /** Crea varios tickets de una vez (una tarea hecha en varias PCs) */
  /** Crea tickets y devuelve su id y PC */
  async crearAtenciones(filas: Partial<Atencion>[]): Promise<{ id: number; pc_id: number | null }[]> {
    if (!filas.length) return [];
    const { data, error } = await this.cliente.from('atenciones').insert(filas).select('id, pc_id');
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
    return (data ?? []) as { id: number; pc_id: number | null }[];
  }

  /** Cambia el estado de PCs (ticket = false si ya queda registrado en otro ticket, ej. un correctivo) */
  async cambiarEstadoPcs(ids: number[], estado: string, detalle: string, ticket = true): Promise<void> {
    if (!ids.length) return;
    await this.supabase.rpc('rpc_cambiar_estado_pcs', { p_ids: ids, p_estado: estado, p_detalle: detalle, p_ticket: ticket });
  }

  // ----- Fichas de reparación -----

  /** Catálogo de fallas (todas; la ficha muestra solo las activas) */
  async cargarFallas(): Promise<FallaPc[]> {
    const { data, error } = await this.cliente.from('fallas_pc').select('*').order('orden').order('nombre');
    if (error) throw new ErrorSistema(error);
    const lista = (data as FallaPc[]) ?? [];
    this.fallas.set(lista);
    return lista;
  }

  /** Agrega una falla al catálogo (admin y encargado) */
  async agregarFalla(nombre: string, categoria: FallaPc['categoria']): Promise<void> {
    const orden = Math.max(0, ...this.fallas().filter((f) => f.categoria === categoria).map((f) => f.orden)) + 1;
    const { error } = await this.cliente.from('fallas_pc').insert({ nombre: nombre.trim(), categoria, orden });
    if (error) throw new ErrorSistema(error);
    await this.cargarFallas();
  }

  async actualizarFalla(id: number, cambios: Partial<Pick<FallaPc, 'nombre' | 'categoria' | 'activo'>>): Promise<void> {
    const { error } = await this.cliente.from('fallas_pc').update(cambios).eq('id', id);
    if (error) throw new ErrorSistema(error);
    await this.cargarFallas();
  }

  /** Guarda las fichas: un ticket correctivo por PC y su cambio de estado */
  async registrarReparaciones(fichas: FichaReparacion[], colaboradores: string[] = [], prioridad = 2): Promise<number> {
    const n = await this.supabase.rpc<number>('rpc_registrar_reparaciones', {
      p_fichas: fichas, p_colaboradores: colaboradores, p_prioridad: prioridad,
    });
    await this.refrescar();
    return n;
  }

  /** Solicitudes de baja pendientes (las resuelve admin/encargado) */
  async solicitudesBaja(): Promise<SolicitudBaja[]> {
    const { data, error } = await this.cliente.from('solicitudes_baja')
      .select('*, pc:ambiente_pcs(etiqueta, ambiente:ambientes(codigo)), autor:perfiles!solicitudes_baja_solicitado_por_fkey(nombre_completo)')
      .eq('estado', 'pendiente').order('solicitado_en');
    if (error) throw new ErrorSistema(error);
    return (data as unknown as SolicitudBaja[]) ?? [];
  }

  /** Pide la baja de PCs (si ya hay una pendiente para esa PC, no se repite) */
  async solicitarBaja(pcIds: number[], motivo: string, atencionPorPc: Map<number, number> = new Map()): Promise<void> {
    const pendientes = new Set((await this.solicitudesBaja()).map((s) => s.pc_id));
    const filas = pcIds.filter((id) => !pendientes.has(id))
      .map((pc_id) => ({ pc_id, motivo, atencion_id: atencionPorPc.get(pc_id) ?? null }));
    if (!filas.length) return;
    const { error } = await this.cliente.from('solicitudes_baja').insert(filas);
    if (error) throw new ErrorSistema(error);
  }

  async resolverBaja(id: number, aprobar: boolean, respuesta: string | null): Promise<void> {
    await this.supabase.rpc('rpc_resolver_baja', { p_id: id, p_aprobar: aprobar, p_respuesta: respuesta });
  }

  /** Aplica los mismos cambios a varios tickets */
  async actualizarAtenciones(ids: number[], cambios: Partial<Atencion>): Promise<void> {
    if (!ids.length) return;
    const { error } = await this.cliente.from('atenciones').update(cambios).in('id', ids);
    if (error) throw new ErrorSistema(error);
  }

  /** Cambia el estado de varios tickets (ej. todo un lote) */
  async cambiarEstadoAtenciones(ids: number[], estado: EstadoAtencion): Promise<void> {
    const resuelto = estado === 'resuelto';
    const { error } = await this.cliente.from('atenciones').update({
      estado,
      resuelto_por: resuelto ? this.auth.perfil()?.id : null,
      resuelto_en: resuelto ? new Date().toISOString() : null,
    }).in('id', ids);
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
  }

  async eliminarAtenciones(ids: number[]): Promise<void> {
    const { error } = await this.cliente.from('atenciones').delete().in('id', ids);
    if (error) throw new ErrorSistema(error);
    await this.refrescar();
  }

  /** Cambia el estado de una atención (resuelta marca autor y fecha) */
  async cambiarEstadoAtencion(a: Atencion, estado: EstadoAtencion): Promise<void> {
    await this.cambiarEstadoAtenciones([a.id], estado);
  }

  async eliminarAtencion(id: number): Promise<void> {
    await this.eliminarAtenciones([id]);
  }

  // ----- Reporte de turno -----

  /** Últimos reportes de turno con sus tareas */
  async listarReportes(limite = 15): Promise<ReporteTurno[]> {
    const { data, error } = await this.cliente.from('reportes_turno').select(SELECT_REPORTE)
      .order('creado_en', { ascending: false }).limit(limite);
    if (error) throw new ErrorSistema(error);
    return (data as unknown as ReporteTurno[]) ?? [];
  }

  /** Tareas que ningún turno marcó como hechas todavía (las más viejas primero) */
  async tareasPendientes(): Promise<TareaReporte[]> {
    const { data, error } = await this.cliente.from('reporte_tareas')
      .select(`${SELECT_TAREA}, reporte:reportes_turno(turno, fecha, autor:perfiles!reportes_turno_auxiliar_id_fkey(nombre_completo))`)
      .eq('hecha', false).order('creado_en');
    if (error) throw new ErrorSistema(error);
    return (data as unknown as TareaReporte[]) ?? [];
  }

  /** Guarda el reporte del turno, su foto (opcional) y sus tareas pendientes */
  async crearReporte(turno: TurnoCodigo, novedades: string, tareas: { descripcion: string; ambiente_id: number | null }[],
    foto: File | null = null): Promise<void> {
    const foto_path = foto ? await this.subirFotoReporte(foto) : null;
    const { data, error } = await this.cliente.from('reportes_turno')
      .insert({ turno, novedades: novedades.trim() || null, auxiliar_id: this.auth.perfil()?.id, foto_path })
      .select('id').single();
    if (error) {
      // Que no quede la foto suelta si el reporte no se guardó
      if (foto_path) await this.cliente.storage.from(BUCKET_REPORTES).remove([foto_path]);
      throw new ErrorSistema(error);
    }
    if (!tareas.length) return;
    const filas = tareas.map((t) => ({ reporte_id: data.id, descripcion: t.descripcion, ambiente_id: t.ambiente_id }));
    const r = await this.cliente.from('reporte_tareas').insert(filas);
    if (r.error) throw new ErrorSistema(r.error);
  }

  /** PCs que el usuario dio de baja desde un momento (las que saldrán en su cierre) */
  async misBajasDesde(desde: string): Promise<PcBajaCierre[]> {
    const id = this.auth.perfil()?.id;
    if (!id) return [];
    const { data, error } = await this.cliente.from('ambiente_pcs')
      .select('etiqueta, motivo_baja, estado_detalle, estado_en, ambiente:ambientes(codigo)')
      .eq('estado', 'baja').eq('estado_por', id).gte('estado_en', desde).order('estado_en');
    if (error) throw new ErrorSistema(error);
    type Fila = { etiqueta: string; motivo_baja: string | null; estado_detalle: string | null; estado_en: string; ambiente: { codigo: string } | null };
    return ((data ?? []) as unknown as Fila[]).map((p) => ({
      etiqueta: p.etiqueta, lab: p.ambiente?.codigo ?? null, motivo: p.motivo_baja ?? p.estado_detalle, en: p.estado_en,
    }));
  }

  /** Comprime y sube la foto del cierre; devuelve la ruta en el bucket */
  private async subirFotoReporte(archivo: File): Promise<string> {
    const blob = await comprimirFoto(archivo);
    const ruta = `${fechaActual(environment.zonaHoraria).slice(0, 7)}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.cliente.storage.from(BUCKET_REPORTES).upload(ruta, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
    return ruta;
  }

  /** Enlaces temporales (1 hora) de las fotos de cierre: ruta -> url */
  async firmarFotosReporte(rutas: string[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    if (!rutas.length) return mapa;
    const { data } = await this.cliente.storage.from(BUCKET_REPORTES).createSignedUrls(rutas, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
    return mapa;
  }

  /** Borra las fotos de cierre vencidas (después de las 12:00); la descripción se queda */
  async limpiarFotosReporte(): Promise<void> {
    const { data, error } = await this.cliente.rpc('fn_limpiar_fotos_reporte');
    if (error) throw new ErrorSistema(error);
    const rutas = (data ?? []) as string[];
    if (rutas.length) await this.cliente.storage.from(BUCKET_REPORTES).remove(rutas);
  }

  /** Marca (o desmarca) una tarea como hecha */
  async marcarTarea(id: number, hecha: boolean): Promise<void> {
    const { error } = await this.cliente.from('reporte_tareas').update({
      hecha,
      hecha_por: hecha ? this.auth.perfil()?.id : null,
      hecha_en: hecha ? new Date().toISOString() : null,
    }).eq('id', id);
    if (error) throw new ErrorSistema(error);
  }

  /**
   * Edita un reporte: turno, novedades y sus tareas pendientes (cambia las
   * existentes, agrega las nuevas y quita las que se borraron). Las tareas
   * hechas no se tocan.
   */
  async actualizarReporte(r: ReporteTurno, turno: TurnoCodigo, novedades: string,
    tareas: { id?: number; descripcion: string; ambiente_id: number | null }[]): Promise<void> {
    const { error } = await this.cliente.from('reportes_turno').update({ turno, novedades: novedades.trim() || null }).eq('id', r.id);
    if (error) throw new ErrorSistema(error);
    const pendientes = (r.tareas ?? []).filter((t) => !t.hecha);
    const quedan = new Set(tareas.map((t) => t.id).filter((id): id is number => !!id));
    const borrar = pendientes.filter((t) => !quedan.has(t.id)).map((t) => t.id);
    if (borrar.length) {
      const b = await this.cliente.from('reporte_tareas').delete().in('id', borrar);
      if (b.error) throw new ErrorSistema(b.error);
    }
    for (const t of tareas.filter((x) => x.id)) {
      const antes = pendientes.find((p) => p.id === t.id);
      if (antes && (antes.descripcion !== t.descripcion || antes.ambiente_id !== t.ambiente_id)) {
        const u = await this.cliente.from('reporte_tareas').update({ descripcion: t.descripcion, ambiente_id: t.ambiente_id }).eq('id', t.id!);
        if (u.error) throw new ErrorSistema(u.error);
      }
    }
    const nuevas = tareas.filter((t) => !t.id).map((t) => ({ reporte_id: r.id, descripcion: t.descripcion, ambiente_id: t.ambiente_id }));
    if (nuevas.length) {
      const n = await this.cliente.from('reporte_tareas').insert(nuevas);
      if (n.error) throw new ErrorSistema(n.error);
    }
  }

  async eliminarReporte(id: number): Promise<void> {
    const { error } = await this.cliente.from('reportes_turno').delete().eq('id', id);
    if (error) throw new ErrorSistema(error);
  }

  // ----- Auxiliares y rotación -----

  /** Auxiliares y encargados de auxiliares (también rotan) para el apartado Auxiliares */
  async listarAuxiliares(): Promise<Perfil[]> {
    const { data, error } = await this.cliente.from('perfiles').select('*').in('rol', ['auxiliar', 'encargado']).order('nombre_completo');
    if (error) throw new ErrorSistema(error);
    return (data as Perfil[]) ?? [];
  }

  /** Personal de operación activo (auxiliares y encargados), para elegir colaboradores */
  async listarPersonalOperacion(): Promise<Perfil[]> {
    const { data, error } = await this.cliente.from('perfiles').select('*')
      .in('rol', ['auxiliar', 'encargado']).eq('activo', true).order('nombre_completo');
    if (error) throw new ErrorSistema(error);
    return (data as Perfil[]) ?? [];
  }

  /** Asigna turno habitual y sábado rotativo (admin/encargado) vía función segura */
  async asignarTurno(usuarioId: string, turno: TurnoCodigo | null, sabado: boolean): Promise<void> {
    await this.supabase.rpc('fn_asignar_turno', { p_usuario: usuarioId, p_turno: turno, p_sabado: sabado });
  }

  /** Rotación de sábados ordenada por fecha */
  async listarRotacion(): Promise<RotacionSabado[]> {
    const { data, error } = await this.cliente.from('rotacion_sabados')
      .select('*, auxiliar:perfiles(nombre_completo)').order('fecha', { ascending: false });
    if (error) throw new ErrorSistema(error);
    return (data as unknown as RotacionSabado[]) ?? [];
  }

  /** Pone a uno o varios auxiliares en un sábado (si ya estaban ese sábado, cambia su turno y nota) */
  async guardarRotacion(filas: Pick<RotacionSabado, 'fecha' | 'auxiliar_id' | 'turno' | 'nota'>[]): Promise<void> {
    if (!filas.length) return;
    const { error } = await this.cliente.from('rotacion_sabados').upsert(filas, { onConflict: 'fecha,auxiliar_id' });
    if (error) throw new ErrorSistema(error);
  }

  /** Horario de cada turno, en orden de inicio */
  async cargarHorarios(): Promise<HorarioTurno[]> {
    const { data, error } = await this.cliente.from('horarios_turno').select('turno, hora_inicio, hora_fin').order('hora_inicio');
    if (error) throw new ErrorSistema(error);
    const lista = (data as HorarioTurno[]) ?? [];
    this.horarios.set(lista);
    return lista;
  }

  /** Cambia el horario de los turnos (admin y encargado) */
  async guardarHorarios(lista: HorarioTurno[]): Promise<void> {
    for (const h of lista) {
      const { error } = await this.cliente.from('horarios_turno')
        .update({ hora_inicio: h.hora_inicio, hora_fin: h.hora_fin }).eq('turno', h.turno);
      if (error) throw new ErrorSistema(error);
    }
    await this.cargarHorarios();
  }

  /** Turnos programados de todos los auxiliares (más recientes primero) */
  async listarTurnosProgramados(): Promise<TurnoProgramado[]> {
    const { data, error } = await this.cliente.from('turnos_programados')
      .select('*, perfil:perfiles!turnos_programados_perfil_id_fkey(nombre_completo)').order('desde', { ascending: false });
    if (error) throw new ErrorSistema(error);
    return (data as unknown as TurnoProgramado[]) ?? [];
  }

  /** Programa turnos de varios auxiliares desde una fecha (si ya existe esa fecha, la cambia) */
  async programarTurnos(filas: { perfil_id: string; turno: TurnoCodigo }[], desde: string): Promise<void> {
    if (!filas.length) return;
    const { error } = await this.cliente.from('turnos_programados')
      .upsert(filas.map((f) => ({ ...f, desde })), { onConflict: 'perfil_id,desde' });
    if (error) throw new ErrorSistema(error);
  }

  async eliminarTurnoProgramado(id: number): Promise<void> {
    const { error } = await this.cliente.from('turnos_programados').delete().eq('id', id);
    if (error) throw new ErrorSistema(error);
  }

  async eliminarRotacion(id: number): Promise<void> {
    const { error } = await this.cliente.from('rotacion_sabados').delete().eq('id', id);
    if (error) throw new ErrorSistema(error);
  }
}
