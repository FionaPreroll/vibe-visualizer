/**
 * Closes a modal dialog on a click on its backdrop: pressed and let go outside the dialog. The
 * browser reports a drag that starts inside (selecting text in a field) and ends outside as a
 * click on the dialog too; that one leaves it open. Spread the handlers on the `<dialog>`.
 */
export function backdropClose(onclose: () => void): {
  onpointerdown: (event: PointerEvent) => void;
  onclick: (event: MouseEvent) => void;
} {
  let pressedOutside = false;
  const outside = (event: MouseEvent) => {
    const dialog = event.currentTarget as HTMLElement;
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  return {
    onpointerdown: (event) => {
      pressedOutside = outside(event);
    },
    onclick: (event) => {
      if (pressedOutside && outside(event)) onclose();
      pressedOutside = false;
    },
  };
}
