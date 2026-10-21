import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Entry } from '../api'
import { Card } from './Card'
import { FORYOU_KEY, SAVED_KEY, type ColKey } from '../lib/columns'
import { FirstFeedButton } from './FirstFeedButton'
import { normalizeSort, type Sort, type TabPrefs } from '../lib/sorting'

// Per-column sort/filter preferences. Owned by App (so it persists
// across columns and across renders) and passed in here for the
// popover to read/write. ``maxAgeHours === null`` means "no max-age
// filter" — the popover's "all" option. The shape is ``lib/sorting``'s
// ``TabPrefs`` (``sort`` may still hold an older build's ``top`` or
// ``oldest``; ``normalizeSort`` reads it). ``minScore`` stays in the
// stored shape but nothing filters on it any more.
//
// App reads a tab's prefs through ``prefsFor`` (lib/sorting), which
// returns module constants for a tab with no stored row, because the
// memo below compares prefs by reference.
export type ColumnPrefs = TabPrefs

const SORTS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'best', label: 'Best' },
]

type Props = {
  // The tab's key (lib/columns): which sort it defaults to, whether it
  // has a sort at all (Saved doesn't), and whether its empty state may
  // offer "Add your first feed" (Saved and For You).
  columnKey: ColKey
  // The name the header shows (App's column label: the category's
  // label, or Saved / For You).
  label: string
  // The feed the empty state reports on (``sourcesByName``'s key): the
  // one feed a filter shows, or for a category the feed named like it.
  // Saved, For You and a filter of several feeds leave it unset.
  sourceName?: string
  // Pre-split entry lists. App owns the "what's new" semantics
  // (derived from per-column lastViewed timestamps + the manual
  // readEntries set), and ships the two slices down in the tab's
  // order (Newest or Best). The Column only renders — the split and the
  // sort are data-layer concerns, not visual ones.
  //
  // When a slice is empty, its section (header + divider) is
  // omitted entirely. So a column with no new entries just shows
  // its History section under the column header with no divider.
  sections: {
    new: Entry[]
    history: Entry[]
  }
  sourcesById: Map<number, string>
  // Source objects keyed by name, so the empty-state JSX can show
  // the source's last_fetch_at / error_count / last_error and
  // tell the user why the column is empty ("last fetch errored",
  // "auto-disabled after 5 errors", etc.) instead of just
  // "no entries yet". Optional — a column with no ``sourceName``
  // (Saved, For You, a filter of several feeds), or one whose name
  // matches no feed, falls back to "No stories yet". Added in slice 19.
  sourcesByName?: Map<string, import('../api').Source>
  // Every feed is a built-in one: an empty Saved or For You adds the
  // "Add your first feed" button, which calls ``onAddFeed`` (stable;
  // the memo comparator ignores it).
  noOwnFeeds?: boolean
  onAddFeed?: () => void
  // Number of entries in this column that are "new since the user's
  // last visit to this column". Rendered as a chip in the header so
  // the user knows to come look. ``undefined`` means we haven't
  // computed it yet (initial mount) and we show nothing. The
  // chip count and the New section count may differ (e.g. when the
  // age filter hides some new entries) — that's intentional:
  // the chip is the feed-level signal, the section is the
  // post-filter view.
  newCount?: number
  // The id of the currently keyboard-selected entry in this column.
  // Only the matching Card renders the blue focus ring. ``-1``
  // (or undefined) means no selection in this column.
  selectedId?: number
  // Ref callback so App can focus + scroll-into-view on keyboard nav.
  cardRefs?: Map<number, HTMLElement | null> | React.MutableRefObject<Map<number, HTMLElement | null>>
  // Triggered when the user taps the column header. App uses this
  // to mark the column read in localStorage.
  onMarkRead?: () => void
  // Triggered when the user taps the +N new chip. App uses this
  // to re-fetch the column's entries (same as the global refresh
  // button). When absent, the chip stays a non-interactive badge
  // (preserves the prior visual for callers that don't pass the
  // prop). The chip stops click propagation so the header's
  // mark-read handler doesn't also fire.
  onRefresh?: () => void
  // A card's source name was tapped: open that feed's editor. Must be
  // stable (the memo comparator ignores callbacks).
  onSourceTap?: (sourceId: number) => void
  // Per-card mark-read. App flips the entry's read state via this —
  // see ``markEntryRead`` in App.tsx. The Column just forwards the
  // clicked entry id up so the keyboard ``m`` shortcut and the
  // button on each card share one code path.
  onMarkEntryRead?: (entryId: number) => void
  // Prefs + setter for the ⋯ popover (Newest | Best, and the age
  // filter). Without a setter there is no ⋯.
  prefs?: ColumnPrefs
  onPrefsChange?: (next: ColumnPrefs) => void
  // The total number of entries before prefs filtering. We render
  // "X of Y" so the user can see when their filters are hiding
  // content. App passes this; falls back to entries.length when
  // prefs are not in play.
  totalCount?: number
  // Optional map sourceId → category. Passed through to each Card so
  // it can render the colored left stripe. Without it the cards just
  // skip the stripe.
  categoriesBySourceId?: Map<number, string>
  // Optional map sourceId → favicon path. Passed through to each Card
  // as a thumbnail fallback for entries with no photo of their own —
  // see Card.tsx's ThumbnailFallback. Without it, image-less entries
  // just render with no thumbnail (today's behavior).
  faviconBySourceId?: Map<number, string | null>
  // Per-card summary expansion set + toggle callback. App owns both
  // so the keyboard ``s`` shortcut and the per-card chevron stay in
  // sync. Both optional — older callers (none today) just omit
  // them and the cards render with summaries permanently collapsed.
  expandedSummaries?: Set<number>
  onToggleSummary?: (entryId: number) => void
  // Per-card "hide this entry" action. When present, each card's
  // context menu gets a "Hide this entry" item. App wires this
  // to the localStorage-backed hidden set; the entry disappears
  // from every column + the For You row immediately.
  onHideEntry?: (entryId: number) => void
  // Per-card "star" / "unstar" action. When present, each card
  // gets a star button next to the mark-read checkmark, and
  // the context menu gets a "Save for later" / "Unsave" item.
  // App wires this to the localStorage-backed starred set; the
  // entry surfaces in the dedicated "Saved" column at the top
  // of the dashboard.
  onStarEntry?: (entryId: number) => void
  // Per-card "is this entry currently starred" lookup. App
  // passes a Set so each card render is an O(1) check rather
  // than a linear search.
  starredSet?: Set<number>
  // Per-card "hide" / "unhide" action for the eye button.
  // When present, each card gets an eye button next to the
  // mark-read checkmark and the star. App wires this to a
  // callback that ALSO marks the entry read so the entry
  // moves to the column's History section. Different from
  // ``onHideEntry`` (above) which is the context-menu's
  // "permanently dismiss" affordance.
  onHideToggle?: (entryId: number) => void
  // Per-card "is this entry currently hidden" lookup. App
  // passes the same Set the eye button uses for its
  // open/closed state.
  hiddenSet?: Set<number>
  // Per-card vote action + lookup — same shape as star/hide but a
  // three-state Map (no entry / 'up' / 'down') instead of a Set,
  // since a vote isn't a boolean membership test.
  onVoteEntry?: (entryId: number, direction: 'up' | 'down' | null) => void
  votedMap?: Map<number, 'up' | 'down'>
  // Per-section collapse state (Miniflux-style). When a section
  // is collapsed, only its header renders — the cards are
  // unmounted. Persisted in localStorage by App, keyed by column
  // name, so the user's preference survives reloads.
  sectionsCollapsed?: { new: boolean; history: boolean }
  // Toggle callback for a section header click. App flips the
  // appropriate bit in the per-column storage record.
  onToggleSection?: (key: 'new' | 'history') => void
  // The phone only: a callback ref for the story list, which is the
  // phone's real scroller (this section is h-full inside App's
  // wrapper). The list it lands on is marked ``data-scroller``. Pass a
  // stable function (App passes its state setter); the memo comparator
  // ignores it like the other callbacks.
  scrollerRef?: (el: HTMLElement | null) => void
}

