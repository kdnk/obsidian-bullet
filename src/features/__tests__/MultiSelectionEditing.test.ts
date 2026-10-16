import { Plugin } from "obsidian";

import { makeEditor, makeLogger, makeSettings } from "../../__mocks__";
import { NO_OP_OUTCOME } from "../../operations/Operation";
import { ChangesApplicator } from "../../services/ChangesApplicator";
import { IMEDetector } from "../../services/IMEDetector";
import { ObsidianSettings } from "../../services/ObsidianSettings";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Parser } from "../../services/Parser";
import { EnterBehaviourOverride } from "../EnterBehaviourOverride";
import { ShiftTabBehaviourOverride } from "../ShiftTabBehaviourOverride";
import { TabBehaviourOverride } from "../TabBehaviourOverride";

jest.mock("obsidian", () => ({ Editor: class {}, Plugin: class {} }), {
  virtual: true,
});

describe("structural editing with selections in separate list blocks", () => {
  test.each(["Enter", "Shift-Enter", "Tab", "Shift-Tab", "indentLess"])(
    "%s delegates multiple selections to the native editor",
    (key) => {
      const editor = makeEditor({
        text: "- one\n\n- two",
        cursor: { line: 0, ch: 5 },
      });
      editor.listSelections = () => [
        { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 5 } },
        { anchor: { line: 2, ch: 5 }, head: { line: 2, ch: 5 } },
      ];
      const settings = makeSettings();
      const apply = jest.fn();
      const performer = new OperationPerformer(
        new Parser(makeLogger(), settings),
        { apply } as unknown as ChangesApplicator,
      );
      const plugin = {} as Plugin;
      const ime = { isOpened: () => false } as IMEDetector;
      const nativeSettings = {
        isSmartIndentListEnabled: () => true,
        getDefaultIndentChars: () => "\t",
      } as ObsidianSettings;
      const enter = new EnterBehaviourOverride(
        plugin,
        settings,
        ime,
        nativeSettings,
        performer,
      );
      const tab = new TabBehaviourOverride(
        plugin,
        ime,
        nativeSettings,
        settings,
        performer,
      );
      const shiftTab = new ShiftTabBehaviourOverride(
        plugin,
        ime,
        nativeSettings,
        settings,
        performer,
      );
      const result =
        key === "Enter"
          ? enter["run"](editor)
          : key === "Shift-Enter"
            ? enter["runShiftEnter"](editor)
            : key === "Tab"
              ? tab["run"](editor)
              : key === "Shift-Tab"
                ? shiftTab["run"](editor)
                : tab["runOutdent"](editor);
      expect(result).toEqual(NO_OP_OUTCOME);
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
