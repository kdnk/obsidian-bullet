export interface VerticalLineElementStyle {
  top: string;
  left: string;
  width: string;
  height: string;
  guideOffsetX: string;
  display: string;
}

export function getVerticalLinesMutationObserverOptions(): MutationObserverInit {
  return {
    childList: true,
  };
}

export function applyVerticalLineElementStyle(
  element: HTMLElement,
  style: VerticalLineElementStyle,
) {
  let writes = 0;

  writes += setStyleProperty(element, "top", style.top);
  writes += setStyleProperty(element, "left", style.left);
  writes += setStyleProperty(element, "width", style.width);
  writes += setStyleProperty(element, "height", style.height);
  writes += setStyleProperty(element, "display", style.display);

  const propertyName = "--bullet-guide-offset-x";
  if (element.style.getPropertyValue(propertyName) !== style.guideOffsetX) {
    element.style.setProperty(propertyName, style.guideOffsetX);
    writes += 1;
  }

  return writes;
}

function setStyleProperty(
  element: HTMLElement,
  propertyName: "top" | "left" | "width" | "height" | "display",
  value: string,
) {
  if (element.style[propertyName] === value) {
    return 0;
  }

  element.setCssStyles({ [propertyName]: value });
  return 1;
}
