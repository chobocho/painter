// Browser entry point. Boots PainterApp into #app.

import { PainterApp } from "./PainterApp.js";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (!root) return;
  const app = new PainterApp();
  app.boot(root).catch((e) => console.error("Painter boot failed", e));
});
