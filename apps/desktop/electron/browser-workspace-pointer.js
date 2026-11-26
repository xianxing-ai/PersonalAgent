// Coordinates are local to the observed page, in CSS pixels. They never move the OS mouse.
export function createWorkspacePointer({now = Date.now, onUpdate = () => {}} = {}) {
  let current;
  let revision = 0;
  function clear() {
    revision++;
    current = undefined;
  }
  async function mark(page, target, action) {
    const request = ++revision;
    current = undefined;
    try {
      const url = page.url();
      const point = await target.evaluate(element => {
        if (!element.isConnected || element.ownerDocument !== document) return;
        const {width, height} = document.documentElement.getBoundingClientRect();
        const viewWidth = window.innerWidth, viewHeight = window.innerHeight;
        if (!width || !height || !viewWidth || !viewHeight) return;
        const style = getComputedStyle(element);
        if (style.visibility !== 'visible' || style.display === 'none') return;
        for (const rect of element.getClientRects()) {
          const left = Math.max(0, rect.left), right = Math.min(viewWidth, rect.right);
          const top = Math.max(0, rect.top), bottom = Math.min(viewHeight, rect.bottom);
          if (right <= left || bottom <= top) continue;
          const x = (left + right) / 2, y = (top + bottom) / 2;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === element || element.contains(hit)))
            return {x, y, width: viewWidth, height: viewHeight};
        }
      }, undefined, {timeout: 300});
      if (revision !== request || !point || page.isClosed() || page.url() !== url) return;
      current = {page, url, point: {...point, action, at: now()}};
      onUpdate();
    } catch {
      // Navigation or a detached control can outlive its visible marker.
    }
  }
  function state(page) {
    if (!current || current.page !== page || page.isClosed() || current.url !== page.url()
        || now() - current.point.at > 2200) return;
    return {...current.point};
  }
  return {mark, state, clear};
}
