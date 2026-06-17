import type { Directive } from "vue";

const backdropCloseState = new WeakMap<HTMLElement, {
  mouseDownTargetIsSelf: boolean;
  handleMouseDown: (event: MouseEvent) => void;
  handleClick: (event: MouseEvent) => void;
}>();

export const backdropCloseDirective: Directive<HTMLElement, (event: MouseEvent) => void> = {
  mounted(el, binding) {
    const state = {
      mouseDownTargetIsSelf: false,
      handleMouseDown(event: MouseEvent) {
        // True if the mousedown event actually occurred on the backdrop itself
        state.mouseDownTargetIsSelf = event.target === el;
      },
      handleClick(event: MouseEvent) {
        // Only trigger the close callback if both the mousedown target and click target were the backdrop itself
        if (state.mouseDownTargetIsSelf && event.target === el) {
          binding.value(event);
        }
        state.mouseDownTargetIsSelf = false;
      }
    };

    el.addEventListener("mousedown", state.handleMouseDown);
    el.addEventListener("click", state.handleClick);
    backdropCloseState.set(el, state);
  },
  unmounted(el) {
    const state = backdropCloseState.get(el);
    if (state) {
      el.removeEventListener("mousedown", state.handleMouseDown);
      el.removeEventListener("click", state.handleClick);
      backdropCloseState.delete(el);
    }
  }
};
