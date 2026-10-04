/**
 * Moves the element into `target` while there is one, and back to where it was when there is
 * none: the stage into the mini player's window (DS-06). Svelte keeps updating it wherever it is.
 * A comment marks its place at home.
 */
export function portal(node: HTMLElement, target: HTMLElement | null) {
  const home = node.ownerDocument.createComment('portal');
  node.after(home);
  const move = (to: HTMLElement | null) => {
    if (to) to.append(node);
    else if (node.nextSibling !== home) home.before(node);
  };
  move(target);
  return {
    update: move,
    destroy() {
      home.remove();
    },
  };
}
