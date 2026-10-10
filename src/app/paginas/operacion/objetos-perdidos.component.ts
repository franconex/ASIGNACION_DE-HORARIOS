import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { normalizar } from '../../compartido/buscador.component';
import { IconoComponent } from '../../compartido/icono.component';
import { ModalComponent } from '../../compartido/modal.component';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { fechaActual, horaActual } from '../../core/fechas';
import { comprimirFoto } from '../../core/fotos';
import { ObjetoPerdido } from '../../core/modelos';
import { NotificacionesService } from '../../core/notificaciones.service';
import { ConfirmacionService } from '../../core/confirmacion.service';
import { ErrorSistema, SupabaseService } from '../../core/supabase.service';

const BUCKET = 'objetos-perdidos';
const SELECT_OBJETO =
  '*, ambiente:ambientes(codigo, color), encontro:perfiles!objetos_perdidos_encontrado_por_fkey(nombre_completo), ' +
  'entrego:perfiles!objetos_perdidos_entregado_por_fkey(nombre_completo)';
/** Nombres frecuentes para elegir con un toque */
const SUGERENCIAS = [
  'Celular', 'Cargador', 'Memoria USB', 'Mochila', 'Billetera', 'Audífonos', 'Llaves', 'Carnet / credencial',
  'Lentes', 'Cuaderno', 'Calculadora', 'Mouse', 'Botella / termo', 'Chamarra', 'Paraguas',
];
/** La Paz no tiene horario de verano: siempre UTC-4 */
const DESFASE_LA_PAZ = '-04:00';

interface FormRegistro { nombre: string; descripcion: string; ambienteId: number | null; fechaHora: string; foto: File | null; vista: string | null }
interface FormEntrega { objeto: ObjetoPerdido; entregadoA: string; documento: string; observacion: string; foto: File | null; vista: string | null }

/**
 * Objetos perdidos: se registra lo encontrado (nombre, laboratorio, fecha y
 * hora, foto) y, al devolverlo, a quién se entregó con la foto de la entrega.
 * Las fotos se guardan en un bucket privado y se ven con enlaces temporales.
 */
