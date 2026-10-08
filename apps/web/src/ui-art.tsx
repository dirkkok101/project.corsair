import type { ContentPack } from '@corsair/data';
// The painted UI kit (art/sources/paintings/README.md, imported by tools/art/import_ui.ts): the ship panel's
// portraits, frame and icons, and the crew and goods icons the HUD and the port, battle and plunder screens use.

export const ART = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../art/game/ui/*.png', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/, ''),
    url,
  ]),
);

/** "war sloop": a ship class as the player reads it. */
export const shipKind = (classId: string) => classId.replace(/^ship\./, '').replace(/_/g, ' ');

/** A ship class's portrait: her own, or the class she borrows until she is painted (ships.json sprites.icon). */
export const shipIcon = (content: ContentPack, classId: string) => content.ships[classId]?.sprites.icon ?? `ui.ship.${classId.replace(/^ship\./, '')}`;

/** A UI kit image, drawn pixel for pixel. */
export function Art({ id, class: cls, title }: { id: string; class?: string; title?: string }) {
  return <img class={`ui-art${cls ? ` ${cls}` : ''}`} src={ART[id]} alt="" title={title} draggable={false} />;
}

/** A good's icon (its id in goods.json), sized to sit in a line of text. */
export function GoodIcon({ id }: { id: string }) {
  // A good not yet painted shows no icon rather than a broken image.
  return ART[`ui.icon.good.${id}`] ? <Art id={`ui.icon.good.${id}`} class="inline-icon" /> : null;
}
