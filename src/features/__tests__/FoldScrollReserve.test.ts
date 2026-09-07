import { Platform } from "obsidian";

import { Extension } from "@codemirror/state";

import { Settings } from "../../services/Settings";
import {
  FoldScrollReserve,
  FoldScrollReservePluginValue,
} from "../FoldScrollReserve";

jest.mock("obsidian", () => ({ Platform: { isMobile: false } }), {
  virtual: true,
});

function makeView() {
  const properties = new Map<string, string>();
  const classes = new Set<string>();
  const measurements: Array<{ read(): number; write(value: number): void }> =
    [];
  const view = {
    scrollDOM: { clientHeight: 544 },
    defaultLineHeight: 24,
    documentPadding: { top: 0 },
    dom: {
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      },
      classList: {
        add: (key: string) => classes.add(key),
        remove: (key: string) => classes.delete(key),
      },
    },
    requestMeasure: (request: (typeof measurements)[number]) =>
      measurements.push(request),
  };
  const flush = () => {
    for (const request of measurements.splice(0)) request.write(request.read());
  };
  return { view, properties, classes, flush };
}

describe("fold scroll reserve", () => {
  test("publishes the standard reserve outside Obsidian's content style", () => {
    const { view, properties, classes, flush } = makeView();
    new FoldScrollReservePluginValue(view as never);
    expect(classes.size).toBe(0);
    flush();
    expect(properties.get("--bullet-fold-scroll-reserve")).toBe("519.5px");
    expect(classes.has("bullet-plugin-fold-scroll-reserve")).toBe(true);
  });

  test("tracks editor height changes including a smaller split pane", () => {
    const { view, properties, flush } = makeView();
    const plugin = new FoldScrollReservePluginValue(view as never);
    flush();
    view.scrollDOM.clientHeight = 300;
    plugin.update({ geometryChanged: true } as never);
    flush();
    expect(properties.get("--bullet-fold-scroll-reserve")).toBe("275.5px");
  });

  test("does not leave a reserve when disabled during a pending measurement", () => {
    const { view, properties, classes, flush } = makeView();
    const plugin = new FoldScrollReservePluginValue(view as never);
    flush();
    plugin.update({ geometryChanged: true } as never);
    plugin.destroy();
    flush();
    expect(properties.size).toBe(0);
    expect(classes.size).toBe(0);
  });
});

describe("fold reserve ownership", () => {
  function setup(mobile: boolean, guides: boolean, rightControls: boolean) {
    (Platform as { isMobile: boolean }).isMobile = mobile;
    const settings = new Settings({
      loadData: async () => null,
      saveData: async () => {},
    });
    settings.verticalLinesAction = guides ? "toggle-folding" : "none";
    settings.mobileRightFoldControls = rightControls;
    let extensions: Extension[] = [];
    const updateOptions = jest.fn();
    const feature = new FoldScrollReserve(
      {
        app: { workspace: { updateOptions } },
        registerEditorExtension: (value: Extension[]) => {
          extensions = value;
        },
      } as never,
      settings,
    );
    return { feature, settings, updateOptions, extensions: () => extensions };
  }

  test.each([
    [false, false, false, true],
    [false, true, false, true],
    [true, false, false, false],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, true, true],
  ])(
    "mobile=%s guides=%s rightControls=%s reserves=%s",
    async (mobile, guides, rightControls, enabled) => {
      const context = setup(mobile, guides, rightControls);
      await context.feature.load();
      expect(context.extensions()).toHaveLength(enabled ? 1 : 0);
      expect(context.updateOptions).not.toHaveBeenCalled();
      await context.feature.unload();
    },
  );

  test("keeps desktop native folding protected when guides are disabled", async () => {
    const context = setup(false, true, false);
    await context.feature.load();
    const reserve = context.extensions()[0];
    context.settings.verticalLinesAction = "none";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).not.toHaveBeenCalled();
    await context.feature.unload();
  });

  test("shares the mobile reserve and reconfigures only when the last consumer changes", async () => {
    const context = setup(true, true, true);
    await context.feature.load();
    const reserve = context.extensions()[0];
    context.settings.verticalLinesAction = "none";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).not.toHaveBeenCalled();
    context.settings.mobileRightFoldControls = false;
    expect(context.extensions()).toEqual([]);
    expect(context.updateOptions).toHaveBeenCalledTimes(1);
    context.settings.verticalLinesAction = "toggle-folding";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).toHaveBeenCalledTimes(2);
    await context.feature.unload();
    context.settings.verticalLinesAction = "none";
    expect(context.updateOptions).toHaveBeenCalledTimes(2);
  });
});
