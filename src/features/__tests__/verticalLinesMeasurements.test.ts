import {
  getVerticalLineLeft,
  getVerticalLineRootLeft,
  getVerticalLinesContentLeft,
} from "../verticalLinesMeasurements";

describe("getVerticalLinesContentLeft", () => {
  test("uses the rendered line position so line-number gutters are included", () => {
    const line = {
      getBoundingClientRect: jest.fn().mockReturnValue({ left: 188 }),
    };
    const scrollDOM = {
      getBoundingClientRect: jest.fn().mockReturnValue({ left: 100 }),
      scrollLeft: 24,
    };
    const contentParent = { offsetLeft: 56 };
    const view: Parameters<typeof getVerticalLinesContentLeft>[0] = {
      dom: {
        querySelector: jest
          .fn()
          .mockImplementation((selector: string) =>
            selector === "div.cm-line" ? line : null,
          ),
      },
      scrollDOM,
      contentDOM: {
        parentElement: contentParent,
      },
    };

    expect(getVerticalLinesContentLeft(view)).toBe(112);
  });

  test("falls back to the content container offset when no line is rendered", () => {
    const contentParent = { offsetLeft: 56 };
    const view: Parameters<typeof getVerticalLinesContentLeft>[0] = {
      dom: {
        querySelector: jest.fn().mockReturnValue(null),
      },
      scrollDOM: {
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 100 }),
        scrollLeft: 24,
      },
      contentDOM: {
        parentElement: contentParent,
      },
    };

    expect(getVerticalLinesContentLeft(view)).toBe(56);
  });

  test("returns zero when neither measurement is available", () => {
    const view: Parameters<typeof getVerticalLinesContentLeft>[0] = {
      dom: {
        querySelector: jest.fn().mockReturnValue(null),
      },
      scrollDOM: {
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 100 }),
        scrollLeft: 24,
      },
      contentDOM: {
        parentElement: null,
      },
    };

    expect(getVerticalLinesContentLeft(view)).toBe(0);
  });

  test("measures vertical lines from the content edge instead of the parent line", () => {
    expect(getVerticalLineLeft(188, { right: 300 } as DOMRect)).toBe(112);
  });

  test("uses the content edge as the root baseline for checkbox items", () => {
    expect(getVerticalLineRootLeft(188, { left: 240 } as DOMRect, true)).toBe(
      188,
    );
  });

  test("uses the rendered line position as the root baseline for regular bullets", () => {
    expect(getVerticalLineRootLeft(188, { left: 240 } as DOMRect, false)).toBe(
      240,
    );
  });
});
