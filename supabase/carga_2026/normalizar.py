import sys, openpyxl, unicodedata, re, json
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
COLS = {
 'ENERO2026': ('C','D','G'), 'FEBRERO2026': ('D','E','F'), 'MARZO2026': ('D','E','F'),
 'ABRIL2026': ('D','E','F'), 'MAYO 2026': ('C','D','E'), 'JUNIO 2026': ('D','E','F'),
 'JULIO 2026': ('C','D','E'), 'AGOSTO 2026': ('C','D','E'), 'SEPTIEMBRE 2026': ('C','D','E'),
 'Hoja1': ('C','D','E'), 'OCTUBRE 2026': ('B','C','D'),
}
def base(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii','ignore').decode().upper()
    return re.sub(r'\s+',' ', s).replace('*','').strip()
def nm(s):  # materia: sin quitar nada
    return base(s)
def n(s):   # docente: sin títulos (Ing., Lic., Dr., Dra., Doc., Doctora)
    s = base(s)
    for _ in range(2): s = re.sub(r'^(DOCTORA|DRA|DR|ING|LIC|DOC)(\.|\s)+', '', s)
    return s.strip()

# ---- DOCENTES: clave normalizada -> (nombres, apellidos, [carreras])
D = {}
def doc(nombres, apellidos, carreras, *claves):
    for c in claves: D[c] = (nombres, apellidos, carreras)
I = ['SIS','RED']
doc('Alex','Escobar',I,'ALEX ESCOBAR')
doc('Álvaro','Moscoso',['SIS'],'ALVARO MOSCOSO','ALVARO MOCOSO')
doc('Pablo','Moscoso',['SIS'],'PABLO MOSCOSO')
doc('Andrés','Heredia',[],'ANDRES HEREDIA')
doc('Andrés','Lobatón',['RED'],'ANDRES LOBATON')
doc('Antonio','García',I,'ANTONIO GARCIA')
doc('Beatriz','Vargas',I,'BEATRIZ VARGAS')
doc('Betty','Meneses',I,'BETTY MENESES')
doc('Carla','Peña',[],'CARLA PENA','CARLA')
doc('Cristian','Torrez',I,'CRISTIAN TORREZ','CHRISTIAN TORREZ')
doc('Daniel','Román',I,'DANIEL ROMAN')
doc('David','Serrudo',I,'DAVID SERRUDO','DAVID SERRUTO')
doc('David','Valverde',[],'DAVID VALVERDE')
doc('Diego','Aramayo',['RED'],'DIEGO ARAMAYO')
doc('Edmundo','Rivas',I,'EDMUNDO RIVAS','EDMUNOD RIVAS','EDMUNDO')
doc('Elizabeth','Severiche',I,'ELIZABETH SEVERICHE')
doc('Emily','Arteaga',['MED'],'EMILY ARTEAGA','EMILY ARTEGA','EMILY')
doc('Ernesto','Soto',I,'ERNESTO SOTO')
doc('Esther','Veizaga',I,'ESTHER VEIZAGA')
doc('Freddy','Tinajeros',['MED'],'FREDDY TINAJEROS')
doc('Gabriela','Zimeri',['MKT'],'GABRIELA ZIMER')
doc('Gineth','Salo',['MED'],'GINETH SALO')
doc('Gustavo','Pérez',I,'GUSTAVO PEREZ')
doc('Gustavo','Tantani',I,'GUSTAVO TANTANI')
doc('Hernán','Rodríguez',I,'HERNAN RODRIGUEZ')
doc('Hugo','Guzmán',['SIS','RED','MED'],'HUGO GUZMAN')
doc('Iván','Paz',['RED'],'IVAN PAZ')
doc('Jaime','Zambrana',I,'JAIME ZAMBRANA')
doc('Jared','López',I,'JARED LOPEZ')
doc('Javier','Bonifaz',['RED'],'JAVIER BONIFAZ')
doc('Javier','López',I,'JAVIER LOPEZ')
doc('Javier','Orosco',[],'JAVIER OROSCO')
doc('Jeanine','Yépez',[],'JEANINE YEPEZ')
doc('Jimmy','Requena',I,'JIMMY REQUENA','JIMMY NATANIEL','REQUENA')
doc('José','Castro',I,'JOSE CASTRO')
doc('Lili','Jiménez',I,'LILI JIMENEZ','LILI JIMINEZ')
doc('Lili','Veizaga',I,'LILI VEIZAGA')
doc('Lucero','Mamani',[],'LUCERO MAMANI')
doc('Luis','Orozco',I,'LUIS OROZCO','LUIS OROSCO')
doc('Marco Antonio','Vidal',I,'MARCO VIDAL','MARCO ANTONIO VIDAL')
doc('María','Colque',I,'MARIA COLQUE')
doc('Mauren','Salvatierra',['MED'],'MAUREN SALVATIERRA')
doc('Miguel','Macías',I,'MIGUEL MACIAS','MACIAS')
doc('Naín','Rivas',I,'NAIN RIVAS')
doc('Paul','Melgar',I,'PAUL MELGAR')
doc('Pedro Luis','Díaz',[],'PEDRO LUIS DIAZ')
doc('Roger','Choque',[],'ROGER CHOQUE')
doc('Ruth','Gascher',I,'RUTH GASCHER')
doc('Teresa','Gutiérrez',[],'TERESA GUTIERREZ')
doc('Teresa','Justiniano',[],'TERESA JUSTINIANO')
doc('Wilder','Mendoza',['COM'],'WILDER ENDOZA','WILDER MENDIGA')
doc('Wilmer','Campos',['MED'],'WILMER CAMPOS')
doc('Wilson','Cruz',I,'WILSON CRUZ')
doc('Yolanda','Morón',I,'YOLANDA MORON')
doc('Daniela','Terán',['MKT'],'DANIELA TERAN')
doc('César','Rodríguez',[],'CESAR')
doc('Sergio','Cruz Sequeiros',['DER'],'SERGIO CRUZ','SERGIO CRUZ SEQUEIROS')
doc('José','Cuéllar',['COM'],'JOSE CUELLAR')
doc('Wilber','Baspineiro',['COM'],'WILBER BASPINEIRO')
doc('Jesús','Torrez',[],'JESUS TORREZ')
doc('Ysnaider','Castro',[],'YSNAIDER CASTRO')
doc('Abel','Catari',[],'ABEL CATARI')
# Solo aparecen en la tabla de Empresarial del Lab 2 o como receptores de cesiones (nombre completo)
EXTRA = [('Héctor','Serrano',[]),('Mariel','Morales',[]),('Mario','Saavedra',[]),('Jenny','Quiroga',['DER'])]
IGNORAR_DOC = {'', ',', 'N', 'MEDICINA', 'ALEJANDRO', 'YAQUELIN BURGOS/ ALEXANDER /CARLA'}

# ---- MATERIAS: clave normalizada -> nombre oficial (None = evento, no es materia)
M = {}
def mat(nombre, *claves):
    for c in claves: M[c] = nombre
MED = 'Medicina (laboratorio)'
mat('Administración de Base de Datos I','ADMINISTRACION BASE DE DATOS I','ADMINISTRACION DE BASE DATOS I','ADMINISTRACION DE BASE DE DATOS','ADMINISTRACION DE BASE DE DATOS I','ADMINISTRACIOND DE BASE DE DATOS I')
mat('Análisis de Sistemas y Señales','ANALISIS DE SISTEMAS Y SENALES','ANALISIS DE SITEMAS Y SENALES')
mat('Antenas y Propagación','ANTENAS Y PROPAGACION')
mat('Aplicaciones Móviles','APLICACIONES MOVILES')
mat('Auditoría de Sistemas','AUDITORIA DE SISTEMAS')
mat('Base de Datos I','BASE DE DATOS I'); mat('Base de Datos II','BASE DE DATOS II')
mat('Cálculo I','CALCULO I')
mat('Campos Electromagnéticos','CAMPOS ELECTROMACNETICOS')
mat('Circuitos Eléctricos II','CIRCUITOS ELECTRICOS II')
mat('Comunicaciones Digitales I','COMUNICACIONES DIGITALES I')
mat('Derecho Administrativo y Regulatorio','DERECHO ADMINISTRATIVO Y REGULATORIO')
mat('Derecho de Hidrocarburos','DERECHO DE HIDROCARBUROS','DERECHOS DE HIDROCARBUROS')
mat('Desarrollo de Sistemas I','DESARROLLO DE SISTEMAS I'); mat('Desarrollo de Sistemas II','DESARROLLO DE SISTEMAS II')
mat('Deontología','SEMIPRESENCIAL DEONTOLOGIA')
mat('Dibujo Computarizado','DIBUJO COMPUTARIZADO')
mat('Diseño Gráfico','DISENO GRAFICO')
mat('Diseño Web I','DISENO WEB I'); mat('Diseño Web II','DISENO WEB II')
mat('Electrónica II','ELECTRONICA II')
mat('Estadística Descriptiva','ESTADISTICA DESCRIPTIVA (SEMIPRE)')
mat('Estadística Inferencial','ESTADISTICA INFERENCIAL')
mat('Estructura de Datos','ESTRUCTURA DE DATOS')
mat('Estructuras Discretas','ESTRUCTURAS DISCRETAS')
mat('Fundamentos de Sistemas de Comunicación','FUNDAMENTOS DE LOS SISTEMAS DE COMUNICACION','FUNDAMENTOS DE SISTEMAS DE COMUNICACION')
mat('Hardware, Software y Redes','HADWARE Y SOFTWARE','HARDWARE Y SOTFWARE','HARDWARE, SOFTWARE Y REDES')
mat('Herramientas Digitales','HERRAMIENTAS DIGITALES','SOCIALES / HERRAMIENTAS DIGITALES')
mat('Informática Educativa','INFORMATICA EDUCATIVA')
mat('Ingeniería de Software I','ING. DE SOFTWARE I','INGENIERIA DE SOFTWARE I')
mat('Ingeniería de Software II','INGENIERIA DE SOFTWARE II','INGENIERIA DE SOFWARE II')
mat('Inglés Técnico I','INGLES I','INGLES TECNICO','INGLES TECNICO I')
mat('Inglés Técnico II','INGLES II','INGLES TECNICO II')
mat('Instalación y Certificación de Redes','INSTALACION Y CERTIFICACION DE REDES')
mat('Inteligencia Artificial','INTELIGENCIA ARTIFICIAL','INTELIGENCIA ARTIFICIAL I')
mat('Inteligencia de Negocios','INTELIGENCIA DE NEGOCIOS')
mat('Investigación de Mercado I','INVESTIGACION DE MERCADO I')
mat('Investigación Operativa I','INVESTIGACION OPERATIVA I')
mat('Modalidad de Grado - Proyectos','MDG I - PROYECTOS MOD 1 DE 2','MDG PROYECTOS','MODALIDAD DE GRADO')
mat('Modalidad de Grado - Examen de Grado Sistemas','MDG SISTEMAS EX DE GR 3/5','MDG SISTEMAS EX DE GR 4/5','MDG SISTEMAS EX DE GR 5/5','MDG SISTEMAS EXAMEN DE GRADO 1/5','MDG SISTEMAS EXAMEN DE GRADO 2/5')
mat('Modalidad de Grado - Examen de Grado Redes','MDG REDES EX DE GR 3/5','MDG REDES EX DE GR 4/5','MDG REDES EX DE GR 5/5','MDG REDES EXAMEN DE GRADO 1/5','MDG REDES EXAMEN DE GRADO 2/5')
mat(MED,'MEDICINA','MEDICIAN - HUGO GUZMAN','MEDICINA - FREDDY TINAJEROS','MEDICINA - HUGO GUZMAN','MEDICINA - WILMER CAMPOS','MEDICINA DR.EMILY ARTEAGA','MEDICINA FISIO GR D','FISIO / MEDICINA GRUPO D','FISIO MEDICINA','EMILY ARTEAGA')
mat('Medios de Transmisión','MEDIO DE TRANSMISION','MEDIOS DE TRANSMISION')
mat('Planificación de Marketing','PLANIFICACION DE MARKETING')
mat('Programación Básica','PROGRAMACION BASICA'); mat('Programación de Aplicaciones','PROGRAMACION DE APLICACIONES')
for r in ['I','II','III','IV']: mat(f'Programación {r}', f'PROGRAMACION {r}')
mat('Programación Numérica','PROGRAMACION NUMERICA')
mat('Programación Web I','PROGRAMACION WEB I'); mat('Programación Web II','PROGRAMACION WEB II')
for r in ['I','II','III','IV']: mat(f'Redes {r}', f'REDES {r}')
mat('Redes Inalámbricas y Móviles','REDES INALAMBRICAS Y MOVILES')
mat('Robótica','ROBOTICA')
mat('Seguridad en Redes','SEGURIDAD EN REDES','SEGURIDAD EN REDES (TUTORIA DE 4 ESTUD)')
mat('Seguridad Informática','SEGURIDAD IMFORMATICA','SEGURIDA INFORMATICA','SEGURIDAD INFORMATICA','SEGURIDAD INFORMATICA I')
mat('Sistemas de Comunicación Óptica','SISTEMAS DE COMUNICACION OPTICA (TUT 2 EST)')
mat('Sistemas de Información I','SISTEMA DE INFORMACION I','SISTEMAS DE INFORMACION I')
mat('Sistemas de Información II','SISTEMAS DE INFORMACION II')
mat('Sistemas de Información III','SISTEMA DE INFORMACION III','SISTEMAS DE INFORMACION III')
mat('Sistemas de Radiocomunicación I','SISTEMAS DE RADIOCOM I','SISTEMAS DE RADIOCOMUNICAC. I','SISTEMAS DE RADIOCOMUNICACION I')
mat('Sistemas de Radiocomunicación II','SISTEMAS DE RADIOCOM II','SISTEMAS DE RADIOCOMUNICAC. II','SISTEMAS RADIOCOMUNICACIONES II')
mat('Sistemas Digitales I','SISTEMAS DIGITALES I'); mat('Sistemas Digitales II','SISTEMAS DIGITALES II')
mat('Sistemas Multimedia','SISTEMAS MULTIMEDIA')
mat('Sistemas Operativos I','SISTEMAS OPERATIVOS I')
mat('Sistemas Operativos II','SISTEMAS OPERATIVOS II','SISTEMAS DE OPERATIVOS II')
mat('Taller de Redes','TALLER DE REDES')
mat('Taller de Sistemas Operativos I','TALLER DE SISTEMAS OPERATIVOS I'); mat('Taller de Sistemas Operativos II','TALLER DE SISTEMAS OPERATIVOS II')
mat('Tecnología de Base de Datos I','TECNOLOGIA BASE DE DATOS I','TECNOLOGIA DE BASE DE DATOS I','TECNOLOGIA DE BD')
mat('Tecnología Web I','TECNOLOGIA WEB I'); mat('Tecnología Web II','TECNOLOGIA WEB II')
mat('Tecnologías Inalámbricas','TECNOLOGIAS INALAMBRICAS')
mat('Trading','TRADING','TRAIDING')
EVENTOS = {'CAPACITACION DERECHO (DR. SALDANA)','CAPACITACION DOCENTE SEMIPRESENCIAL','CAPACITACION DOCENTES EMPRESARIAL','CAPACITACION NAF',
 'CAPACITACION SEMILLEROS ING-MEDICINA','DEFENSA DE GRADO - FAC C EMPRESARIALES','DEFENSA DE GRADO FAC EMPRESARIAL','DEFENSAS DE GRADO - FAC EMPRESARIAL',
 'DEFENSAS DE GRADO - FAC. EMPRESARIAL','EVALUAC.CONCURSO PROYECTOS SOCIOFORMATIVO','LIBERACION POR INVESTIGACION','MAESTRIA','MAESTRIA - VERSION 3',
 'MAESTRIA - VERSION 4','MAESTRIA EIAG','MAESTRIA V3','POSTGRADO','PRACTICAS ING JARED','SEMIP. DERECHO DR. SERGIO CRUZ','SEMIPRESENCIAL',
 'SEMIPRESENCIAL (LIC CARLA)','SEMIPRESENCIAL - 2 CURSOS','SEMIPRESENCIAL - 3 CURSOS','SIMULACION DE DEFENSA','TALLER DE BIENESTAR ESTUDIANTIL',
 'TALLER DE DERECHO (DRA. JENNY QUIROGA)','TALLER REDES MIKCROTIK'}
EXTRA_MAT = ['Medicina (laboratorio)']

sin_doc, sin_mat, pares = set(), set(), set()
for hoja,(t,m,d) in COLS.items():
    ws = wb[hoja]
    for r in range(1, ws.max_row+1):
        tv = ws[f'{t}{r}'].value
        if not tv or str(tv).strip().upper()=='TURNO': continue
        mk = nm(ws[f'{m}{r}'].value) if ws[f'{m}{r}'].value else ''
        dk = n(ws[f'{d}{r}'].value) if ws[f'{d}{r}'].value else ''
        if mk and mk not in M and mk not in EVENTOS: sin_mat.add(mk)
        if dk and dk not in D and dk not in IGNORAR_DOC: sin_doc.add(dk)
        # "MEDICINA - X" en la columna materia: el docente va en la materia
        if mk.startswith(('MEDICINA -','MEDICIAN -','MEDICINA DR.')):
            dk = n(re.sub(r'^MEDICI\w+\s*(-\s*|DR\.)', '', mk))
        if mk in M and dk in D: pares.add((D[dk][:2], M[mk]))
print('SIN MAPEAR docentes:', sorted(sin_doc)); print('SIN MAPEAR materias:', sorted(sin_mat))
docentes = {v[:2]: v[2] for v in D.values()}
for a,b,c in EXTRA: docentes[(a,b)] = c
materias = sorted(set(M.values()))
print(len(docentes), 'docentes ·', len(materias), 'materias ·', len(pares), 'pares docente-materia')
json.dump({'docentes': [[a,b,c] for (a,b),c in sorted(docentes.items(), key=lambda x:(x[0][1],x[0][0]))],
           'materias': materias, 'pares': sorted([[a,b,m] for (a,b),m in pares])},
          open(sys.argv[2],'w'), ensure_ascii=False, indent=1)
