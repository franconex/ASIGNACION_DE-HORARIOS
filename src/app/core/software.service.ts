import { computed, inject, Injectable, signal } from '@angular/core';
import { LicenciaSoftware, Software, TipoSoftware } from './modelos';
import { ErrorSistema, SupabaseService } from './supabase.service';

/** Tipos de licencia: texto y color */
export const LICENCIAS: Record<LicenciaSoftware, { texto: string; clase: string }> = {
  gratuita: { texto: 'Gratuita', clase: 'bg-emerald-100 text-emerald-700' },
  educativa: { texto: 'Educativa', clase: 'bg-sky-100 text-sky-700' },
  suscripcion: { texto: 'Suscripción', clase: 'bg-indigo-100 text-indigo-700' },
  comercial: { texto: 'Comercial', clase: 'bg-violet-100 text-violet-700' },
  sin_licencia: { texto: 'Sin licencia', clase: 'bg-rose-100 text-rose-700' },
  por_verificar: { texto: 'Por verificar', clase: 'bg-amber-100 text-amber-800' },
};

export const TIPOS_SOFTWARE: Record<TipoSoftware, string> = { programa: 'Programa', iso: 'Sistema operativo / ISO' };

/** Ticket que tocó software (programas o pedido de docente), para el historial */
export interface MovimientoSoftware {
  id: number;
  lote: string | null;
  creado_en: string;
  tipo: 'programas' | 'docente';
  detalles: { accion?: string; pedido?: string; software_ids?: number[]; programas?: string };
  solicitante: string | null;
  ambiente: { codigo: string } | null;
  docente: { nombres: string; apellidos: string } | null;
  autor: { nombre_completo: string } | null;
}

/**
 * Catálogo de software: la lista de programas e ISOs que se manejan en los
 * laboratorios. En los tickets se busca y se marca; si no está, se agrega.
 */
@Injectable({ providedIn: 'root' })
export class SoftwareService {
  private readonly cliente = inject(SupabaseService).cliente;

  readonly software = signal<Software[]>([]);
  readonly cargado = signal(false);

  readonly activos = computed(() => this.software().filter((s) => s.activo));
  readonly mapa = computed(() => new Map(this.software().map((s) => [s.id, s])));

  async cargar(): Promise<void> {
    const { data, error } = await this.cliente.from('software').select('*').order('nombre');
    if (error) throw new ErrorSistema(error);
    this.software.set((data as Software[]) ?? []);
    this.cargado.set(true);
  }

  /** Carga solo la primera vez */
  async asegurar(): Promise<void> {
    if (!this.cargado()) await this.cargar();
  }

  async guardar(datos: Partial<Software>): Promise<Software> {
    const { id, ...resto } = datos;
    const consulta = id
      ? this.cliente.from('software').update(resto).eq('id', id).select().single()
      : this.cliente.from('software').insert(resto).select().single();
    const { data, error } = await consulta;
    if (error) {
      if (error.code === '23505') throw new Error('Ya existe un software con ese nombre.');
      throw new ErrorSistema(error);
    }
    await this.cargar();
    return data as Software;
  }

  /** Tickets que eligieron software del catálogo (los más recientes primero; uno por lote) */
  async movimientos(desde: string | null): Promise<MovimientoSoftware[]> {
    let q = this.cliente.from('atenciones')
      .select('id, lote, creado_en, tipo, detalles, solicitante, ambiente:ambientes(codigo), docente:docentes(nombres, apellidos), ' +
              'autor:perfiles!atenciones_auxiliar_id_fkey(nombre_completo)')
      .in('tipo', ['programas', 'docente'])
      .not('detalles->software_ids', 'is', null)
      .order('creado_en', { ascending: false })
      .limit(1000);
    if (desde) q = q.gte('creado_en', desde);
    const { data, error } = await q;
    if (error) throw new ErrorSistema(error);
    const vistos = new Set<string>();
    return ((data as unknown as MovimientoSoftware[]) ?? []).filter((m) => {
      const clave = m.lote ?? String(m.id);
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }
}
