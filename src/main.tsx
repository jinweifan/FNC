import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import editorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker?worker&url";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (moduleId: string, label: string) => Worker;
    };
  }
}

// Explicit worker wiring for Tauri/WebKit (Ubuntu 22.04+) to avoid Monaco infinite loading.
window.MonacoEnvironment = {
  getWorker(_moduleId: string, _label: string) {
    // Classic worker URL is more compatible with Linux WebKitGTK runtimes.
    return new Worker(editorWorkerUrl, { name: "monaco-editor-worker" });
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
