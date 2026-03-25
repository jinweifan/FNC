import test from "node:test";
import assert from "node:assert/strict";
import { applyThemePaletteToDom, getBootThemePalette, resolveBootTheme } from "./themeBoot.ts";

test("resolveBootTheme keeps explicit navy and dark themes", () => {
  assert.equal(resolveBootTheme("navy", false), "navy");
  assert.equal(resolveBootTheme("xdark", false), "dark");
  assert.equal(resolveBootTheme("light", true), "light");
});

test("resolveBootTheme follows system preference when mode is system", () => {
  assert.equal(resolveBootTheme("system", false), "light");
  assert.equal(resolveBootTheme("system", true), "dark");
});

test("getBootThemePalette returns non-white startup colors for dark themes", () => {
  assert.deepEqual(getBootThemePalette("navy"), {
    background: "#020617",
    text: "#dbeafe",
    panel: "#0f172a",
    border: "#334155",
    muted: "#94a3b8",
  });
  assert.deepEqual(getBootThemePalette("dark"), {
    background: "#000000",
    text: "#e7e9ea",
    panel: "#16181c",
    border: "#2f3336",
    muted: "#71767b",
  });
});

test("applyThemePaletteToDom updates html body and root together", () => {
  const makeStyle = () => {
    const store = new Map<string, string>();
    return {
      store,
      backgroundColor: "",
      color: "",
      colorScheme: "",
      setProperty(name: string, value: string) {
        store.set(name, value);
      },
    };
  };

  const htmlStyle = makeStyle();
  const bodyStyle = makeStyle();
  const rootStyle = makeStyle();
  const rootAttrs = new Map<string, string>();
  const doc = {
    documentElement: {
      style: htmlStyle,
      setAttribute(name: string, value: string) {
        rootAttrs.set(name, value);
      },
    },
    body: { style: bodyStyle },
    getElementById(id: string) {
      return id === "root" ? { style: rootStyle } : null;
    },
  };

  applyThemePaletteToDom(doc, "dark", getBootThemePalette("dark"));

  assert.equal(rootAttrs.get("data-theme"), "dark");
  assert.equal(htmlStyle.backgroundColor, "#000000");
  assert.equal(bodyStyle.backgroundColor, "#000000");
  assert.equal(rootStyle.backgroundColor, "#000000");
  assert.equal(rootStyle.color, "#e7e9ea");
  assert.equal(htmlStyle.store.get("--boot-panel"), "#16181c");
});
