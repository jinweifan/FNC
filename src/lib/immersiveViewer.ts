export type ImmersivePaneState = {
  showFiles: boolean;
  showEditor: boolean;
  showViewer: boolean;
};

export function enterImmersivePanes(_: ImmersivePaneState): ImmersivePaneState {
  return {
    showFiles: false,
    showEditor: false,
    showViewer: true,
  };
}

export function toggleImmersiveDrawer(
  state: ImmersivePaneState,
  drawer: "files" | "editor",
): ImmersivePaneState {
  if (drawer === "files") {
    return {
      showFiles: !state.showFiles,
      showEditor: false,
      showViewer: true,
    };
  }
  return {
    showFiles: false,
    showEditor: !state.showEditor,
    showViewer: true,
  };
}

export function exitImmersivePanes(state: ImmersivePaneState): ImmersivePaneState {
  return {
    ...state,
    showViewer: true,
  };
}
