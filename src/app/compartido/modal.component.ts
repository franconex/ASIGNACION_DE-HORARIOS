import { Component, effect, ElementRef, input, OnDestroy, output, untracked, viewChild } from '@angular/core';
import { IconoComponent } from './icono.component';

/** Elementos a los que se puede llegar con Tab */
const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modales abiertos, del más viejo al de arriba (Escape y Tab solo valen para el de arriba) */
const abiertos: ModalComponent[] = [];

/**
 * Ventana modal reutilizable. El contenido se proyecta con <ng-content>,
 * y los botones del pie con el atributo [pie]. En el celular ocupa toda la
 * pantalla, con el título fijo arriba y los botones fijos abajo.
 *
 * - Al abrir, el foco entra al primer campo; Tab no sale del modal y al
 *   cerrar vuelve a donde estaba. La página de atrás no se desplaza.
 * - Se cierra con la ✕, Cancelar o Escape. Hacer clic fuera NO lo cierra
 *   (así no se pierde lo escrito), salvo con [cerrarConFondo]="true".
 */
@Component({
  selector: 'app-modal',
  imports: [IconoComponent],
  template: `
    @if (abierto()) {
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-[2px] sm:p-4"
           (mousedown)="alPulsarFondo($event)" (keydown)="alTeclear($event)">
        <div #cuadro class="tarjeta flex min-h-full w-full flex-col rounded-none border-0 shadow-xl outline-none sm:my-8 sm:min-h-0 sm:rounded-lg sm:border"
             [class]="anchos[ancho()]" (mousedown)="$event.stopPropagation()" role="dialog" aria-modal="true" [attr.aria-label]="titulo()" tabindex="-1">
          <div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-superficie px-4 py-3 sm:static sm:rounded-t-lg sm:px-5">
            <h2 class="min-w-0 truncate text-base font-semibold text-slate-800">{{ titulo() }}</h2>
            <button type="button" class="btn-fantasma btn-sm" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="cerrar" [tamano]="18" /></button>
          </div>
          <div class="flex-1 px-4 py-4 sm:px-5"><ng-content /></div>
          <div class="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 empty:hidden sm:static sm:rounded-b-lg sm:px-5">
            <ng-content select="[pie]" />
          </div>
        </div>
      </div>
    }
  `,
})
export class ModalComponent implements OnDestroy {
  readonly abierto = input(false);
  readonly titulo = input('');
  readonly ancho = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Cerrar al hacer clic fuera (solo para modales que muestran algo, sin formulario) */
  readonly cerrarConFondo = input(false);
  readonly cerrar = output<void>();

  protected readonly anchos: Record<string, string> = {
    sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl',
  };

  private readonly cuadro = viewChild<ElementRef<HTMLElement>>('cuadro');
  /** Dónde estaba el foco antes de abrir, para devolverlo al cerrar */
  private focoAnterior: HTMLElement | null = null;

  constructor() {
    // Al abrir: registrar, bloquear el desplazamiento de atrás y llevar el foco adentro
    effect(() => {
      const elemento = this.cuadro()?.nativeElement;
      untracked(() => (elemento ? this.alAbrir(elemento) : this.alCerrar()));
    });
  }

  ngOnDestroy(): void {
    this.alCerrar();
  }

  private alAbrir(elemento: HTMLElement): void {
    if (abiertos.includes(this)) return;
    this.focoAnterior = document.activeElement as HTMLElement | null;
    abiertos.push(this);
    document.body.style.overflow = 'hidden';
    // Primer campo del contenido (no la ✕); si no hay, el botón principal o el cuadro
    setTimeout(() => {
      const campo = elemento.querySelector<HTMLElement>('.flex-1 input:not([disabled]):not([type="hidden"]), .flex-1 select:not([disabled]), .flex-1 textarea:not([disabled])');
      (campo ?? elemento.querySelector<HTMLElement>('.btn-primario:not([disabled])') ?? elemento).focus({ preventScroll: true });
    });
  }

  private alCerrar(): void {
    const i = abiertos.indexOf(this);
    if (i === -1) return;
    abiertos.splice(i, 1);
    if (!abiertos.length) document.body.style.overflow = '';
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (anterior?.isConnected) setTimeout(() => anterior.focus({ preventScroll: true }));
  }

  /** Cierra al hacer clic fuera del cuadro, solo si se pidió */
  protected alPulsarFondo(evento: MouseEvent): void {
    if (this.cerrarConFondo() && evento.target === evento.currentTarget) this.cerrar.emit();
  }

  /** Escape cierra el de arriba; Tab da la vuelta dentro del modal */
  protected alTeclear(evento: KeyboardEvent): void {
    if (abiertos.at(-1) !== this) return;
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      this.cerrar.emit();
      return;
    }
    if (evento.key !== 'Tab') return;
    const elemento = this.cuadro()?.nativeElement;
    if (!elemento) return;
    const lista = [...elemento.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((e) => e.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (evento.shiftKey && (document.activeElement === primero || document.activeElement === elemento)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }
}
