type PaintCallback = () => void;

type StartupPaintNotifier = {
  onWindowShown: () => void;
  hasPainted: () => boolean;
  flush: () => Promise<void>;
};

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });

export function createStartupPaintNotifier(onPainted: PaintCallback): StartupPaintNotifier {
  let paintScheduled = false;
  let painted = false;
  let pending: Promise<void> | null = null;

  const schedulePaint = () => {
    if (paintScheduled || painted) return;
    paintScheduled = true;
    pending = (async () => {
      await nextFrame();
      await nextFrame();
      if (painted) return;
      painted = true;
      onPainted();
    })();
  };

  return {
    onWindowShown() {
      schedulePaint();
    },
    hasPainted() {
      return painted;
    },
    async flush() {
      await pending;
    },
  };
}
