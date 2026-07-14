import { Settings, SettingsObject } from "../Settings";

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
  } as Omit<SettingsObject, "outerListLines">;
  const storage = {
    loadData: jest.fn(async () => saved as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.outerVerticalLines).toBe(true);
});
