import { Settings, SettingsChange, SettingsObject } from "../Settings";

test("enables outer vertical lines when saved data predates the setting", async () => {
  const saved = {
    styleLists: true,
    debug: false,
    stickCursor: "bullet-and-checkbox",
    betterEnter: true,
    betterVimO: true,
    betterTab: true,
    selectAll: true,
    listLines: true,
    listLineAction: "toggle-folding",
    dnd: true,
  } as Omit<SettingsObject, "outerListLines" | "mobileRightFoldControls">;
  const storage = {
    loadData: jest.fn(async () => saved as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.outerVerticalLines).toBe(true);
});

test("enables mobile right fold controls when saved data predates the setting", async () => {
  const storage = {
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.mobileRightFoldControls).toBe(true);
});

describe("change notifications", () => {
  function createSettings() {
    return new Settings({
      loadData: jest.fn(async () => ({}) as SettingsObject),
      saveData: jest.fn(async () => undefined),
    });
  }

  test("does not notify when assigning the current value", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["debug"], callback);

    settings.debug = false;

    expect(callback).not.toHaveBeenCalled();
  });

  test("notifies only subscriptions containing the changed key", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["listLines"], callback);

    settings.debug = true;
    expect(callback).not.toHaveBeenCalled();

    settings.verticalLines = false;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(new Set(["listLines"]));
  });

  test("notifies a multi-key subscription when one dependency changes", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["listLines", "outerListLines"], callback);

    settings.outerVerticalLines = false;

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["outerListLines"]),
    );
  });

  test("notifies subscribers when mobile right fold controls change", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["mobileRightFoldControls"], callback);

    settings.mobileRightFoldControls = false;

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["mobileRightFoldControls"]),
    );
  });

  test("notifies once with every changed key when resetting", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(
      ["debug", "listLines", "outerListLines", "betterEnter"],
      callback,
    );
    settings.debug = true;
    settings.verticalLines = false;
    settings.outerVerticalLines = false;
    callback.mockClear();

    settings.reset();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["debug", "listLines", "outerListLines"]),
    );
  });

  test("does not notify after unsubscribing", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["debug"], callback);

    settings.removeCallback(callback);
    settings.debug = true;

    expect(callback).not.toHaveBeenCalled();
  });

  test("updates and notifies through the generic setting API", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["debug"], callback);

    settings.setValue("debug", true);

    expect(settings.debug).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(new Set(["debug"]));
  });

  test("does not notify through the generic setting API when unchanged", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["debug"], callback);

    settings.setValue("debug", false);

    expect(callback).not.toHaveBeenCalled();
  });
});
