import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { MenuSeccionesComponent, SeccionMenu } from '../../compartido/menu-secciones.component';
import { AuthService } from '../../core/auth.service';
import { CarrerasComponent } from '../catalogos/carreras.component';
import { DocentesComponent } from '../catalogos/docentes.component';
import { FeriadosComponent } from '../catalogos/feriados.component';
import { MateriasComponent } from '../catalogos/materias.component';
import { UsuariosComponent } from '../catalogos/usuarios.component';

/** Secciones de configuración */
type Pestana = 'docentes' | 'materias' | 'carreras' | 'feriados' | 'usuarios';

/**
 * Configuración: primero un menú de tarjetas y, al tocar una, su catálogo
 * (docentes, materias, facultades, feriados y usuarios, este último solo admin).
 * Los laboratorios tienen su propia sección en el menú.
 */
@Component({
  selector: 'app-configuracion',
  imports: [MenuSeccionesComponent, DocentesComponent, MateriasComponent, CarrerasComponent, FeriadosComponent, UsuariosComponent],
  template: `
    <app-menu-secciones titulo="Configuración" subtitulo="Catálogos del sistema." [secciones]="visibles()" [seccionActual]="actual()"
                        (elegir)="cambiar($event)" (volver)="cambiar(null)" />
    @switch (actual()?.clave) {
      @case ('docentes') { <app-docentes /> }
      @case ('materias') { <app-materias /> }
      @case ('carreras') { <app-carreras /> }
      @case ('feriados') { <app-feriados /> }
      @case ('usuarios') { <app-usuarios /> }
    }
  `,
})
export class ConfiguracionComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /** Sección abierta, desde la URL (?pestana=docentes) */
  readonly pestana = input<string>();

  private readonly secciones: (SeccionMenu<Pestana> & { soloAdmin?: boolean })[] = [
    { clave: 'docentes', texto: 'Docentes', descripcion: 'Datos de contacto, facultades y materias', icono: 'docente' },
    { clave: 'materias', texto: 'Materias', descripcion: 'Materias que se dictan en los laboratorios', icono: 'materia' },
    { clave: 'carreras', texto: 'Facultades', descripcion: 'Carreras con su sigla y color', icono: 'carrera' },
    { clave: 'feriados', texto: 'Feriados', descripcion: 'Días sin clases (se bloquean en el calendario)', icono: 'calendario' },
    { clave: 'usuarios', texto: 'Usuarios', descripcion: 'Cuentas y roles del sistema', icono: 'candado', soloAdmin: true },
  ];
  protected readonly visibles = computed(() => this.secciones.filter((s) => !s.soloAdmin || this.auth.esAdmin()));
  protected readonly actual = computed(() => this.visibles().find((s) => s.clave === this.pestana()) ?? null);

  /** Abre una sección (o vuelve al menú) dejándola en el historial del navegador */
  protected cambiar(clave: string | null): void {
    void this.router.navigate([], { queryParams: { pestana: clave } });
  }
}
