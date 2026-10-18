import * as THREE from 'three';
import { tileOf } from '@corsair/data';
import type { RasterMapDef, SeaName } from '@corsair/data';

// The names lettered on the sea (Pirates! 2004 writes "Dominica Passage" and "Governor Reef" across the water): a
// faint white serif lying flat on the sea, so the open sea has places in it. A sea's name shows zoomed out, a
// passage's or a bank's from the sailing zoom. Only overhead: from astern, flat lettering would be unreadable.

/**
 * Each kind's lettering, its height a share of the camera's distance (so the same size on screen at every zoom),
 * and the camera distances (tiles) over which it fades in, and then out.
 */
const KINDS: Record<SeaName['kind'], { height: number; in: [number, number]; out: [number, number]; alpha: number }> = {
  sea: { height: 0.06, in: [90, 160], out: [Infinity, Infinity], alpha: 0.35 },
  passage: { height: 0.045, in: [14, 24], out: [260, 420], alpha: 0.6 },
  bank: { height: 0.04, in: [14, 24], out: [200, 320], alpha: 0.6 },
};
/** Just above the mean sea, so a swell's crest hides a letter now and then, as if written on the water. */
const LIFT = 0.5;

export function createSeaNames(def: RasterMapDef, names: SeaName[]) {
  const object = new THREE.Group();
  const labels = names.map((n) => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = `italic 600 64px Georgia, serif`;
    ctx.font = font;
    const text = n.kind === 'sea' ? n.name.toUpperCase() : n.name;
    // Seas spaced out wide, as a chart letters them.
    const spacing = n.kind === 'sea' ? 18 : 2;
    const width = Math.ceil(ctx.measureText(text).width + spacing * text.length + 24);
    c.width = width;
    c.height = 96;
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(10, 30, 50, 0.5)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, 50);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width / c.height, 1).rotateX(-Math.PI / 2), material);
    const { x, y } = tileOf(def, n.lon, n.lat);
    mesh.position.set(x, LIFT, y);
    mesh.renderOrder = 2;
    object.add(mesh);
    return { mesh, material, kind: KINDS[n.kind] };
  });
  return {
    object,
    /** Each frame on the map: sized and faded for the camera's distance; hidden from astern. */
    update(distance: number, overhead: boolean) {
      object.visible = overhead;
      if (!overhead) return;
      for (const l of labels) {
        const k = l.kind;
        const shown = THREE.MathUtils.smoothstep(distance, k.in[0], k.in[1]) * (1 - THREE.MathUtils.smoothstep(distance, k.out[0], k.out[1]));
        l.material.opacity = shown * k.alpha;
        l.mesh.visible = shown > 0;
        l.mesh.scale.setScalar(distance * k.height);
      }
    },
  };
}