@Component({
  selector: 'app-objetos-perdidos',
  imports: [FormsModule, IconoComponent, ModalComponent, DatePipe],
  template: `
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Objetos perdidos</h1>
        <p class="mt-0.5 text-sm text-slate-600">Registra lo encontrado en los laboratorios con su foto, y la entrega a su dueño con otra foto.</p>
      </div>
      @if (auth.puedeOperar()) {
        <button class="btn-primario" (click)="nuevo()"><app-icono nombre="agregar" [tamano]="16" /> Registrar objeto</button>
      }
    </header>

    <div class="mb-3 flex flex-wrap items-end gap-2">
      <div class="flex rounded-lg bg-slate-100 p-0.5">
        @for (f of filtros; track f.valor) {
          <button type="button" class="rounded-md px-3 py-1 text-sm font-medium transition"
                  [class]="filtroEstado() === f.valor ? 'bg-superficie text-marca-700 shadow-sm' : 'text-slate-500'"
                  (click)="filtroEstado.set(f.valor)">{{ f.texto }} <span class="text-xs text-slate-400">{{ cuenta(f.valor) }}</span></button>
        }
      </div>
      <select class="campo !w-36 !py-1.5" [ngModel]="filtroLab()" (ngModelChange)="filtroLab.set($event)" aria-label="Laboratorio">
        <option [ngValue]="null">Todos los labs</option>
        @for (lab of catalogos.laboratorios(); track lab.id) { <option [ngValue]="lab.id">{{ lab.codigo }}</option> }
      </select>
      <div class="relative min-w-52 flex-1">
        <app-icono nombre="buscar" [tamano]="16" class="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input maxlength="60" class="campo !pl-9" placeholder="Buscar objeto o persona…" [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)">
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      @for (o of filtrados(); track o.id) {
        <article class="tarjeta flex flex-col overflow-hidden">
          <button type="button" class="relative block aspect-[4/3] w-full bg-slate-100" (click)="verFoto(o.foto_path, o.nombre)" [attr.aria-label]="'Ver foto de ' + o.nombre">
            @if (o.foto_path && urls().get(o.foto_path); as url) {
              <img [src]="url" [alt]="o.nombre" class="h-full w-full object-cover" loading="lazy">
            } @else if (o.fotos_borradas_en) {
              <span class="flex h-full flex-col items-center justify-center gap-1 text-xs text-slate-400">
                <app-icono nombre="camara" [tamano]="24" /> Foto borrada (más de 9 meses)
              </span>
            } @else {
              <span class="flex h-full items-center justify-center text-slate-400"><app-icono nombre="camara" [tamano]="28" /></span>
            }
            <span class="chip absolute top-2 left-2" [class]="o.estado === 'entregado' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'">
              {{ o.estado === 'entregado' ? 'Entregado' : 'En custodia' }}
            </span>
          </button>
          <div class="flex flex-1 flex-col gap-1 p-3">
            <p class="font-semibold">{{ o.nombre }}</p>
            @if (o.descripcion) { <p class="text-sm text-slate-600">{{ o.descripcion }}</p> }
            <p class="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span class="inline-flex items-center gap-1 font-semibold text-slate-700"><span class="h-2 w-2 rounded-full" [style.background]="o.ambiente?.color"></span>{{ o.ambiente?.codigo }}</span>
              <span>Encontrado {{ o.encontrado_en | date: 'dd/MM/yyyy HH:mm' }}</span>
              @if (o.encontro?.nombre_completo) { <span>por {{ o.encontro?.nombre_completo }}</span> }
            </p>

            @if (o.estado === 'entregado') {
              <div class="mt-2 flex gap-2 rounded-lg bg-emerald-50 p-2">
                @if (o.foto_entrega_path) {
                  <button type="button" class="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-200" (click)="verFoto(o.foto_entrega_path, 'Entrega de ' + o.nombre)" aria-label="Ver foto de la entrega">
                    @if (urls().get(o.foto_entrega_path); as url) { <img [src]="url" alt="Foto de la entrega" class="h-full w-full object-cover" loading="lazy"> }
                  </button>
                }
                <div class="text-xs text-emerald-900">
                  <p>Entregado a <b>{{ o.entregado_a }}</b>{{ o.entregado_documento ? ' (CI ' + o.entregado_documento + ')' : '' }}</p>
                  <p>{{ o.entregado_en | date: 'dd/MM/yyyy HH:mm' }}{{ o.entrego?.nombre_completo ? ' · por ' + o.entrego?.nombre_completo : '' }}</p>
                  @if (o.observacion_entrega) { <p class="text-emerald-800">{{ o.observacion_entrega }}</p> }
                </div>
              </div>
            }

            <div class="mt-auto flex justify-end gap-1 pt-2">
              @if (o.estado === 'en_custodia' && auth.puedeOperar()) {
                <button class="btn-primario btn-sm" (click)="abrirEntrega(o)"><app-icono nombre="entregar" [tamano]="15" /> Entregar</button>
              }
              @if (auth.puedeGestionarAuxiliares()) {
                <button class="btn-fantasma btn-sm text-red-600" (click)="eliminar(o)" title="Eliminar"><app-icono nombre="eliminar" [tamano]="15" /></button>
              }
            </div>
          </div>
        </article>
      } @empty {
        <p class="tarjeta py-10 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
          {{ cargando() ? 'Cargando…' : 'No hay objetos con esos filtros.' }}
        </p>
      }
    </div>

    <!-- REGISTRAR -->
    <app-modal [abierto]="!!registro()" titulo="Registrar objeto perdido" ancho="md" (cerrar)="registro.set(null)">
      @if (registro(); as f) {
        <form class="space-y-3" id="form-objeto" (ngSubmit)="guardarRegistro()">
          <div>
            <label class="etiqueta" for="obj-nombre">¿Qué se encontró? *</label>
            <input id="obj-nombre" class="campo" maxlength="120" [(ngModel)]="f.nombre" name="nombre" placeholder="Ej: Celular">
            <div class="mt-1.5 flex flex-wrap gap-1">
              @for (s of sugerencias; track s) {
                <button type="button" class="rounded-full border px-2.5 py-0.5 text-xs transition"
                        [class]="f.nombre === s ? 'border-marca-500 bg-marca-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100'"
                        (click)="f.nombre = s">{{ s }}</button>
              }
            </div>
          </div>
          <div>
            <label class="etiqueta" for="obj-desc">Descripción <span class="font-normal text-slate-400">(color, marca, señas)</span></label>
            <input id="obj-desc" class="campo" maxlength="500" [(ngModel)]="f.descripcion" name="descripcion" placeholder="Ej: Samsung negro con funda azul">
          </div>
          <div>
            <label class="etiqueta">Laboratorio donde se encontró *</label>
            <div class="flex flex-wrap gap-1.5">
              @for (lab of catalogos.laboratorios(); track lab.id) {
                <button type="button" class="rounded-lg border-2 px-3 py-1 text-sm font-semibold transition"
                        [class]="f.ambienteId === lab.id ? 'border-marca-500 bg-marca-50 text-marca-700' : 'border-slate-200 hover:border-slate-300'"
                        [style.border-left]="'5px solid ' + lab.color" (click)="f.ambienteId = lab.id">{{ lab.codigo }}</button>
              }
            </div>
          </div>
          <div>
            <label class="etiqueta" for="obj-fecha">Fecha y hora *</label>
            <input id="obj-fecha" type="datetime-local" class="campo !w-60" [(ngModel)]="f.fechaHora" name="fechaHora" [max]="ahora()">
          </div>
          <div>
            <label class="etiqueta">Foto del objeto *</label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 p-3 hover:border-marca-400">
              @if (f.vista) {
                <img [src]="f.vista" alt="Vista previa" class="h-20 w-20 rounded-md object-cover">
                <span class="text-sm text-slate-600">Toca para cambiar la foto</span>
              } @else {
                <span class="flex h-20 w-20 items-center justify-center rounded-md bg-slate-100 text-slate-400"><app-icono nombre="camara" [tamano]="26" /></span>
                <span class="text-sm text-slate-600">Tomar o elegir foto</span>
              }
              <input type="file" accept="image/*" capture="environment" class="sr-only" (change)="elegirFoto($event, 'registro')">
            </label>
          </div>
        </form>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="registro.set(null)">Cancelar</button>
        <button class="btn-primario" type="submit" form="form-objeto" [disabled]="guardando()">{{ guardando() ? 'Subiendo…' : 'Registrar' }}</button>
      </ng-container>
    </app-modal>

    <!-- ENTREGAR -->
    <app-modal [abierto]="!!entrega()" [titulo]="'Entregar: ' + (entrega()?.objeto?.nombre ?? '')" ancho="md" (cerrar)="entrega.set(null)">
      @if (entrega(); as f) {
        <form class="space-y-3" id="form-entrega" (ngSubmit)="guardarEntrega()">
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="etiqueta" for="ent-nombre">Entregado a *</label>
              <input id="ent-nombre" class="campo" maxlength="120" [(ngModel)]="f.entregadoA" name="entregadoA" placeholder="Nombre y apellido">
            </div>
            <div>
              <label class="etiqueta" for="ent-ci">CI / carnet <span class="font-normal text-slate-400">(opcional)</span></label>
              <input id="ent-ci" class="campo" maxlength="30" [(ngModel)]="f.documento" name="documento" placeholder="Ej: 1234567">
            </div>
          </div>
          <div>
            <label class="etiqueta" for="ent-obs">Observación</label>
            <input id="ent-obs" class="campo" maxlength="300" [(ngModel)]="f.observacion" name="observacion" placeholder="Ej: describió el fondo de pantalla">
          </div>
          <div>
            <label class="etiqueta">Foto de la entrega *</label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 p-3 hover:border-marca-400">
              @if (f.vista) {
                <img [src]="f.vista" alt="Vista previa" class="h-20 w-20 rounded-md object-cover">
                <span class="text-sm text-slate-600">Toca para cambiar la foto</span>
              } @else {
                <span class="flex h-20 w-20 items-center justify-center rounded-md bg-slate-100 text-slate-400"><app-icono nombre="camara" [tamano]="26" /></span>
                <span class="text-sm text-slate-600">Foto de la persona recibiendo el objeto</span>
              }
              <input type="file" accept="image/*" capture="environment" class="sr-only" (change)="elegirFoto($event, 'entrega')">
            </label>
          </div>
          <p class="text-xs text-slate-500">La fecha, la hora y quién entrega se guardan solos.</p>
        </form>
      }
      <ng-container pie>
        <button class="btn-secundario" (click)="entrega.set(null)">Cancelar</button>
        <button class="btn-primario" type="submit" form="form-entrega" [disabled]="guardando()">{{ guardando() ? 'Subiendo…' : 'Confirmar entrega' }}</button>
      </ng-container>
    </app-modal>

    <!-- FOTO GRANDE -->
    <app-modal [abierto]="!!fotoGrande()" [titulo]="fotoGrande()?.titulo ?? ''" ancho="lg" (cerrar)="fotoGrande.set(null)">
      @if (fotoGrande(); as f) {
        <img [src]="f.url" [alt]="f.titulo" class="mx-auto max-h-[70vh] rounded-lg object-contain">
      }
    </app-modal>
  `,
})
export class ObjetosPerdidosComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly catalogos = inject(CatalogosService);
  private readonly supabase = inject(SupabaseService);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly confirmacion = inject(ConfirmacionService);

  protected readonly sugerencias = SUGERENCIAS;
  protected readonly filtros: { valor: 'en_custodia' | 'entregado' | null; texto: string }[] = [
    { valor: 'en_custodia', texto: 'En custodia' }, { valor: 'entregado', texto: 'Entregados' }, { valor: null, texto: 'Todos' },
  ];

  protected readonly objetos = signal<ObjetoPerdido[]>([]);
  /** Enlaces temporales de las fotos (ruta -> url) */
  protected readonly urls = signal<Map<string, string>>(new Map());
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly filtroEstado = signal<'en_custodia' | 'entregado' | null>('en_custodia');
  protected readonly filtroLab = signal<number | null>(null);
  protected readonly busqueda = signal('');
  protected readonly registro = signal<FormRegistro | null>(null);
  protected readonly entrega = signal<FormEntrega | null>(null);
  protected readonly fotoGrande = signal<{ url: string; titulo: string } | null>(null);

  protected readonly filtrados = computed(() => {
    const texto = normalizar(this.busqueda().trim());
    return this.objetos().filter((o) =>
      (!this.filtroEstado() || o.estado === this.filtroEstado()) &&
      (!this.filtroLab() || o.ambiente_id === this.filtroLab()) &&
      (!texto || normalizar(`${o.nombre} ${o.descripcion ?? ''} ${o.entregado_a ?? ''}`).includes(texto)));
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected cuenta(estado: 'en_custodia' | 'entregado' | null): number {
    return this.objetos().filter((o) => !estado || o.estado === estado).length;
  }

  /** "AAAA-MM-DDTHH:mm" de ahora en La Paz (para el campo fecha y hora) */
  protected ahora(): string {
    return `${fechaActual(environment.zonaHoraria)}T${horaActual(environment.zonaHoraria)}`;
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    await this.limpiarFotosViejas().catch((e) => console.error(e));
    try {
      const { data, error } = await this.supabase.cliente.from('objetos_perdidos').select(SELECT_OBJETO)
        .order('encontrado_en', { ascending: false }).limit(300);
      if (error) throw new ErrorSistema(error);
      const lista = (data ?? []) as unknown as ObjetoPerdido[];
      this.objetos.set(lista);
      await this.firmarFotos(lista.flatMap((o) => [o.foto_path, o.foto_entrega_path]).filter((p): p is string => !!p));
    } catch (e) {
      this.notificaciones.error(e, 'No se cargaron los objetos');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Borra las fotos de más de 9 meses (el registro se queda); si falla, se reintenta la próxima vez */
  private async limpiarFotosViejas(): Promise<void> {
    const { data, error } = await this.supabase.cliente.rpc('fn_limpiar_fotos_objetos');
    if (error) throw new ErrorSistema(error);
    const rutas = (data ?? []) as string[];
    if (rutas.length) await this.supabase.cliente.storage.from(BUCKET).remove(rutas);
  }

  /** Pide enlaces temporales (1 hora) de las fotos que aún no tienen */
  private async firmarFotos(rutas: string[]): Promise<void> {
    const faltan = rutas.filter((r) => !this.urls().has(r));
    if (!faltan.length) return;
    const { data } = await this.supabase.cliente.storage.from(BUCKET).createSignedUrls(faltan, 3600);
    const mapa = new Map(this.urls());
    for (const d of data ?? []) if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
    this.urls.set(mapa);
  }

  protected verFoto(ruta: string | null, titulo: string): void {
    const url = ruta ? this.urls().get(ruta) : undefined;
    if (url) this.fotoGrande.set({ url, titulo });
  }

  protected nuevo(): void {
    this.registro.set({ nombre: '', descripcion: '', ambienteId: null, fechaHora: this.ahora(), foto: null, vista: null });
  }

  protected abrirEntrega(o: ObjetoPerdido): void {
    this.entrega.set({ objeto: o, entregadoA: '', documento: '', observacion: '', foto: null, vista: null });
  }

  protected elegirFoto(evento: Event, destino: 'registro' | 'entrega'): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0] ?? null;
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      this.notificaciones.aviso('Elige una imagen.');
      return;
    }
    const vista = URL.createObjectURL(archivo);
    if (destino === 'registro') this.registro.update((f) => (f ? { ...f, foto: archivo, vista } : f));
    else this.entrega.update((f) => (f ? { ...f, foto: archivo, vista } : f));
  }

  /** Comprime y sube la foto; devuelve la ruta en el bucket */
  private async subirFoto(archivo: File, carpeta: 'objetos' | 'entregas'): Promise<string> {
    const blob = await comprimirFoto(archivo);
    const ruta = `${carpeta}/${fechaActual(environment.zonaHoraria).slice(0, 7)}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.cliente.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
    return ruta;
  }

  protected async guardarRegistro(): Promise<void> {
    const f = this.registro();
    if (!f) return;
    if (f.nombre.trim().length < 2) return this.notificaciones.aviso('Escribe qué objeto se encontró.');
    if (!f.ambienteId) return this.notificaciones.aviso('Elige el laboratorio donde se encontró.');
    if (!f.fechaHora) return this.notificaciones.aviso('Indica la fecha y hora.');
    if (!f.foto) return this.notificaciones.aviso('Toma o elige la foto del objeto.');
    this.guardando.set(true);
    try {
      const foto_path = await this.subirFoto(f.foto, 'objetos');
      const { error } = await this.supabase.cliente.from('objetos_perdidos').insert({
        nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, ambiente_id: f.ambienteId,
        encontrado_en: `${f.fechaHora}:00${DESFASE_LA_PAZ}`, foto_path,
      });
      if (error) throw new ErrorSistema(error);
      this.notificaciones.exito('Objeto registrado.');
      this.registro.set(null);
      this.filtroEstado.set('en_custodia');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se registró');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async guardarEntrega(): Promise<void> {
    const f = this.entrega();
    if (!f) return;
    if (f.entregadoA.trim().length < 3) return this.notificaciones.aviso('Escribe a quién se entrega.');
    if (!f.foto) return this.notificaciones.aviso('Toma la foto de la entrega.');
    this.guardando.set(true);
    try {
      const foto_entrega_path = await this.subirFoto(f.foto, 'entregas');
      const { error } = await this.supabase.cliente.from('objetos_perdidos').update({
        estado: 'entregado', entregado_a: f.entregadoA.trim(), entregado_documento: f.documento.trim() || null,
        observacion_entrega: f.observacion.trim() || null, foto_entrega_path,
      }).eq('id', f.objeto.id);
      if (error) throw new ErrorSistema(error);
      this.notificaciones.exito(`${f.objeto.nombre}: entregado.`);
      this.entrega.set(null);
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e, 'No se registró la entrega');
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(o: ObjetoPerdido): Promise<void> {
    if (!(await this.confirmacion.pedir({ titulo: '¿Eliminar este objeto perdido?', mensaje: `Se borra el registro de "${o.nombre}".`,
      consecuencias: ['También se borran sus fotos.'] }))) return;
    try {
      const { error } = await this.supabase.cliente.from('objetos_perdidos').delete().eq('id', o.id);
      if (error) throw new ErrorSistema(error);
      await this.supabase.cliente.storage.from(BUCKET).remove([o.foto_path, o.foto_entrega_path].filter((p): p is string => !!p));
      this.notificaciones.exito('Eliminado.');
      await this.cargar();
    } catch (e) {
      this.notificaciones.error(e);
    }
  }
}
