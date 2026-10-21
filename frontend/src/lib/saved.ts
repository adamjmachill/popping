// Saved (PR4c, D5): every save, whatever the tabs loaded. No imports (see
// feedRules.ts), so the unit tests run it under strip-types.
//
// ``starred_entries`` holds the saves in the order they were made: a save
// appends its id (``applyIdDelta``, and the server's PATCH the same way),
// so a save made again after an unsave goes to the end. Saved lists them
// newest save first. A save the tabs don't hold (an old story, or one
// saved on another device) is fetched by id (``api.entriesByIds``) into
// App's by-id cache; ids the server no longer returns (a deleted feed's
// stories go with it) are noted, so they aren't asked for again.

/** What Saved needs of a story. */
export type Story = { id: number }

/** The saves to draw, newest save first. ``find`` gives the copy to draw
 *  (App: the tabs' copy, else the by-id cache, else the copy drawn last
 *  time); a save with no copy yet is left out until its fetch lands, and
 *  so is one ``isRemoved`` takes out (hidden: hide wins over saved; a
 *  deleted feed). An id saved twice is drawn once. */
export function savedStories<E extends Story>(
  starred: readonly number[],
  find: (id: number) => E | undefined,
  isRemoved: (e: E) => boolean,
): E[] {
  const out: E[] = []
  const drawn = new Set<number>()
  for (let i = starred.length - 1; i >= 0; i--) {
    const id = starred[i]
    if (drawn.has(id)) continue
    drawn.add(id)
    const e = find(id)
    if (e && !isRemoved(e)) out.push(e)
  }
  return out
}

/** The saves to fetch by id, newest save first (so the first chunk of 200
 *  is the top of Saved): the ones ``skip`` doesn't rule out. App skips a
 *  save the tabs or the by-id cache hold, one the server no longer
 *  returned, one already being fetched, and a hidden one (hide wins, so
 *  it isn't drawn). */
export function savedToFetch(starred: readonly number[], skip: (id: number) => boolean): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let i = starred.length - 1; i >= 0; i--) {
    const id = starred[i]
    if (seen.has(id)) continue
    seen.add(id)
    if (!skip(id)) out.push(id)
  }
  return out
}

/** ``list`` with ``item`` back at index ``at`` (clamped to the list),
 *  for a hide's Undo; ``list`` itself when it already holds the id (a
 *  poll brought the story back first). */
export function reinsert<E extends Story>(list: E[], item: E, at: number): E[] {
  if (list.some((e) => e.id === item.id)) return list
  const i = Math.max(0, Math.min(at, list.length))
  return [...list.slice(0, i), item, ...list.slice(i)]
}
