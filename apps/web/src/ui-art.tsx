// The painted UI kit (art/sources/paintings/README.md, imported by tools/art/import_ui.ts): the ship panel's
// portraits, frame and icons, and the crew and goods icons the HUD and the port, battle and plunder screens use.

export const ART = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../art/game/ui/*.png', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/, ''),
    url,
  ]),
);

/** A UI kit image, drawn pixel for pixel. */
export function Art({ id, class: cls, title }: { id: string; class?: string; title?: string }) {
  return <img class={`ui-art${cls ? ` ${cls}` : ''}`} src={ART[id]} alt="" title={title} draggable={false} />;
}

/** A good's icon (its id in goods.json), sized to sit in a line of text. */
export function GoodIcon({ id }: { id: string }) {
  return <Art id={`ui.icon.good.${id}`} class="inline-icon" />;
}
