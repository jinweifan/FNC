import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import "./i18n";
import App from "./App";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { applyThemePaletteToDom, getBootThemePalette, resolveBootTheme } from "./lib/themeBoot";
import { createStartupPaintNotifier } from "./lib/startupReveal";

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

const storedThemeMode = (() => {
  try {
    return localStorage.getItem("fnc.themeMode");
  } catch {
    return null;
  }
})();

const resolvedBootTheme = resolveBootTheme(
  storedThemeMode === "dark" ? "navy" : storedThemeMode,
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
);
const bootPalette = getBootThemePalette(resolvedBootTheme);

applyThemePaletteToDom(document, resolvedBootTheme, bootPalette);

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const tauriTheme = resolvedBootTheme === "light" ? "light" : "dark";
  void getCurrentWindow().setBackgroundColor(bootPalette.background).catch(() => {});
  void getCurrentWindow().setTheme(tauriTheme).catch(() => {});
}

const startupPaintNotifier =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? createStartupPaintNotifier(() => {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("notify_startup_painted"))
          .catch(() => {});
      })
    : null;

if (startupPaintNotifier) {
  void listen("startup-window-shown", () => {
    startupPaintNotifier.onWindowShown();
  }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  window.setTimeout(() => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("notify_startup_ready"))
      .catch(() => {});
  }, 0);
}
