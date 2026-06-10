import {
  getVerticalLineHeight,
  getVerticalLineLeft,
  getVerticalLineLeftFromX,
  getVerticalLineRootLeft,
  getVerticalLineTop,
  getVerticalLinesContentLeft,
  measureVerticalGuide,
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

  test("measures vertical lines from explicit guide positions", () => {
    expect(getVerticalLineLeftFromX(240, 285)).toBe(45);
  });

  test("centers the clickable area around Obsidian inline list guides", () => {
    const contentLeft = 32;
    const rootX = 44;
    const rootPadding = 28;

    expect(
      measureVerticalGuide({
        contentLeft,
        currentX: rootX,
        currentPadding: 28,
        rootX,
        rootPadding,
        hasCheckbox: false,
      }),
    ).toEqual({ left: 6, width: 18, guideOffsetX: 9 });

    expect(
      measureVerticalGuide({
        contentLeft,
        currentX: 80,
        currentPadding: 64,
        rootX,
        rootPadding,
        hasCheckbox: false,
      }),
    ).toEqual({ left: 42, width: 18, guideOffsetX: 9 });

    expect(
      measureVerticalGuide({
        contentLeft,
        currentX: 116,
        currentPadding: 100,
        rootX,
        rootPadding,
        hasCheckbox: false,
      }),
    ).toEqual({ left: 78, width: 18, guideOffsetX: 9 });
  });

  test("falls back to guide coordinates when line padding is unavailable", () => {
    expect(
      measureVerticalGuide({
        contentLeft: 32,
        currentX: 116,
        currentPadding: null,
        rootX: 44,
        rootPadding: 0,
        hasCheckbox: false,
      }),
    ).toEqual({ left: 78, width: 18, guideOffsetX: 9 });
  });

  test("clips the line top when the list starts above the visible range", () => {
    expect(getVerticalLineTop(true, 84)).toBe(-20);
    expect(getVerticalLineTop(false, 84)).toBe(84);
  });

  test("names the height trimming for lines with and without visible siblings", () => {
    expect(getVerticalLineHeight(131.875, true)).toBe(
      "calc(131.875px - 1.5em)",
    );
    expect(getVerticalLineHeight(52.75, false)).toBe("calc(52.75px - 2em)");
  });

  test("does not trim lines clipped by the visible range bottom", () => {
    expect(getVerticalLineHeight(16, false, true)).toBe("16px");
  });
});
