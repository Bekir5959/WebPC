// ui.js
import { initCanvas } from './canvas.js';
import { initToolbar } from './toolbar.js';
import { initHUD } from './hud.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('screen');
  const hud = document.getElementById('hud');
  const toolbar = document.getElementById('toolbar');

  initCanvas(canvas);
  initToolbar(toolbar, canvas);
  initHUD(hud);
}); 