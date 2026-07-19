import { Settings, SettingsChange, SettingsObject } from "../Settings";

test("enables body text enforcement for saved data predating the setting", async () => {
  const settings = new Settings({
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  });

  await settings.load();

  expect(settings.keepBodyTextInBullets).toBe(true);
});

test("enables outer vertical lines when saved data predates the setting", async () => {
  const saved = {
    styleLists: true,
    debug: false,
    stickCursor: "bullet-and-checkbox",
    betterEnter: true,
    betterVimO: true,
    betterTab: true,
    selectAll: true,
    listLineAction: "toggle-folding",
    dnd: true,
  } as Omit<
    SettingsObject,
    "keepBodyTextInBullets" | "outerListLines" | "mobileRightFoldControls"
  >;
  const storage = {
    loadData: jest.fn(async () => saved as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.outerVerticalLines).toBe(true);
});

test("migrates a disabled legacy vertical-lines setting", async () => {
  const saveData = jest.fn(async () => undefined);
  const settings = new Settings({
    loadData: jest.fn(async () => ({
      listLines: false,
      outerListLines: true,
      listLineAction: "toggle-folding",
    })) as never,
    saveData,
  });

  await settings.load();
  await settings.save();

  expect(settings.outerVerticalLines).toBe(false);
  expect(settings.verticalLinesAction).toBe("none");
  expect(settings.getValues()).not.toHaveProperty("listLines");
  expect(saveData).toHaveBeenCalledWith(settings.getValues());
});

test("preserves direct settings when legacy vertical lines were enabled", async () => {
  const settings = new Settings({
    loadData: jest.fn(async () => ({
      listLines: true,
      outerListLines: false,
      listLineAction: "none",
    })) as never,
    saveData: jest.fn(async () => undefined),
  });

  await settings.load();

  expect(settings.outerVerticalLines).toBe(false);
  expect(settings.verticalLinesAction).toBe("none");
  expect(settings.getValues()).not.toHaveProperty("listLines");
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
    settings.onChange(["outerListLines"], callback);

    settings.debug = true;
    expect(callback).not.toHaveBeenCalled();

    settings.outerVerticalLines = false;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["outerListLines"]),
    );
  });

  test("notifies a multi-key subscription when one dependency changes", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["outerListLines", "listLineAction"], callback);

    settings.verticalLinesAction = "none";

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["listLineAction"]),
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

  test("notifies subscribers when body text enforcement changes", async () => {
    const settings = new Settings({
      loadData: jest.fn(async () => ({}) as SettingsObject),
      saveData: jest.fn(async () => undefined),
    });
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(["keepBodyTextInBullets"], callback);

    settings.keepBodyTextInBullets = false;

    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["keepBodyTextInBullets"]),
    );
  });

  test("notifies once with every changed key when resetting", () => {
    const settings = createSettings();
    const callback = jest.fn<void, [SettingsChange]>();
    settings.onChange(
      ["debug", "outerListLines", "listLineAction", "betterEnter"],
      callback,
    );
    settings.debug = true;
    settings.outerVerticalLines = false;
    settings.verticalLinesAction = "none";
    callback.mockClear();

    settings.reset();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].keys).toEqual(
      new Set(["debug", "outerListLines", "listLineAction"]),
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
