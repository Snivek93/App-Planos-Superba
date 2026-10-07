# Sellos cortafuego

App web para superponer los planos arquitectónicos (paredes cortafuego) con los planos de instalaciones (eléctrico, mecánico, plomería, supresión), marcar y contar los sellos cortafuego, y exportar el Excel para **Firestop Suite**.

Es una **PWA**: se instala como una app en la computadora, el iPad o el teléfono, y funciona **sin internet** una vez abierta por primera vez.

---

## Publicarla en GitHub Pages

1. Suba el contenido de esta carpeta al repositorio, en la rama `main`.
2. En GitHub, vaya a **Settings → Pages** y en **Source** elija **GitHub Actions**.
3. Cada vez que suba cambios a `main`, la acción *Publicar en GitHub Pages* compila y publica la app sola (pestaña **Actions**, tarda 1 a 2 minutos).
4. La app queda en `https://<su-usuario>.github.io/<nombre-del-repositorio>/`.

> GitHub Pages es gratis con repositorio **público**. Con repositorio privado, Pages pide un plan de pago de GitHub; en ese caso se puede publicar igual de gratis en Cloudflare Pages o Netlify (comando de compilación `npm run build`, carpeta de salida `dist`).

## Instalarla

- **Chrome o Edge (computadora):** abra la dirección de la app y use el ícono de instalar en la barra de direcciones. Instalada, también puede abrir archivos `.pdf` o el `.zip` del proyecto con doble clic (*Abrir con → Sellos cortafuego*).
- **iPhone / iPad (Safari):** botón Compartir → **Agregar a inicio**. Instalada así, Safari no borra los datos guardados aunque pase tiempo sin abrirla.
- **Android (Chrome):** menú ⋮ → **Instalar app**.

Cuando se publica una versión nueva, la app muestra el aviso *"Hay una versión nueva de la app"* con el botón **Actualizar**. El proyecto se guarda antes de recargar.

## Datos y respaldo

- El proyecto (planos, marcas, sellos, categorías, tablas) se guarda solo en el navegador, en IndexedDB.
- Para respaldo o para pasarlo a otro equipo: **Descargar .zip** en el inicio del proyecto, y **Abrir** en el otro equipo.
- **Al pasar de la versión anterior** (la página de un solo archivo): ábrala, use **Descargar .zip**, y abra ese .zip en esta versión. Cada dirección web guarda sus datos por separado, por eso no aparecen solos.

---

## Desarrollo

Necesita [Node.js](https://nodejs.org) 20 o más reciente.

```bash
npm install        # una vez
npm run dev        # servidor local en http://localhost:5173 con recarga al guardar
npm run build      # versión optimizada en dist/
npm run preview    # sirve dist/ para probar la versión final (incluye el modo sin conexión)
```

- En `npm run dev` el service worker está apagado, para que siempre vea los cambios. En la consola del navegador, `__dbg()` devuelve el estado de la app.
- Después del primer `npm install` se crea `package-lock.json`: súbalo al repositorio para que las versiones de las librerías queden fijas.

### Cómo está compilada

- **esbuild** (`build.mjs`) junta los módulos, minifica y pone un código en el nombre de cada archivo para que el navegador nunca use uno viejo.
- **pdf.js** (lectura de PDF) y **pdf-lib** (exportar PDF) van en archivos aparte que se cargan solo cuando hacen falta, así la app abre rápido.
- `build.mjs` también genera `dist/sw.js`, el service worker, con la lista de todos los archivos para que la app funcione sin internet.
- Las fuentes (Barlow) vienen de Google Fonts; el service worker las guarda la primera vez y después funcionan sin conexión.

### Rendimiento

- **Caché de planos:** leer y dibujar un PDF de CAD tarda segundos. La primera vez que se dibuja un plano se guarda como imagen PNG (sin pérdida) en el navegador, junto con su vista previa y la lectura vectorial para la detección; las siguientes veces abre en décimas de segundo.
- **Preparación en segundo plano:** mientras se ve el inicio del proyecto, la app prepara uno por uno los planos que todavía no se han abierto (`src/project/warm.js`). Se detiene al abrir un plano.
- **Memoria:** se mantienen pocos planos en memoria (6 en computadora, 3 en teléfono o tableta); los demás se reabren desde la caché.
- El PDF original se abre solo cuando hace falta (detección, alineación por ejes, exportar).

## Estructura

```
index.html                 estructura de la página
build.mjs                  compilación (esbuild) y service worker
public/                    manifest de la PWA e íconos (se copian tal cual)
src/
  main.js                  punto de entrada: estilos e inicio de cada módulo en orden
  pwa.js                   service worker, aviso de versión nueva, abrir archivos desde el sistema
  sw.js                    plantilla del service worker
  boot.js                  arranque: carga el proyecto guardado
  styles/                  base, editor, panel, inicio, PWA
  core/                    estado, geometría, niveles, almacenamiento, deshacer, constantes
  canvas/                  lienzo, vista, tablas en el plano, selección
  editor/                  herramientas, puntero, teclado, alineación con 2 puntos
  plans/                   carga de planos y plantas por lámina
  panels/                  pestañas Planos, Capas, Sellos y Detección
  detect/                  detección automática (lectura vectorial, elegir estilo, cruces)
  export/                  Excel para Firestop Suite, PDF con marcas, CSV, datos de penetrante
  project/                 proyecto, hojas, archivos, paredes compartidas, .zip
  home/                    inicio del proyecto, tabla de penetrantes, arrastrar y soltar
```

Cada archivo empieza con una línea que explica qué contiene.

### Convenciones del código

- **Arranque en orden:** al cargarse, cada módulo solo declara funciones y datos. Lo que tiene efectos (registrar eventos, crear el estado inicial) está en su función `init()`, y `main.js` las llama una vez en orden. Así no importa en qué orden el navegador cargue los módulos.
- **Variables compartidas:** los `import` de JavaScript son de solo lectura. Cuando un módulo necesita cambiar una variable de otro (por ejemplo el estado `S` o la herramienta activa), lo hace con el objeto `…Vars` de ese módulo, por ejemplo `stateVars.S = hoja.state`.
- **Estado de la hoja abierta:** `S` es el estado de la hoja que está abierta y `P` el proyecto completo. Para leer otra hoja sin abrirla se usa `withState(hoja.state, () => …)`.
