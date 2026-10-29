# Tokkip Healthy PC, la nueva: plan

Tokkip Healthy PC se reescribe de cero, 100% nuestra: Tauri 2 (Rust para el
sistema, Preact + TypeScript para la interfaz) y el diseño de Tokkip PC
(Material 3 Expressive, claro u oscuro, Tokkip vivo). Se construye en la rama
`nueva`. La versión basada en Kudu (ramas `tokkip` y `main`) sigue siendo la
que se instala hasta que esta haga todo lo que aquella hace; entonces `nueva`
pasa a ser `main`.

## Principios

1. **Primero mirar, luego tocar.** Toda herramienta que borra o cambia algo
   trabaja en tres pasos: *revisar* (qué encontró, cuánto pesa, por qué),
   *elegir* (tú marcas) y *aplicar*. Nada se borra al revisar.
2. **Todo se puede deshacer, o se avisa que no.** Lo que se borra va a la
   papelera o a la carpeta de recuperación; el registro se respalda antes de
   tocarlo; los cambios de sistema crean un punto de restauración cuando
   Windows lo permite. Lo que no tiene vuelta atrás (destructor de archivos)
   lo dice antes, con claridad.
3. **Nada sale de la PC.** Sin nube, sin telemetría. Red solo para lo que tú
   pides: buscar actualizaciones de programas y controladores, y las de la
   propia app (releases de este repo).
4. **Archivos en uso se respetan.** Lo que está abierto se salta y se cuenta,
   no se fuerza.
5. **Tokkip dice cómo se siente tu PC** y por qué, y te lleva al siguiente
   paso. Celebra cuando liberas espacio.
6. **Español (de tú) e inglés.**

## Arquitectura

- `src-tauri/` — Rust. Un módulo por herramienta en `src/tools/`, cada uno con
  sus pruebas. Lo de Windows (registro, servicios, WMI, Defender, firewall,
  punto de restauración) detrás de `platform/`, para poder probar la lógica
  en Linux.
- `src/` — Preact + TypeScript. `core/theme.ts`, `core/tokens.css`, los
  íconos Material Symbols y el motor de Tokkip (`tokkip/`) vienen de Tokkip PC
  (`scripts/sync-tokkip.mjs` los vuelve a copiar).
- Las reglas de limpieza son nuestras: JSON en `rules/`, con rutas, patrones,
  antigüedad mínima y si piden permisos de administrador.
- Crates principales: `windows` (Win32), `winreg`, `sysinfo`, `wmi`,
  `walkdir`/`jwalk`, `trash`, `yara-x` (YARA en Rust puro), `serde`.

## De dónde sale cada herramienta

Kudu (MIT, Advent Development) es la referencia de *qué* hace cada
herramienta y de los cuidados que necesita en Windows: antes de escribir una,
se lee la suya, sus listas y sus pruebas, y se rehace en Rust con nuestra
interfaz. Lo que se toma de Kudu se dice en el archivo y en
THIRD-PARTY-NOTICES.md. De Kudu no se toma nada de su nube.

## Las herramientas, por fases

Cada fase termina con una versión instalable.

### Fase 1 — Base y limpieza (0.5)
- [x] Base: ventana, barra lateral por secciones, tema claro/oscuro con color
      semilla, Tokkip, español e inglés, CI con instalador.
- [x] Inicio: la salud de tu PC con Tokkip (espacio libre, última limpieza,
      última revisión de malware) y qué hacer.
- [x] Limpiador del sistema: temporales de Windows y del usuario, miniaturas,
      volcados de errores, informes de errores, registros viejos, papelera.
- [x] Navegadores: caché de Chrome, Edge, Brave, Opera, Vivaldi y Firefox.
- [x] Apps y juegos: cachés de Discord, Spotify, Teams, Steam, launchers…

### Fase 2 — Almacenamiento (0.6)
- [x] Análisis de disco (mapa de carpetas), espacio por app.
- [x] Archivos grandes, duplicados (por tamaño y luego hash), carpetas vacías.
- [x] Revisión de Descargas (lo viejo y lo repetido).
- [x] Historial de almacenamiento (cómo cambia tu espacio con el tiempo).
- [x] Destructor de archivos (sobrescritura; avisa que no se recupera).

### Fase 3 — Software (0.7)
- [x] Programas de inicio (registro, carpeta Inicio, tareas programadas).
- [x] Desinstalador (con el desinstalador de cada programa).
- [x] Búsqueda de restos después de desinstalar (carpetas y claves que quedan).
- [x] Quitar bloatware (apps preinstaladas de Windows, con lista curada).
- [x] Actualizaciones de programas (winget).
- [ ] Actualizaciones de controladores.
- [ ] Menú contextual: entradas viejas o rotas.

### Fase 4 — Rendimiento (0.8)
- [ ] Monitor: CPU, memoria, disco, red, temperaturas, procesos.
- [ ] Servicios de Windows con recomendaciones seguras.
- [ ] Modo juego (pausa lo que estorba mientras juegas).
- [ ] Red: caché DNS, reinicio de la pila de red.

### Fase 5 — Protección (0.9)
- [ ] Escáner de malware: Windows Defender, heurísticas y tus reglas YARA.
- [ ] Privacidad: rastros (recientes, historial de ejecución), telemetría de
      Windows con interruptores explicados.
- [ ] Firewall: revisión de reglas.
- [ ] Endurecimiento del sistema (opciones de seguridad recomendadas).

### Fase 6 — Mantenimiento y paridad (1.0)
- [ ] Registro: entradas huérfanas, con respaldo y restauración.
- [ ] Reparación de Windows (SFC, DISM) y mantenimiento de disco (TRIM,
      desfragmentación en discos duros, CHKDSK programado).
- [ ] Puntos de restauración, actividad (qué se hizo y cuándo) y centro de
      recuperación.
- [ ] Rutinas automáticas (limpiezas programadas).
- [ ] Aviso a Tokkip PC (`%APPDATA%\Tokkip\shared\healthy-pc.json`).
- [ ] Pasar los ajustes de la versión anterior y reemplazarla.
