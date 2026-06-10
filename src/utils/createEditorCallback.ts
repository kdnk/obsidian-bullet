import { Editor } from "obsidian";

import { MyEditor } from "../editor";

export function createEditorCallback(cb: (editor: MyEditor) => boolean) {
  return (editor: Editor) => {
    const myEditor = new MyEditor(editor);
    const shouldStopPropagation = cb(myEditor);
    const currentEvent: unknown = Reflect.get(window, "event");

    if (
      !shouldStopPropagation &&
      currentEvent instanceof KeyboardEvent &&
      currentEvent.type === "keydown"
    ) {
      myEditor.triggerOnKeyDown(currentEvent);
    }
  };
}
