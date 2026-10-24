import type { Command, Hoard, WorldState } from "@corsair/core";
import { difficultyOf, isLand, shipStats, tileAt } from "@corsair/data";
import type { ContentPack, DifficultyLevel, PlacedSettlement, TileMap } from "@corsair/data";
import { CareerCard } from "./career";
import { cargoUsed, fleetBerths, fleetHold, fleetOf, fleetShipPace, hoardRing, shipValue } from "@corsair/systems-economy";
import type { Goal } from "@corsair/systems-traffic";
import { useEffect, useRef, useState } from "preact/hooks";
import { papersLine, TopTen } from "./port";
import { Art, shipIcon, shipKind } from "./ui-art";
import { deedFigure } from "./ui/deed";

/** The parchment's size on screen, in pixels. */
const PARCHMENT_PX = 216;

/** Pieces held before the X itself is drawn on the map. */
const X_AT_PIECES = 3;

/**
 * The order a map's quarters come in, by its pieces: the quarter the hoard lies in first, so one piece already shows
 * the coast to read (the X itself only from the third piece), then its neighbours, the far side last (quarters: 0
 * top left, 1 top right, 2 bottom left, 3 bottom right of the widest search ring).
 */
export function quartersHeld(hoard: Hoard, pieces: number): number[] {
  const xq = (hoard.dx <= 0 ? 1 : 0) + (hoard.dy <= 0 ? 2 : 0);
  return [xq, xq ^ 1, xq ^ 2, 3 - xq].slice(0, pieces);
}

/**
 * A hoard's map drawn as a parchment from the real coast about the widest search ring: land, water and the shore
 * between; the quarters not yet held torn away; the X from the third piece.
 */
export function Parchment({
  content,
  map,
  hoard,
  pieces,
}: {
  content: ContentPack;
  map: TileMap;
  hoard: Hoard;
  pieces: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const cx = hoard.x + hoard.dx;
    const cy = hoard.y + hoard.dy;
    const r = (content.treasure.ringTiles[0]! / 2) * 1.3;
    const perTile = PARCHMENT_PX / (2 * r);
    const held = new Set(quartersHeld(hoard, pieces));
    const half = PARCHMENT_PX / 2;
    const land = (x: number, y: number) => isLand(tileAt(map, x, y));
    ctx.clearRect(0, 0, PARCHMENT_PX, PARCHMENT_PX);
    for (let py = 0; py < PARCHMENT_PX; py += 2) {
      for (let px = 0; px < PARCHMENT_PX; px += 2) {
        const q = (px >= half ? 1 : 0) + (py >= half ? 2 : 0);
        if (!held.has(q)) continue;
        const tx = cx - r + px / perTile;
        const ty = cy - r + py / perTile;
        const here = land(tx, ty);
        const shore =
          here &&
          (!land(tx + 0.6, ty) ||
            !land(tx - 0.6, ty) ||
            !land(tx, ty + 0.6) ||
            !land(tx, ty - 0.6));
        ctx.fillStyle = shore ? "#5e4024" : here ? "#a8834e" : "#e2cfa3";
        ctx.fillRect(px, py, 2, 2);
      }
    }
    if (pieces >= X_AT_PIECES) {
      const x = (hoard.x - cx + r) * perTile;
      const y = (hoard.y - cy + r) * perTile;
      ctx.strokeStyle = "#a53030";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      ctx.stroke();
    }
  }, [hoard, pieces]);
  return (
    <canvas
      ref={ref}
      class="parchment"
      width={PARCHMENT_PX}
      height={PARCHMENT_PX}
    />
  );
}

/** The water nearest a spot, ring by ring outward: a course goes to the search ring, never straight to the X. */
export function waterNear(map: TileMap, x: number, y: number): [number, number] {
  for (let d = 0; d < 40; d++) {
    for (let k = 0; k < Math.max(1, d * 8); k++) {
      const a = (k / Math.max(1, d * 8)) * Math.PI * 2;
      const wx = x + Math.sin(a) * d;
      const wy = y - Math.cos(a) * d;
      if (!isLand(tileAt(map, wx, wy))) return [wx, wy];
    }
  }
  return [x, y];
}

