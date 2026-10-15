import { DocumentBodyClass } from "../DocumentBodyClass";

function makeDocument() {
  const classes = new Set<string>();
  return {
    body: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
    },
  };
}

function makePlugin(
  mainDocument: ReturnType<typeof makeDocument>,
  documents: ReturnType<typeof makeDocument>[],
) {
  type Handler = (...args: never[]) => void;
  const handlers = new Map<string, Handler>();
  const workspace = {
    containerEl: { ownerDocument: mainDocument },
    iterateAllLeaves(callback: (leaf: unknown) => void) {
      documents.forEach((ownerDocument) =>
        callback({ view: { containerEl: { ownerDocument } } }),
      );
    },
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
      return { name };
    },
    offref(ref: { name: string }) {
      handlers.delete(ref.name);
    },
  };
  return {
    plugin: { app: { workspace }, registerEvent: jest.fn() },
    emit: (name: string, document: ReturnType<typeof makeDocument>) => {
      handlers.get(name)?.({} as never, { document } as never);
    },
  };
}

afterEach(() => Reflect.deleteProperty(global, "activeDocument"));

test("seeds all existing documents and the main window while a popout is focused", () => {
  const main = makeDocument();
  const active = makeDocument();
  const background = makeDocument();
  Object.defineProperty(global, "activeDocument", {
    configurable: true,
    value: active,
  });
  const { plugin, emit } = makePlugin(main, [active, background, background]);
  let enabled = true;
  const feature = new DocumentBodyClass(
    plugin as never,
    "bullet-test",
    () => enabled,
  );
  feature.load();
  for (const document of [main, active, background]) {
    expect(document.body.classList.contains("bullet-test")).toBe(true);
  }
  enabled = false;
  feature.update();
  for (const document of [main, active, background]) {
    expect(document.body.classList.contains("bullet-test")).toBe(false);
  }
  enabled = true;
  feature.update();
  emit("window-close", background);
  expect(background.body.classList.contains("bullet-test")).toBe(false);
  feature.unload();
  for (const document of [main, active, background]) {
    expect(document.body.classList.contains("bullet-test")).toBe(false);
  }
});

test("does not apply classes to later windows after unloading", () => {
  const main = makeDocument();
  Object.defineProperty(global, "activeDocument", {
    configurable: true,
    value: main,
  });
  const { plugin, emit } = makePlugin(main, [main]);
  const feature = new DocumentBodyClass(
    plugin as never,
    "bullet-test",
    () => true,
  );
  feature.load();
  feature.unload();
  const popout = makeDocument();
  emit("window-open", popout);
  expect(popout.body.classList.contains("bullet-test")).toBe(false);
});
