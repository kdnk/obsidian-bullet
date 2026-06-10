import {
  applyVerticalLineElementStyle,
  getVerticalLinesMutationObserverOptions,
} from "../verticalLinesDom";

describe("getVerticalLinesMutationObserverOptions", () => {
  test("does not observe style or class attribute churn", () => {
    expect(getVerticalLinesMutationObserverOptions()).toEqual({
      childList: true,
    });
  });
});

describe("applyVerticalLineElementStyle", () => {
  test("writes changed style values only", () => {
    const element = {
      style: {
        top: "",
        left: "",
        width: "",
        height: "",
        display: "",
        customProperties: new Map<string, string>(),
        getPropertyValue(name: string) {
          return this.customProperties.get(name) ?? "";
        },
        setProperty(name: string, value: string) {
          this.customProperties.set(name, value);
        },
      },
      setCssStyles(
        this: { style: Record<string, string> },
        styles: Record<string, string>,
      ) {
        Object.assign(this.style, styles);
      },
    } as unknown as HTMLElement;

    const first = applyVerticalLineElementStyle(element, {
      top: "1px",
      left: "2px",
      width: "18px",
      height: "calc(10px - 2em)",
      guideOffsetX: "9px",
      display: "block",
    });
    const second = applyVerticalLineElementStyle(element, {
      top: "1px",
      left: "2px",
      width: "18px",
      height: "calc(10px - 2em)",
      guideOffsetX: "9px",
      display: "block",
    });
    const third = applyVerticalLineElementStyle(element, {
      top: "1px",
      left: "3px",
      width: "18px",
      height: "calc(10px - 2em)",
      guideOffsetX: "9px",
      display: "block",
    });

    expect(first).toBe(6);
    expect(second).toBe(0);
    expect(third).toBe(1);
  });
});
