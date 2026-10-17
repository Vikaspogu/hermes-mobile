/**
 * Registry of dismissible UI layers (drawer, sheets, palettes, keyboard) that
 * Android/browser Back should consume before it navigates between screens.
 * Higher priority dismisses first; ties break to the most recent registration.
 */

export interface BackLayer {
  priority: number;
  dismiss: () => void;
}

interface RegisteredLayer extends BackLayer {
  id: number;
}

const layers: RegisteredLayer[] = [];
let nextId = 0;

export function registerBackLayer(layer: BackLayer): () => void {
  const entry: RegisteredLayer = { ...layer, id: nextId++ };
  layers.push(entry);
  return () => {
    const index = layers.indexOf(entry);
    if (index !== -1) layers.splice(index, 1);
  };
}

/** Dismiss the topmost open layer. Returns true when a layer consumed the back press. */
export function dismissTopBackLayer(): boolean {
  const top = [...layers].sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
  if (!top) return false;
  top.dismiss();
  return true;
}

/** Test helper. */
export function clearBackLayers(): void {
  layers.length = 0;
}
