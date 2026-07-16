import { Logger } from "../Logger";
import { Settings, SettingsObject } from "../Settings";

function makeSettings(): Settings {
  return new Settings({
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  });
}

test("does not call the sink when debug mode is disabled", () => {
  const sink = jest.fn<void, [string, ...unknown[]]>();
  const logger = new Logger(makeSettings(), sink);

  logger.log("parse", "value");

  expect(sink).not.toHaveBeenCalled();
});

test("forwards debug logs through the injected sink", () => {
  const sink = jest.fn<void, [string, ...unknown[]]>();
  const settings = makeSettings();
  settings.debug = true;
  const logger = new Logger(settings, sink);

  logger.log("parse", "value");

  expect(sink).toHaveBeenCalledWith("parse", "value");
});
