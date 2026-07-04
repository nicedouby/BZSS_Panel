import { reactive, ref } from "vue";

export function useMapCamera() {
  const x = ref(0);
  const y = ref(0);
  const zoom = ref(1);

  const isDragging = ref(false);

  const dragStart = reactive({
    x: 0,
    y: 0,
    startCamX: 0,
    startCamY: 0,
  });

  function startDrag(clientX: number, clientY: number) {
    isDragging.value = true;

    dragStart.x = clientX;
    dragStart.y = clientY;
    dragStart.startCamX = x.value;
    dragStart.startCamY = y.value;
  }

  function onDrag(clientX: number, clientY: number) {
    if (!isDragging.value) return;

    const dx = clientX - dragStart.x;
    const dy = clientY - dragStart.y;

    x.value = dragStart.startCamX + dx;
    y.value = dragStart.startCamY + dy;
  }

  function endDrag() {
    isDragging.value = false;
  }

  function setZoom(nextZoom: number, centerX: number, centerY: number) {
    const scale = nextZoom / zoom.value;

    // Keep the mouse position anchored during zoom.
    x.value = centerX - (centerX - x.value) * scale;
    y.value = centerY - (centerY - y.value) * scale;

    zoom.value = nextZoom;
  }

  function getTransform() {
    return {
      transform: `translate3d(${x.value}px, ${y.value}px, 0) scale(${zoom.value})`,
    };
  }

  return {
    x,
    y,
    zoom,
    isDragging,
    startDrag,
    onDrag,
    endDrag,
    setZoom,
    getTransform,
  };
}