/** One hoard's map: the parchment as far as the pieces held show it, what it says, and where to dig. */
export function HoardMap({
  content,
  map,
  settlements,
  name,
  hoard,
  held,
  plot,
}: {
  content: ContentPack;
  map: TileMap;
  settlements: PlacedSettlement[];
  name: string;
  hoard: Hoard;
  held: number;
  plot?: (x: number, y: number) => void;
}) {
  const ring = hoardRing(content, hoard, held);
  const whole = content.pirates.rules.mapPieces;
  const near = settlements.find((s) => s.id === hoard.near)?.name ?? hoard.near;
  return (
    <div class="log-map">
                  <Parchment
                    content={content}
                    map={map}
                    hoard={hoard}
                    pieces={held}
                  />
                  <div>
                    <div class="log-map-title">{name}'s hoard</div>
                    <div class="port-sub">
                      {held} of {whole} pieces ·{" "}
                      {hoard.found
                        ? `${hoard.value.toLocaleString()} gold dug up`
                        : `about ${hoard.value.toLocaleString()} gold buried`}{" "}
                      · on the coast near {near}
                    </div>
                    {hoard.found ? (
                      <p class="plunder-note">Dug up: the gold is yours.</p>
                    ) : (
                      <>
                        <p class="plunder-note">
                          {held >= 2 ? `The map marks ${hoard.landmark}. ` : ""}
                          The chart rings the search: about{" "}
                          {Math.round(ring.r * 2)} tiles across
                          {held < whole
                            ? ", narrowing with each piece you find"
                            : ""}
                          .
                          {held < X_AT_PIECES
                            ? " The hoard lies on the coast this piece shows; a third piece marks the X."
                            : ""}
                        </p>
                        <p class="plunder-note">
                          Close the shore inside the ring and press Space to go
                          ashore and dig: half a day each time.
                        </p>
                        {plot ? (
                          <button
                            onClick={() =>
                              plot(...waterNear(map, ring.x, ring.y))
                            }
                          >
                            Plot a course to the search ring
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
  );
}

export interface LogProps {
  content: ContentPack;
  state: WorldState;
  map: TileMap;
  settlements: PlacedSettlement[];
  /** The player's flagship. */
  shipId: string;
  /** Orders from the book's Fleet page (in port). */
  send: (command: Command) => void;
  /** Plot a course to a spot at sea (tile coordinates). */
  plot: (x: number, y: number) => void;
  close: () => void;
  /** Close the log and open the chart, its voyages beside it. */
  openChart: () => void;
  /** The governors' missions in hand (missionGoals), then the career's goals (careerGoals), in order. */
  goals: Goal[];
  /** A tick as a date ("14 May 1661"). */
  date: (tick: number) => string;
}

type Page = 'log' | 'goals' | 'deeds' | 'fleet' | 'career' | 'top' | 'maps';
/** The book's bookmarks, top to bottom. */
const BOOKMARKS: [Page, string][] = [
  ['log', 'Log'],
  ['goals', 'Goals'],
  ['deeds', 'Deeds'],
  ['fleet', 'Fleet'],
  ['career', 'Career'],
  ['top', 'Top Ten'],
  ['maps', 'Maps'],
];
/** Lines on each page of the Log's spread. */
const LINES_PER_PAGE = 8;

/** The Log page (storyboard 6.1): the captain's deeds and the news he heard, newest first, over a spread of two pages. */
function LogPage({ state, settlements, date, plot }: Pick<LogProps, 'state' | 'settlements' | 'date' | 'plot'>) {
  const lines = [...(state.captain?.logbook ?? [])].reverse();
  const [spread, setSpread] = useState(0);
  const per = LINES_PER_PAGE * 2;
  const shown = lines.slice(spread * per, spread * per + per);
  const page = (entries: typeof lines) =>
    entries.map((e, i) => {
      const where = settlements.find((s) => s.id === e.place);
      return (
        <div key={`${e.tick}-${i}`} class="logbook-line">
          <div class="logbook-date">{date(e.tick)}</div>
          <div class="logbook-text">
            <span class={`k-tag ${e.kind}`}>{e.kind === 'loss' ? 'deed' : e.kind}</span> {e.text}
            {where ? (
              <button class="logbook-place" title={`Plot a course to ${where.name}`} onClick={() => plot(where.x, where.y)}>
                {where.name}
              </button>
            ) : null}
          </div>
        </div>
      );
    });
  return (
    <>
      <div class="book-page">
        <h2 class="book-title">Captain's log</h2>
        <div class="book-sub">Your deeds and the news you heard, newest first. A place plots a course there.</div>
        <div class="book-rule" />
        {lines.length ? page(shown.slice(0, LINES_PER_PAGE)) : <p class="book-sub">Nothing written yet: the log fills as you trade, fight and hear the news.</p>}
      </div>
      <div class="book-page">
        {page(shown.slice(LINES_PER_PAGE))}
        {lines.length > per ? (
          <div class="book-turn">
            <button class="k-btn small paper" disabled={spread === 0} onClick={() => setSpread(spread - 1)}>
              Newer
            </button>
            <span class="book-sub">
              {spread + 1} of {Math.ceil(lines.length / per)}
            </span>
            <button class="k-btn small paper" disabled={(spread + 1) * per >= lines.length} onClick={() => setSpread(spread + 1)}>
              Older
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** The Deeds page: every deed card she has had, newest first, each with its figure, over a spread of two pages. */
function DeedsPage({ state, date }: Pick<LogProps, 'state' | 'date'>) {
  const deeds = [...(state.captain?.honours ?? [])].reverse();
  const [spread, setSpread] = useState(0);
  const per = LINES_PER_PAGE * 2;
  const shown = deeds.slice(spread * per, spread * per + per);
  const page = (entries: typeof deeds) =>
    entries.map((h) => (
      <div key={h.id} class="logbook-line deeds-line">
        <span class="deeds-seal" />
        <div class="logbook-text">
          {h.kind === 'goal' ? `Goal done: ${h.title[0]!.toLowerCase()}${h.title.slice(1)}` : h.title}
          <span class="logbook-date"> · {date(h.tick)}</span>
        </div>
        <span class="deeds-figure">{deedFigure(h)}</span>
      </div>
    ));
  return (
    <>
      <div class="book-page">
        <h2 class="book-title">Deeds</h2>
        <div class="book-sub">Everything you have done that was worth saying, newest first.</div>
        <div class="book-rule" />
        {deeds.length ? page(shown.slice(0, LINES_PER_PAGE)) : <p class="book-sub">No deeds yet: sell a cargo, take a prize, or carry a governor's letter.</p>}
      </div>
      <div class="book-page">
        {page(shown.slice(LINES_PER_PAGE))}
        {deeds.length > per ? (
          <div class="book-turn">
            <button class="k-btn small paper" disabled={spread === 0} onClick={() => setSpread(spread - 1)}>
              Newer
            </button>
            <span class="book-sub">
              {spread + 1} of {Math.ceil(deeds.length / per)}
            </span>
            <button class="k-btn small paper" disabled={(spread + 1) * per >= deeds.length} onClick={() => setSpread(spread + 1)}>
              Older
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** The next three goals not yet done, each with its progress and one click to where it gets done; opposite, the missions in hand and the done. */
function Goals({
  goals,
  settlements,
  plot,
  open,
  level,
}: {
  goals: Goal[];
  settlements: PlacedSettlement[];
  plot: LogProps['plot'];
  open: (page: 'top' | 'maps' | 'chart') => void;
  level: DifficultyLevel;
}) {
  const missions = goals.filter((g) => g.mission);
  const next = goals.filter((g) => !g.done && !g.mission).slice(0, 3);
  const done = goals.filter((g) => g.done);
  const port = (id?: string) => settlements.find((s) => s.id === id);
  return (
    <>
      <div class="book-page goals">
        <h2 class="book-title">What next</h2>
        <div class="book-sub">The career's next three steps; each one says where it gets done.</div>
        <div class="book-rule" />
        {next.length ? (
          next.map((g) => {
            const where = port(g.port);
            return (
              <div key={g.id} class="goal">
                <div class="goal-head">
                  <b>{g.title}</b>
                  {g.unit ? (
                    <span class="goal-have">
                      {g.have.toLocaleString()} / {g.of.toLocaleString()} {g.unit}
                    </span>
                  ) : null}
                </div>
                <div class="goal-bar">
                  <span style={{ width: `${Math.round(Math.min(1, g.have / Math.max(1, g.of)) * 100)}%` }} />
                </div>
                <div class="goal-foot">
                  <span class="book-sub">{g.why}</span>
                  {where ? (
                    <button class="k-btn small paper" onClick={() => plot(where.x, where.y)}>
                      Plot a course to {where.name}
                    </button>
                  ) : g.page ? (
                    <button class="k-btn small paper" onClick={() => open(g.page!)}>
                      {g.page === 'top' ? 'See the Top Ten' : g.page === 'chart' ? "Open the chart's voyages" : 'See your maps'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p class="book-sub">Every goal is done: a career to be proud of.</p>
        )}
      </div>
      <div class="book-page">
        {missions.length ? (
          <>
            <h2 class="book-title">Missions</h2>
            <div class="book-sub">Work the governors gave you, nearest first.</div>
            <div class="book-rule" />
            {missions.map((g) => {
              const where = port(g.port);
              return (
                <div key={g.id} class="goal">
                  <div class="goal-head">
                    <b>{g.title}</b>
                  </div>
                  <div class="goal-foot">
                    <span class="book-sub">{g.why}</span>
                    {where ? (
                      <button class="k-btn small paper" onClick={() => plot(where.x, where.y)}>
                        Plot a course to {where.name}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div class="book-rule" />
          </>
        ) : null}
        <h3 class="book-heading">Done</h3>
        <div class="goals-done">
          {done.length ? (
            done.map((g) => (
              <div key={g.id} class="goal-done">
                <span aria-hidden="true">✓</span> {g.title}
              </div>
            ))
          ) : (
            <span class="book-sub">Nothing yet.</span>
          )}
        </div>
        <div class="book-rule" />
        <h3 class="book-heading">Difficulty: {level.name}</h3>
        <p class="book-sub">
          {level.about} Retirement score × {level.score}.
        </p>
      </div>
    </>
  );
}

/**
 * The Fleet page (storyboard 3.4): every ship, the flagship first, and her state; what the fleet carries and the pace
 * it keeps; what each would sell for. The orders are the shipwright's, in port.
 */
function Fleet({ content, state, settlements, shipId }: Pick<LogProps, 'content' | 'state' | 'settlements' | 'shipId'>) {
  const ship = state.ships[shipId]!;
  const fleet = fleetOf(state);
  const hold = fleetHold(content, state, ship);
  const berths = fleetBerths(content, state, ship);
  const cargo = cargoUsed(ship);
  const port = settlements.find((s) => s.id === ship.docked);
  const laidUp = state.captain?.laidUp ?? [];
  // The flagship's own pace, not the fleet's she is held to.
  const slowest = [{ ...ship, fleetSpeed: undefined }, ...fleet].reduce((a, b) => (fleetShipPace(content, b) < fleetShipPace(content, a) ? b : a));
  const fits = (u?: string[]) => (u ?? []).map((id) => content.upgrades[id]?.name.toLowerCase()).filter(Boolean);
  const condition = (f: { classId: string; hull?: number; upgrades?: string[]; guns?: number }) => {
    const stats = shipStats(content, f);
    return [`hull ${Math.round(f.hull ?? stats.hullMax)} of ${stats.hullMax}`, `${stats.guns} guns`, ...fits(f.upgrades)].join(' · ');
  };
  return (
    <>
      <div class="book-page">
        <h2 class="book-title">Your fleet</h2>
        <div class="book-sub">Only the flagship fights; the others carry cargo and men, and sail at the pace of the slowest.</div>
        <div class="book-rule" />
        <div class="fleet-list">
          <div class="fleet-row flagship">
            <Art id={shipIcon(content, ship.classId)} class="fleet-ship" />
            <div class="fleet-what">
              <b>{ship.name ?? 'Your flagship'}</b> <span class="book-sub">{shipKind(ship.classId)} · flagship</span>
              <div class="book-small">{condition(ship)}</div>
            </div>
          </div>
          {fleet.map((f) => (
            <div key={f.id} class="fleet-row">
              <Art id={shipIcon(content, f.classId)} class="fleet-ship" />
              <div class="fleet-what">
                <b>{f.name}</b> <span class="book-sub">{shipKind(f.classId)}</span>
                <div class="book-small">{condition(f)}</div>
                {papersLine(f) ? <div class="book-small">{papersLine(f)}</div> : null}
              </div>
              <span class="book-small">worth about {shipValue(content, f).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div class="fleet-totals">
          <span>
            <b>Hold</b> {hold} ({cargo} used)
          </span>
          <span>
            <b>Berths</b> {berths}
          </span>
          <span>
            <b>Pace</b> {fleetShipPace(content, slowest)}
            {fleet.length ? `, the ${shipKind(slowest.classId)}'s` : ''}
          </span>
        </div>
        {!fleet.length ? <p class="book-sub">Your fleet is your flagship alone. Take a prize and keep her, or buy a ship, to grow it.</p> : null}
        {fleet.length ? <p class="book-sub">In port, the shipwright mends, fits, swaps and sells them.</p> : null}
      </div>
      <div class="book-page">
        {laidUp.length ? (
          <>
            <h3 class="book-heading">Laid up</h3>
            {laidUp.map((l) => (
              <p key={l.id} class="book-small">
                Your {shipKind(l.classId)} {l.name}, at {settlements.find((s) => s.id === l.settlementId)?.name ?? l.settlementId}
                {port?.id === l.settlementId ? ': the shipwright here gives her back' : ''}.
              </p>
            ))}
            <div class="book-rule" />
          </>
        ) : null}
        <h3 class="book-heading">Selling</h3>
        <p class="book-small">
          A shipwright pays {Math.round(content.combat.fleet.sellShare * 100)}% of her class's price, less for a holed hull and torn sails, and half what her fits cost. A prize taken under a
          letter of marque is condemned at that nation's ports and fetches as much there; without papers she fetches{' '}
          {Math.round(content.combat.fleet.prizeShare * 100)}%, or {Math.round(content.combat.fleet.havenShare * 100)}% at a pirate haven, where every nation
          hears of it.
        </p>
      </div>
    </>
  );
}

/** The captain's log (L, storyboard 6.1-6.3): a book with bookmarks, open at sea or in port. */
/** The First Voyage given up: the quartermaster sent ashore, asked once more before it is done. */
function SendAshore({ send }: { send: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div class="log-ashore asking">
      <span>End the First Voyage? Every port opens, and no one at your elbow.</span>
      <button class="k-btn small paper" onClick={send}>
        Send him ashore
      </button>
      <button class="k-btn small paper" onClick={() => setAsking(false)}>
        Keep him
      </button>
    </div>
  ) : (
    <button class="k-btn small paper log-ashore" onClick={() => setAsking(true)}>
      Send the quartermaster ashore
    </button>
  );
}

export function Log({ content, state, map, settlements, shipId, send, plot, close, openChart, goals, date }: LogProps) {
  const pieces = state.captain?.mapPieces ?? {};
  const maps = content.pirates.captains.flatMap((c) => {
    const hoard = state.famous?.[c.id]?.hoard;
    return pieces[c.id] && hoard ? [{ c, hoard, held: pieces[c.id]! }] : [];
  });
  const [page, setPage] = useState<Page>('log');
  return (
    <div class="log">
      <div class="k-paper log-book">
        {state.captain?.voyage && state.captain.voyage.step !== 'done' ? <SendAshore send={() => send({ type: 'SkipVoyage', shipId })} /> : null}
        <button class="k-btn small paper log-close" onClick={close}>
          Close · L
        </button>
        <div class="book-spread">
          {page === 'log' ? (
            <LogPage state={state} settlements={settlements} date={date} plot={plot} />
          ) : page === 'goals' ? (
            <Goals goals={goals} settlements={settlements} plot={plot} open={(p) => (p === 'chart' ? openChart() : setPage(p))} level={difficultyOf(content, state.difficulty)} />
          ) : page === 'deeds' ? (
            <DeedsPage state={state} date={date} />
          ) : page === 'fleet' ? (
            <Fleet content={content} state={state} settlements={settlements} shipId={shipId} />
          ) : page === 'career' ? (
            <div class="book-page wide">
              <h2 class="book-title">Your career</h2>
              <div class="book-rule" />
              <CareerCard content={content} state={state} />
            </div>
          ) : page === 'top' ? (
            <div class="book-page wide">
              <div class="top-head">
                <h2 class="book-title">The Top Ten</h2>
                <span class="book-sub">by their wealth · yours counts your purse and the plunder chest</span>
              </div>
              <div class="book-rule" />
              <TopTen content={content} state={state} settlements={settlements} />
            </div>
          ) : (
            <div class="book-page wide">
              <h2 class="book-title">Treasure maps</h2>
              <div class="book-rule" />
              {maps.length ? (
                <div class="log-maps">
                  {maps.map(({ c, hoard, held }) => (
                    <HoardMap key={c.id} content={content} map={map} settlements={settlements} name={c.name} hoard={hoard} held={held} plot={plot} />
                  ))}
                </div>
              ) : (
                <p class="book-sub">
                  You hold no treasure maps. Take a famous pirate and ask about his hoard, pick up his men when he sinks, or look for the shady stranger in the taverns.
                </p>
              )}
            </div>
          )}
        </div>
        <nav class="log-tabs">
          {BOOKMARKS.map(([id, name]) => (
            <button key={id} class={`log-mark${page === id ? ' active' : ''}`} onClick={() => setPage(id)}>
              {name}
              {id === 'maps' && maps.length ? ` (${maps.length})` : ''}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
