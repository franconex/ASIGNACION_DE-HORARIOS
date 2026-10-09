import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconoComponent } from '../../compartido/icono.component';
import { AuthService } from '../../core/auth.service';
import { CarrerasComponent } from '../catalogos/carreras.component';
import { DocentesComponent } from '../catalogos/docentes.component';
import { FeriadosComponent } from '../catalogos/feriados.component';
import { MateriasComponent } from '../catalogos/materias.component';
import { UsuariosComponent } from '../catalogos/usuarios.component';

/** Pestañas de configuración */
type Pestana = 'docentes' | 'materias' | 'carreras' | 'feriados' | 'usuarios';

/**
 * Configuración en una sola pantalla con pestañas:
 * docentes, materias, carreras, feriados y usuarios (admin).
 * Los laboratorios tienen su propia sección en el menú.
 */
@Component({
  selector: 'app-configuracion',
  imports: [IconoComponent, DocentesComponent, MateriasComponent, CarrerasComponent, FeriadosComponent, UsuariosComponent],
  template: `
    <h1 class="mb-4 text-2xl font-bold">Configuración</h1>
    <nav class="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      @for (p of visibles(); track p.clave) {
        <button class="-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition"
                [class]="activa() === p.clave ? 'border-marca-600 text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
                (click)="cambiar(p.clave)">
          <app-icono [nombre]="p.icono" [tamano]="16" /> {{ p.texto }}
        </button>
      }
    </nav>
    @switch (activa()) {
      @case ('docentes') { <app-docentes /> }
      @case ('materias') { <app-materias /> }
      @case ('carreras') { <app-carreras /> }
      @case ('feriados') { <app-feriados /> }
      @case ('usuarios') { <app-usuarios /> }
    }
  `,
})
export class ConfiguracionComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly pestana = input<string>();
  protected readonly activa = signal<Pestana>('docentes');

  private readonly pestanas: { clave: Pestana; texto: string; icono: string; soloAdmin?: boolean }[] = [
    { clave: 'docentes', texto: 'Docentes', icono: 'docente' },
    { clave: 'materias', texto: 'Materias', icono: 'materia' },
    { clave: 'carreras', texto: 'Facultades', icono: 'carrera' },
    { clave: 'feriados', texto: 'Feriados', icono: 'calendario' },
    { clave: 'usuarios', texto: 'Usuarios', icono: 'candado', soloAdmin: true },
  ];
  protected readonly visibles = computed(() => this.pestanas.filter((p) => !p.soloAdmin || this.auth.esAdmin()));

  ngOnInit(): void {
    const inicial = this.visibles().find((p) => p.clave === this.pestana());
    if (inicial) this.activa.set(inicial.clave);
  }

  protected cambiar(clave: Pestana): void {
    this.activa.set(clave);
    void this.router.navigate([], { queryParams: { pestana: clave }, replaceUrl: true });
  }
}
