/* Punto de entrada de la app.
   Los módulos solo declaran funciones y datos al cargarse; todo lo que tiene efectos
   (eventos, estado inicial, arranque) está en la función init() de cada módulo y se
   ejecuta aquí, una vez, en el mismo orden en que estaba en la versión de un solo archivo. */
import './styles/base.css';
import './styles/editor.css';
import './styles/panel.css';
import './styles/home.css';
import './styles/pwa.css';

import { init as initCoreConstants } from './core/constants.js';
import { init as initUiIcons } from './ui/icons.js';
import { init as initCoreState } from './core/state.js';
import { init as initCanvasRender } from './canvas/render.js';
import { init as initEditorTools } from './editor/tools.js';
import { init as initEditorPointer } from './editor/pointer.js';
import { init as initCanvasView } from './canvas/view.js';
import { init as initEditorKeyboard } from './editor/keyboard.js';
import { init as initCoreUndo } from './core/undo.js';
import { init as initPlansLoad } from './plans/load.js';
import { init as initPanelsPlanos } from './panels/planos.js';
import { init as initPanelsCapas } from './panels/capas.js';
import { init as initPanelsSellos } from './panels/sellos.js';
import { init as initCoreStorage } from './core/storage.js';
import { init as initUiApp } from './ui/app.js';
import { init as initExportFirestop } from './export/firestop.js';
import { init as initDetectVector } from './detect/vector.js';
import { init as initPanelsDeteccion } from './panels/deteccion.js';
import { init as initProjectFiles } from './project/files.js';
import { init as initProjectSheets } from './project/sheets.js';
import { init as initHomeHome } from './home/home.js';
import { init as initHomeDragdrop } from './home/dragdrop.js';
import { init as initHomeEmpty } from './home/empty.js';
import { init as initBoot } from './boot.js';
import { registerPWA, handleLaunchFiles } from './pwa.js';
import { S, P, RT, view } from './core/state.js';
import { openSheet } from './project/sheets.js';
import { curSheet } from './project/model.js';
import * as vector from './detect/vector.js';
import { renderAll } from './ui/app.js';

initCoreConstants();
initUiIcons();
initCoreState();
initCanvasRender();
initEditorTools();
initEditorPointer();
initCanvasView();
initEditorKeyboard();
initCoreUndo();
initPlansLoad();
initPanelsPlanos();
initPanelsCapas();
initPanelsSellos();
initCoreStorage();
initUiApp();
initExportFirestop();
initDetectVector();
initPanelsDeteccion();
initProjectFiles();
initProjectSheets();
initHomeHome();
initHomeDragdrop();
initHomeEmpty();
initBoot();

registerPWA();
handleLaunchFiles();

// Solo en desarrollo (o con DEBUG_HOOK=1 al compilar): acceso al estado desde la consola.
if (__DEBUG__) window.__dbg = () => ({S, P, RT, view, openSheet, curSheet, vector, renderAll});
