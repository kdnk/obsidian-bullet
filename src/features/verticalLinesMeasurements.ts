export function getVerticalLinesContentLeft(view: {
  contentDOM: {
    parentElement: Pick<HTMLElement, "offsetLeft"> | null;
  };
  dom: Pick<HTMLElement, "querySelector">;
  scrollDOM: Pick<HTMLElement, "getBoundingClientRect" | "scrollLeft">;
}) {
  const cmLine = view.dom.querySelector("div.cm-line");
  if (isElementLike(cmLine)) {
    return (
      cmLine.getBoundingClientRect().left -
      view.scrollDOM.getBoundingClientRect().left +
      view.scrollDOM.scrollLeft
    );
  }

  return view.contentDOM.parentElement?.offsetLeft ?? 0;
}

export function getVerticalLineLeft(
  rootLeft: number,
  coords: Pick<DOMRect, "right">,
) {
  return Math.floor(coords.right - rootLeft);
}

export function getVerticalLineLeftFromX(rootX: number, currentX: number) {
  return Math.floor(currentX - rootX);
}

export function measureVerticalGuide({
  contentLeft,
  currentX,
  currentPadding,
  rootX,
  rootPadding,
  hasCheckbox,
}: {
  contentLeft: number;
  currentX: number;
  currentPadding: number | null;
  rootX: number;
  rootPadding: number;
  hasCheckbox: boolean;
}) {
  const uncenteredLeft =
    currentPadding === null
      ? getVerticalLineLeftFromX(rootX, currentX)
      : currentPadding - rootPadding;
  const fineTune = hasCheckbox ? -1 : 3;
  const uncenteredGuideOffsetX =
    currentX - contentLeft - uncenteredLeft + fineTune;
  const width = 18;
  const guideOffsetX = width / 2;
  const left = uncenteredLeft + uncenteredGuideOffsetX - guideOffsetX;

  return {
    left,
    width,
    guideOffsetX,
  };
}

const CLIPPED_LINE_TOP = -20;
const LINE_HEIGHT_WITH_NEXT_SIBLING = "1.5em";
const LINE_HEIGHT_WITHOUT_NEXT_SIBLING = "2em";

export function getVerticalLineTop(isClipped: boolean, lineBlockTop: number) {
  return isClipped ? CLIPPED_LINE_TOP : lineBlockTop;
}

export function getVerticalLineHeight(
  rawHeight: number,
  hasNextSibling: boolean,
  isClippedAtVisibleBottom = false,
) {
  if (isClippedAtVisibleBottom) {
    return `${rawHeight}px`;
  }

  return `calc(${rawHeight}px - ${
    hasNextSibling
      ? LINE_HEIGHT_WITH_NEXT_SIBLING
      : LINE_HEIGHT_WITHOUT_NEXT_SIBLING
  })`;
}

export function getVerticalLineRootLeft(
  contentLeft: number,
  coords: Pick<DOMRect, "left">,
  hasCheckbox: boolean,
) {
  return hasCheckbox ? contentLeft : coords.left;
}

function isElementLike(
  value: unknown,
): value is Pick<HTMLElement, "getBoundingClientRect"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getBoundingClientRect" in value &&
    typeof value.getBoundingClientRect === "function"
  );
}
