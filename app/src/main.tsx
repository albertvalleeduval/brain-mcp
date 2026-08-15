import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker : /capture doit pouvoir s'ouvrir sans réseau, sinon la file
// d'attente de la capture ne sert à rien. Enregistré après le load pour ne pas
// disputer la bande passante au premier rendu. Un échec est sans conséquence.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