// Slice 21: renamed ``Column`` to ``ColumnInner`` and added a
// ``React.memo`` wrap with a custom comparator (``_columnPropsEqual``,
// below) so App's per-render closures don't defeat memoization. The
// comparator ignores the per-card callback props (``onMarkEntryRead``,
// ``onHideEntry``, ``onStarEntry``, ``onHideToggle``, ``onVoteEntry``,
// ``onToggleSummary``, ``onToggleSection``, ``onPrefsChange``,
// ``onMarkRead``, ``onRefresh``), the per-card ``cardRefs`` and the
// phone's ``scrollerRef`` (a stable setter) —
// they're inherently per-render at the App layer; the data-driven
// props (``sections``, ``sourcesById``, ``sourcesByName``,
// ``starredSet``, ``hiddenSet``, ``votedMap``, ``prefs``,
// ``sectionsCollapsed``) are what we actually re-render against.
//
// Trade-off: if a callback's logic changes without the data
// changing, this Column won't re-render. That can't happen in
// practice because callbacks here only depend on data props
// (``onMarkEntryRead(e.id)`` reads from the same entry id, which is
// stable across renders for the same card) and App-level state. If
// a future caller starts passing callbacks that close over mutable
// refs, lift this to a stable ref and re-evaluate.
//
// Pair with the ``useCallback`` wraps in ``App.tsx`` (slice 21, same
// commit) so the App-level handlers keep stable identity between
// renders — otherwise the JSX-passed inline arrows would still defeat
// the memo even with this comparator.
export function ColumnInner({
  columnKey,
  label,
  sourceName,
  sections,
  sourcesById,
  // Slice 19: optional sourcesByName map for context-aware empty-state.
  // Meta columns (Saved / For You / Multisub) pass undefined; the
  // empty-state falls back to the original generic message in that case.
  sourcesByName,
  noOwnFeeds,
  onAddFeed,
  newCount,
  selectedId,
  cardRefs,
  onMarkRead,
  onRefresh,
  onSourceTap,
  onMarkEntryRead,
  prefs,
  onPrefsChange,
  totalCount,
  categoriesBySourceId,
  faviconBySourceId,
  expandedSummaries,
  onToggleSummary,
  onHideEntry,
  onStarEntry,
  starredSet,
  onHideToggle,
  hiddenSet,
  onVoteEntry,
  votedMap,
  sectionsCollapsed,
  onToggleSection,
  scrollerRef,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const sortLabelId = useId()
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const prefsButtonRef = useRef<HTMLButtonElement | null>(null)

  // Keep the latest ``cardRefs`` value in a ref so we can ship a
  // stable ref callback to each ``Card``. Without this, the inline
  // lambda in the ``entries.map`` below would defeat the
  // ``Card.memo`` — every Column re-render allocates new closures
  // and React would re-mount every card's DOM ref. The cardRefs
  // shape (Map vs ref-of-Map) can change between renders too, so we
  // also stash the active setter in the ref to keep the dispatcher
  // single-sourced.
  const cardRefsLatest = useRef(cardRefs)
  cardRefsLatest.current = cardRefs

  // Stable ref callback. Same function reference across renders;
  // reads the latest ``cardRefs`` and ``entry.id`` from refs so
  // each card lands in the right slot regardless of when it
  // mounted.
  // A detaching card removes its entry only while the entry is still
  // that card: the same story can be registered by the phone layout
  // and the desktop grid, and the grid unmounting (the window crossing
  // 768px) must not drop the phone card's entry.
  const setCardRef = useCallback((entryId: number) => (el: HTMLElement | null, prev?: HTMLElement | null) => {
    const refs = cardRefsLatest.current
    if (!refs) return
    const map = 'current' in refs ? refs.current : refs
    if (el) map.set(entryId, el)
    else if (!prev || map.get(entryId) === prev) map.delete(entryId)
  }, [])

  // Click-outside dismissal. The popover is small and short-lived;
  // a backdrop div would be overkill. ``pointerdown``, not
  // ``mousedown``: iOS sends no mousedown for a tap on empty space,
  // so the popover would stay open. The ⋯ button is left to its own
  // onClick toggle; closing here too would reopen it on the click.
  useEffect(() => {
    if (!popoverOpen) return
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (prefsButtonRef.current?.contains(target)) return
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [popoverOpen])

  // Esc closes the popover. Same effect slot as click-outside.
  useEffect(() => {
    if (!popoverOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [popoverOpen])

  // Header tap on desktop marks the column read. On mobile the same
  // element exists (the column header is visible on touch layouts
  // too — the swipe changes the visible column but the header is
  // always rendered). The handler stays the same on both.
  //
  // The sort/filter popover and its trigger button are DOM children
  // of this header (they need to be, for the ``absolute`` positioning
  // below), so they rely on ``stopPropagation`` to keep their clicks
  // from also firing "mark read". That's fragile — a native
  // ``<select>``'s change event doesn't reliably respect
  // ``stopPropagation`` on every browser/mobile webview, and any
  // future control added to the popover has to remember to opt out
  // too. Guard here as well: if the click actually landed inside the
  // popover or its button, bail out regardless of whether it was
  // supposed to have been stopped upstream. This is what was behind
  // "changing the sort marked the column read" — interacting with
  // the popover's controls could still reach this handler.
  const onHeaderClick = (e: React.MouseEvent) => {
    const target = e.target as Node
    if (popoverRef.current?.contains(target)) return
    if (prefsButtonRef.current?.contains(target)) return
    onMarkRead?.()
  }
  // Keyboard support — the header is interactive (it triggers an
  // action), so it should be a button. role="button" + tabIndex={0}
  // matches the pattern BriefCard uses for its collapse header.
  //
  // Same guard as onHeaderClick: Space or Enter on a focused control
  // in the popover (the Newest | Best buttons, the max-age dropdown)
  // is exactly "Enter or Space" from the
  // header's point of view once it bubbles, so without this check
  // adjusting the sort from the keyboard would ALSO mark the column
  // read (and Space would fight the select for its default
  // open-the-dropdown behavior).
  const onHeaderKey = (e: React.KeyboardEvent) => {
    const target = e.target as Node
    if (popoverRef.current?.contains(target)) return
    if (prefsButtonRef.current?.contains(target)) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onMarkRead?.()
    }
  }

  // Pre-split count: total entries across both sections. Used for
  // the "X of Y" header count, where Y is the pre-filter total
  // (passed via ``totalCount``). Naming this ``entryCount`` instead
  // of ``entries`` to avoid shadowing the prop shape — the
  // sections-based model means we no longer have an ``entries``
  // prop to refer to here.
  const entryCount = sections.new.length + sections.history.length
  const visible = totalCount ?? entryCount
  const showTotal = totalCount != null && totalCount !== entryCount

  return (
    <section className="flex flex-col h-full overflow-visible">
      <header
        role="button"
        tabIndex={0}
        onClick={onHeaderClick}
        onKeyDown={onHeaderKey}
        className="relative flex items-center justify-between px-1 pb-2 min-h-[44px] cursor-pointer select-none"
        title="tap to mark this column read"
      >
        {/* Thin hairline underline. iOS-style list-header separator —
          a single 1px line right at the bottom of the title row,
          rendered slightly inset so the line reads as belonging to
          the column rather than the page. */}
        <div
          aria-hidden="true"
          className="absolute left-1 right-1 bottom-0 h-px bg-hairline"
        />
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-ios-caption uppercase tracking-wide text-label-tertiary truncate">
            {label}
          </h2>
          {/* New-entry chip. Only renders when newCount > 0 — when
              it hits 0 the user has acknowledged the column and the
              chip just disappears. Pulses slightly via the accent
              color rather than an animation, matching the iOS
              "badge" pattern. */}
          {newCount != null && newCount > 0 && (
            onRefresh ? (
              <button
                type="button"
                data-new-chip
                onClick={(e) => {
                  // Stop the click from bubbling to the
                  // header (which would also call
                  // onMarkRead). The chip is a refresh
                  // affordance, not a mark-read one.
                  e.stopPropagation()
                  onRefresh()
                }}
                className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-ios-caption font-semibold uppercase tracking-wide text-white active:opacity-60 cursor-pointer"
                title={`${newCount} new since last visit — tap to refresh`}
                aria-label={`${newCount} new since last visit. Tap to refresh the column.`}
              >
                +{newCount} new
              </button>
            ) : (
              <span
                data-new-chip
                className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-ios-caption font-semibold uppercase tracking-wide text-white"
                title={`${newCount} new since last visit`}
              >
                +{newCount} new
              </span>
            )
          )}
          {/* Entry count. "X of Y" when filters are hiding some,
              plain "X" otherwise. text-label-secondary to keep it
              secondary to the new chip. */}
          <span className="text-ios-caption text-label-secondary">
            {showTotal ? `${entryCount} of ${visible}` : visible}
          </span>
        </div>

        {/* Sort/filter popover trigger. Every tab has one: For You
            sorts too (its Best is the server's order). */}
        {onPrefsChange && (
          <button
            ref={prefsButtonRef}
            data-column-action="prefs"
            onClick={(e) => {
              // Don't let the click bubble up to the header — it
              // would also fire onMarkRead. The header click is a
              // useful action but not when the user is just opening
              // preferences.
              e.stopPropagation()
              setPopoverOpen((p) => !p)
            }}
            className="shrink-0 w-11 h-11 -mr-1 flex items-center justify-center rounded-full text-label-secondary active:bg-bg-elevated"
            aria-label="column preferences"
            aria-expanded={popoverOpen}
          >
            <MoreIcon className="w-4 h-4" />
          </button>
        )}

        {popoverOpen && prefs && onPrefsChange && (
          <div
            ref={popoverRef}
            data-column-popover
            // Position relative to the header so it lands just below
            // the more-button on the right edge. min-w-[240px] keeps
            // the controls readable. z-20 puts it above cards but
            // below the Drawer (z-30+). The popover is the only
            // place we still render a popover-shaped surface — the
            // rest of the dashboard uses sheets / grouped lists.
            className="absolute right-0 top-full mt-2 z-20 min-w-[240px] rounded-ios-lg bg-bg-elevated shadow-2xl p-3 text-ios-body space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Newest | Best. Not on Saved, which keeps its own order
                (lib/sorting), so a control there would do nothing. */}
            {columnKey !== SAVED_KEY && (
              <div>
                <div
                  id={sortLabelId}
                  className="text-ios-caption uppercase tracking-wide text-label-tertiary mb-1"
                >
                  Sort
                </div>
                <div
                  role="group"
                  aria-labelledby={sortLabelId}
                  className="grid grid-cols-2 rounded-ios overflow-hidden border border-hairline"
                >
                  {SORTS.map((o) => {
                    const active = normalizeSort(prefs.sort, columnKey) === o.value
                    return (
                      <button
                        key={o.value}
                        type="button"
                        data-sort={o.value}
                        aria-pressed={active}
                        onClick={() => {
                          if (!active) onPrefsChange({ ...prefs, sort: o.value })
                        }}
                        className={`min-h-[44px] text-ios-body transition ${
                          active
                            ? 'bg-bg-elevated text-accent'
                            : 'bg-bg-surface text-label-primary active:bg-bg-elevated'
                        }`}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div>
              <label className="block text-ios-caption uppercase tracking-wide text-label-tertiary mb-1">
                Hide if older than
              </label>
              <select
                value={prefs.maxAgeHours == null ? 'all' : String(prefs.maxAgeHours)}
                onChange={(e) => {
                  const v = e.target.value
                  onPrefsChange({
                    ...prefs,
                    maxAgeHours: v === 'all' ? null : Number(v),
                  })
                }}
                className="select-ios w-full min-h-[44px] rounded-ios bg-bg-surface border border-hairline pl-3 pr-8 text-ios-body text-label-primary"
              >
                <option value="all">All</option>
                <option value="1">1 hour</option>
                <option value="4">4 hours</option>
                <option value="24">24 hours</option>
              </select>
            </div>
          </div>
        )}
      </header>
      {/* ``overflow-x-clip``: a mid-swipe card translateX (up to
          88px) must not widen this scroller — ``overflow-y-auto``
          alone would leave overflow-x at ``auto`` and give the
          browser a horizontally-pannable region mid-swipe, so the
          gesture pans the whole list instead of dragging the card.
          ``clip`` (not ``hidden``) keeps the element scrollable and
          avoids creating a scroll container on the X axis. */}
      <div
        ref={scrollerRef}
        data-scroller={scrollerRef ? '' : undefined}
        className="flex-1 overflow-x-clip overflow-y-auto overscroll-contain space-y-2 pr-1"
      >
        {entryCount === 0 ? (
          // Slice 19: context-aware empty state. The source's
          // ``last_fetch_at`` / ``last_error`` / ``error_count``
          // tell the user WHY the column is empty — has the
          // scheduler tried yet? did the last fetch error? was
          // the source auto-disabled? Meta columns (Saved /
          // For You / Multisub) don't have a backing source so
          // we fall back to the original generic message.
          <EmptyColumnMessage
            sourceName={sourceName}
            sourcesByName={sourcesByName}
            onAddFeed={noOwnFeeds && (columnKey === SAVED_KEY || columnKey === FORYOU_KEY) ? onAddFeed : undefined}
          />
        ) : (
          <>
            {/* Fresh section. Rendered first (the only section
                now \u2014 the History sub-section moved to the
                Drawer). Omitted entirely when the fresh slice
                is empty \u2014 no header, no "FRESH (0)" line. The
                collapsed flag unmounts the cards but keeps
                the header visible so the user can re-expand. */}
            {/* Fresh section \u2014 the column's primary view. Apollo
                terminology: "Fresh" is what the user hasn't
                acted on yet, in the tab's order (Newest or Best,
                sorted in App's columns memo). The user can
                collapse the section but the per-column History
                sub-section was removed \u2014 history now lives in
                the Drawer's "History" tab where the user can
                review past reads + hides + stars with full
                context (entry title, source, timestamp,
                polarity). Keeping history out of the column
                makes the column read as a focused "what's
                new" feed rather than a mixed bag of
                unread / read. */}
            {sections.new.length > 0 && (
              <ColumnSection
                label="Fresh"
                count={sections.new.length}
                // With no History section below, a "Fresh (n)" header
                // only repeats the column header's count, so it's left
                // out and the section can't be collapsed out of sight.
                showHeader={sections.history.length > 0}
                collapsed={sections.history.length > 0 && (sectionsCollapsed?.new ?? false)}
                onToggle={onToggleSection ? () => onToggleSection('new') : undefined}
                entries={sections.new}
                // All entries in the Fresh section are unread
                // by construction \u2014 that's the membership
                // predicate App uses to build the slice. Pass
                // ``unread=true`` uniformly so every card gets
                // the thin accent ring.
                unreadForCard={() => true}
                sourcesById={sourcesById}
                selectedId={selectedId}
                cardRefs={cardRefs}
                setCardRef={setCardRef}
                categoriesBySourceId={categoriesBySourceId}
                faviconBySourceId={faviconBySourceId}
                onMarkEntryRead={onMarkEntryRead}
                expandedSummaries={expandedSummaries}
                onToggleSummary={onToggleSummary}
                onHideEntry={onHideEntry}
                onHideToggle={onHideToggle}
                hiddenSet={hiddenSet}
                onStarEntry={onStarEntry}
                starredSet={starredSet}
                onVoteEntry={onVoteEntry}
                votedMap={votedMap}
                onSourceTap={onSourceTap}
              />
            )}

            {/* History sub-section. Shows entries the user
                has marked read (per-column). Visually
                dimmer than Fresh (Card's ``opacity-60``
                when ``unread=false``). Acts as a quick
                visual review for "what did I just read
                in this column". The Drawer's History
                tab is the full audit log with
                timestamps + source metadata; this
                section is the in-column glance.

                The collapsed state is independent of
                the Fresh section \u2014 the user can
                collapse either or both. Default
                expanded so the user always sees
                something in the column after they've
                read entries. The empty state
                (``sections.history.length === 0``) is
                handled by the parent \u2014 no
                "HISTORY (0)" line. */}

            {sections.history.length > 0 && (
              <ColumnSection
                label="History"
                count={sections.history.length}
                collapsed={sectionsCollapsed?.history ?? false}
                onToggle={onToggleSection ? () => onToggleSection('history') : undefined}
                entries={sections.history}
                // All entries in the History section are
                // read by construction \u2014 they were
                // sorted OUT of the fresh set by the
                // manual ``readEntries`` set. Pass
                // ``unread=false`` uniformly so every
                // card gets the dim opacity-60 + no
                // accent ring.
                unreadForCard={() => false}
                sourcesById={sourcesById}
                selectedId={selectedId}
                cardRefs={cardRefs}
                setCardRef={setCardRef}
                categoriesBySourceId={categoriesBySourceId}
                faviconBySourceId={faviconBySourceId}
                onMarkEntryRead={onMarkEntryRead}
                expandedSummaries={expandedSummaries}
                onToggleSummary={onToggleSummary}
                onHideEntry={onHideEntry}
                onHideToggle={onHideToggle}
                hiddenSet={hiddenSet}
                onStarEntry={onStarEntry}
                starredSet={starredSet}
                onVoteEntry={onVoteEntry}
                votedMap={votedMap}
                onSourceTap={onSourceTap}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

// One New/History section: clickable header + (when expanded) the
// list of cards. ``unreadForCard`` is a per-card lookup that returns
// true for every card in the New section and false for every card
// in the History section — by construction, the slices App passes
// in are uniform. (The function shape is reused so we can extend to
// mixed slices later, e.g. for a "stale but unread" indicator on
// the History section without restructuring.)
type SectionProps = {
  label: string
  // False drops the collapsible "LABEL (n)" header row.
  showHeader?: boolean
  count: number
  collapsed: boolean
  onToggle?: () => void
  entries: Entry[]
  unreadForCard: (e: Entry) => boolean
  sourcesById: Map<number, string>
  selectedId: number | undefined
  cardRefs:
    | Map<number, HTMLElement | null>
    | React.MutableRefObject<Map<number, HTMLElement | null>>
    | undefined
  setCardRef: (entryId: number) => (el: HTMLElement | null, prev?: HTMLElement | null) => void
  categoriesBySourceId: Map<number, string> | undefined
  faviconBySourceId: Map<number, string | null> | undefined
  onMarkEntryRead: ((entryId: number) => void) | undefined
  expandedSummaries: Set<number> | undefined
  onToggleSummary: ((entryId: number) => void) | undefined
  onHideEntry: ((entryId: number) => void) | undefined
  onHideToggle: ((entryId: number) => void) | undefined
  hiddenSet: Set<number> | undefined
  onStarEntry: ((entryId: number) => void) | undefined
  starredSet: Set<number> | undefined
  onVoteEntry: ((entryId: number, direction: 'up' | 'down' | null) => void) | undefined
  votedMap: Map<number, 'up' | 'down'> | undefined
  onSourceTap: ((sourceId: number) => void) | undefined
}

function ColumnSection({
  label,
  showHeader = true,
  count,
  collapsed,
  onToggle,
  entries,
  unreadForCard,
  sourcesById,
  selectedId,
  cardRefs,
  setCardRef,
  categoriesBySourceId,
  faviconBySourceId,
  onMarkEntryRead,
  expandedSummaries,
  onToggleSummary,
  onHideEntry,
  onHideToggle,
  hiddenSet,
  onStarEntry,
  starredSet,
  onVoteEntry,
  votedMap,
  onSourceTap,
}: SectionProps) {
  return (
    <div>
      {/* Section header. Click anywhere on the row to collapse /
          expand. The chevron rotates 90° on expand so the user
          gets a directional cue (right = collapsed, down =
          expanded). text-ios-caption + uppercase matches the
          column-header typography so the two read as the same
          scale. */}
      {showHeader && (
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={!collapsed}
        data-section-header={label.toLowerCase()}
        className="w-full flex items-center gap-1.5 px-1 py-1.5 min-h-[44px]
                   text-ios-caption uppercase tracking-wide text-label-tertiary
                   hover:text-label-secondary active:text-label-primary
                   transition-colors select-none
                   disabled:cursor-default disabled:hover:text-label-tertiary"
      >
        <ChevronIcon className="w-3 h-3" collapsed={collapsed} />
        <span>{label}</span>
        <span className="text-label-secondary font-semibold">({count})</span>
      </button>
      )}
      {/* Cards. Unmounted when collapsed (no animation, just a
          snap — matches BriefCard's collapse behavior and keeps
          the section cheap to re-open). The list keys are stable
          (entry.id) so React re-uses Card instances on re-expand
          instead of remounting. */}
      {!collapsed && (
        <div className="space-y-2">
          {entries.map((e) => {
            // Stable ref callback. The previous version allocated a
            // new closure per card per Column render, defeating the
            // ``memo`` on ``Card``. Instead, ``Card`` writes its own
            // DOM node into ``cardRefs`` keyed by entry id — the
            // Column doesn't need to bind anything, the Card knows
            // its own id and looks itself up.
            //
            // The custom-equal in ``Card.memo`` ignores the
            // ``cardRef`` prop entirely (it's a sentinel ``null`` /
            // ``undefined`` from Column), so any callback churn
            // here is free.
            return (
              <Card
                key={e.id}
                entry={e}
                sourceName={sourcesById.get(e.source_id)}
                sourceFaviconPath={faviconBySourceId?.get(e.source_id)}
                unread={unreadForCard(e)}
                selected={selectedId === e.id}
                cardRef={cardRefs ? setCardRef(e.id) : undefined}
                category={categoriesBySourceId?.get(e.source_id)}
                onMarkRead={onMarkEntryRead ? () => onMarkEntryRead(e.id) : undefined}
                expanded={expandedSummaries?.has(e.id) ?? false}
                onToggleSummary={onToggleSummary ? () => onToggleSummary(e.id) : undefined}
                onHide={onHideEntry ? () => onHideEntry(e.id) : undefined}
                onHideToggle={onHideToggle ? () => onHideToggle(e.id) : undefined}
                hidden={hiddenSet?.has(e.id) ?? false}
                onStar={onStarEntry ? () => onStarEntry(e.id) : undefined}
                starred={starredSet?.has(e.id) ?? false}
                onVote={onVoteEntry ? (dir) => onVoteEntry(e.id, dir) : undefined}
                vote={votedMap?.get(e.id) ?? null}
                onSourceTap={onSourceTap}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// iOS-style "more" glyph — three horizontal dots. Used for the
// column-preferences affordance; matches the SF Symbols
// "ellipsis" pictogram at small sizes.
function MoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6"  cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="18" cy="12" r="1.75" />
    </svg>
  )
}

// Right-pointing chevron used for the New/History section header
// disclosure. Rotates 90° (so it points down) when the section is
// expanded. Single CSS transform, GPU-driven — no JS animation
// loop, no reflow. The ``aria-hidden`` chevron is paired with the
// surrounding button's ``aria-expanded`` so the disclosure state
// is announced correctly.
function ChevronIcon({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className ?? ''} transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}








// ---------------------------------------------------------------------------
// Slice 19: context-aware empty-state
// ---------------------------------------------------------------------------

// Auto-disable threshold for the source.error_count check below.
// Mirrors ``app.scheduler._AUTO_DISABLE_THRESHOLD`` — the backend
// flips active=False when error_count hits this. Surfacing it in
// the empty-state lets the user distinguish "transient error"
// (error_count < 5) from "auto-disabled" (>= 5).
const AUTO_DISABLE_THRESHOLD = 5

function EmptyColumnMessage({
  sourceName,
  sourcesByName,
  onAddFeed,
}: {
  sourceName?: string
  sourcesByName?: Map<string, import('../api').Source>
  // Set on an empty Saved or For You while every feed is a built-in.
  onAddFeed?: () => void
}) {
  // The column's feed: the one feed a filter shows, or the feed named
  // like a category.
  const source = sourceName != null ? sourcesByName?.get(sourceName) : undefined
  // No such feed (Saved, For You, a filter of several feeds) or
  // sourcesByName not provided: "No stories yet", with the first-feed
  // button when set.
  if (!source) {
    return (
      <div className="px-1 space-y-3">
        <p className="text-ios-body text-label-secondary">No stories yet</p>
        {onAddFeed && <FirstFeedButton onClick={onAddFeed} />}
      </div>
    )
  }
  // Source-backed column. Pick the most specific message:
  //   1. auto-disabled (error_count >= threshold and not active)
  //   2. transient error (last_error set, error_count < threshold)
  //   3. fetched but found nothing (last_fetch_at set, no error)
  //   4. never fetched yet (last_fetch_at null)
  if (source.auto_disabled || (source.error_count >= AUTO_DISABLE_THRESHOLD && !source.active)) {
    return (
      <p className="text-ios-body text-label-secondary italic px-1">
        Popping stopped checking this feed after {source.error_count} failed tries — resume it in Menu → Settings → Feeds
      </p>
    )
  }
  if (source.last_error) {
    // Truncate to keep the message terse — the full error lives in
    // Menu → Settings → Feeds. 80 chars is enough to identify the
    // kind of error without scrolling.
    const snippet = source.last_error.slice(0, 80)
    return (
      <p className="text-ios-body text-label-secondary italic px-1">
        last fetch failed: {snippet}{source.last_error.length > 80 ? '\u2026' : ''}
      </p>
    )
  }
  if (source.last_fetch_at) {
    // Format the timestamp as "Xh ago" without pulling in a date
    // library. Sufficient granularity for "is the scheduler still
    // running?" — minutes/seconds aren't actionable.
    const fetchedMs = new Date(source.last_fetch_at).getTime()
    const ageHours = Math.max(0, Math.round((Date.now() - fetchedMs) / (1000 * 60 * 60)))
    return (
      <p className="text-ios-body text-label-secondary italic px-1">
        last fetched {ageHours}h ago — no entries match the current filters
      </p>
    )
  }
  return (
    <p className="text-ios-body text-label-secondary italic px-1">
      source added, waiting for first fetch
    </p>
  )
}

// Slice 21: custom comparator for ``React.memo`` wrap. Compares the
// data-driven props by identity (refs/maps/sets are reference-compared)
// or by value (scalars). Callback props are intentionally ignored —
// the App layer re-allocates them every render, and the per-render
// closure captures fresh state, so comparing them by identity would
// always return false and defeat the memo.
//
// Same pattern as ``Card.memo`` in ``Card.tsx`` (line 1477). Card's
// comparator is finer-grained (per-entry); Column's is coarser
// (sections ref + sets ref + scalar props) because Column renders
// the section containers and delegates to memoized Card children.
function _columnPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.columnKey === next.columnKey &&
    prev.label === next.label &&
    prev.sourceName === next.sourceName &&
    prev.sections === next.sections &&
    prev.sourcesById === next.sourcesById &&
    prev.sourcesByName === next.sourcesByName &&
    prev.noOwnFeeds === next.noOwnFeeds &&
    prev.newCount === next.newCount &&
    prev.selectedId === next.selectedId &&
    // ``prefs`` is a fresh object per columnPrefs write, but its
    // contents only change when the user opens the popover and picks
    // a new value. The user's own ``onPrefsChange`` callback reads
    // the latest value, so a stale comparator returning true here is
    // safe (the next user-driven write will produce a new prefs
    // object and the comparator will return false). Comparing by
    // reference is what makes this work — shallow-equal would
    // always differ because every render allocates a new object.
    prev.prefs === next.prefs &&
    prev.totalCount === next.totalCount &&
    prev.categoriesBySourceId === next.categoriesBySourceId &&
    prev.faviconBySourceId === next.faviconBySourceId &&
    prev.expandedSummaries === next.expandedSummaries &&
    prev.starredSet === next.starredSet &&
    prev.hiddenSet === next.hiddenSet &&
    prev.votedMap === next.votedMap &&
    prev.sectionsCollapsed === next.sectionsCollapsed
  )
}

export const Column = memo(ColumnInner, _columnPropsEqual) as typeof ColumnInner
