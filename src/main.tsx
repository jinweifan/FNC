import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

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
    return new EditorWorker({ name: "monaco-editor-worker" });
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
