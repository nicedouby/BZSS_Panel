export function useExpandableTransition() {
  function onEnter(element: Element) {
    const node = element as HTMLElement;
    node.style.height = "0";
    node.style.opacity = "0";
    node.style.overflow = "hidden";
    node.style.transform = "translateY(-6px)";

    requestAnimationFrame(() => {
      node.style.height = `${node.scrollHeight}px`;
      node.style.opacity = "1";
      node.style.transform = "translateY(0)";
    });
  }

  function onAfterEnter(element: Element) {
    const node = element as HTMLElement;
    node.style.height = "auto";
    node.style.overflow = "";
    node.style.transform = "";
  }

  function onLeave(element: Element) {
    const node = element as HTMLElement;
    node.style.height = `${node.scrollHeight}px`;
    node.style.opacity = "1";
    node.style.overflow = "hidden";
    node.style.transform = "translateY(0)";

    requestAnimationFrame(() => {
      node.style.height = "0";
      node.style.opacity = "0";
      node.style.transform = "translateY(-4px)";
    });
  }

  return {
    onEnter,
    onAfterEnter,
    onLeave,
  };
}
