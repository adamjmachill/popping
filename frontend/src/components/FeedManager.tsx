// Phase 5 FeedManager — Drawer section for adding, editing, and
// removing dynamic RSS feeds. Three tabs:
//
//   • My feeds — the existing source list, with per-row actions:
//     toggle active, edit metadata, edit refresh interval, delete
//     (works for both dynamic and built-in rows). Plugin-backed
//     rows have url/name fields locked (the plugin owns them) but
//     can still be deleted — permanently: the backend records the
//     deletion so the plugin doesn't recreate the row on its next
//     scheduled tick or after a backend restart.
//
//   • Recommended — curated list from GET /api/feed-recommendations,
//     minus anything the user already has. Tap "Add" to fire
//     POST /api/sources.
//
//   • Add custom — name + URL + category form for an RSS URL not in
//     the curated list. Client-side URL validation; the backend is
//     the source of truth on errors and returns 422 with field-level
//     details.
//
// Errors flow up to App's red banner via `onError` so the
// visual treatment matches refresh failures — single, consistent
// error surface across the dashboard.
//
// Add Custom has a "Test" button next to "Add feed" so the user
// can probe the URL with the same plugin Add would use, no DB
// write. The result is shown inline: green "Looks good (42
// items)" with sample titles, or red "Site blocks automated
// access" with the raw error. The Add flow always succeeds
// against URLs that pass Test (modulo name conflicts that show
// up at Add time). The Test step is non-destructive and
// reversible — tapping it doesn't change the form state.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Source } from '../api'
import { SourceIcon } from './SourceIcon'
import { CategoryPicker } from './feeds/CategoryPicker'
import { HeadersEditor } from './feeds/HeadersEditor'
import { categoryLabel, sourceLabel } from '../lib/labels'
import {
  PODCAST_DEFAULT_REFRESH,
  REFRESH_PRESETS,
  YOUTUBE_DEFAULT_REFRESH,
  checkName,
  classifyPaste,
  isBuiltIn,
  isStale,
  normalizeFeedInput,
  normalizeName,
  refreshLabel,
  suggestName,
  timeAgo,
} from '../lib/feedRules'
import { CATEGORY_OPTIONS, resolveNewCategory } from '../lib/categories'
import { type HeaderMap } from '../lib/headers'
import { fieldSaveMessage, friendlyTestError, parseApiError } from '../lib/apiErrors'
import { toast } from './Toast'

type Props = {
  sources: Source[]
  onRefresh: () => Promise<void>
  onError: (msg: string) => void
  // Bubbles up from ``SourceRow`` when the user renames a source via
  // the inline edit form. See ``App.tsx`` — the parent remaps
  // ``activeSources`` synchronously so the chip bar stays consistent
  // through the rename.
  onSourceRenamed?: (oldName: string, newName: string) => void
}

type Tab = 'mine' | 'recommended' | 'add'

export function FeedManager({ sources, onRefresh, onError, onSourceRenamed }: Props) {
  const [tab, setTab] = useState<Tab>('mine')
  const [editingInterval, setEditingInterval] = useState<number | null>(null)
  const [editingRowId, setEditingRowId] = useState<number | null>(null)
  // Stable Set of source names. ``RecommendedTab``'s useEffect
  // depends on this and would otherwise refire on every parent
  // render (parent constructs ``new Set(...)`` inline today).
  const existingNames = useMemo(
    () => new Set(sources.map((s) => s.name)),
    [sources],
  )

  return (
    <div className="space-y-2">
      <div className="flex gap-1" role="tablist" aria-label="feed manager tabs">
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
          My feeds
        </TabButton>
        <TabButton active={tab === 'recommended'} onClick={() => setTab('recommended')}>
          Suggested
        </TabButton>
        <TabButton active={tab === 'add'} onClick={() => setTab('add')}>
          Add
        </TabButton>
      </div>

      {tab === 'mine' && (
        <MyFeedsTab
          sources={sources}
          editingInterval={editingInterval}
          setEditingInterval={setEditingInterval}
          editingRowId={editingRowId}
          setEditingRowId={setEditingRowId}
          onRefresh={onRefresh}
          onError={onError}
          onSourceRenamed={onSourceRenamed}
        />
      )}
      {tab === 'recommended' && (
        <RecommendedTab
          sources={sources}
          existingNames={existingNames}
          onAdded={onRefresh}
          onError={onError}
        />
      )}
      {tab === 'add' && (
        <AddCustomTab sources={sources} onAdded={onRefresh} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 min-w-0 min-h-[44px] px-1 rounded-ios text-ios-body max-[359px]:text-[15px] whitespace-nowrap truncate transition ${
        active
          ? 'bg-bg-elevated text-accent'
          : 'bg-bg-surface text-label-primary active:bg-bg-elevated'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// My feeds — existing source list with per-row actions
// ---------------------------------------------------------------------------

function MyFeedsTab({
  sources,
  editingInterval,
  setEditingInterval,
  editingRowId,
  setEditingRowId,
  onRefresh,
  onError,
  onSourceRenamed,
}: {
  sources: Source[]
  editingInterval: number | null
  setEditingInterval: (id: number | null) => void
  // ID of the row currently in inline edit mode. Mutually exclusive
  // with ``editingInterval`` for that row — editing the metadata
  // closes any open interval picker on the same row.
  editingRowId: number | null
  setEditingRowId: (id: number | null) => void
  onRefresh: () => Promise<void>
  onError: (msg: string) => void
  onSourceRenamed?: (oldName: string, newName: string) => void
}) {
  if (sources.length === 0) {
    return <p className="text-ios-body text-label-secondary italic px-1">no sources yet</p>
  }
  return (
    <ul className="space-y-1">
      {sources.map((s) => (
        <li key={s.id}>
          <SourceRow
            source={s}
            isEditingInterval={editingInterval === s.id}
            onStartEditInterval={() => setEditingInterval(s.id)}
            onCancelEditInterval={() => setEditingInterval(null)}
            isEditing={editingRowId === s.id}
            onStartEdit={() => {
              setEditingInterval(null)
              setEditingRowId(s.id)
            }}
            onCancelEdit={() => setEditingRowId(null)}
            onRefresh={onRefresh}
            onError={onError}
            onRenamed={(oldName, newName) => {
              setEditingRowId(null)
              onSourceRenamed?.(oldName, newName)
            }}
          />
        </li>
      ))}
    </ul>
  )
}

function SourceRow({
  source,
  isEditingInterval,
  onStartEditInterval,
  onCancelEditInterval,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onRefresh,
  onError,
  onRenamed,
}: {
  source: Source
  isEditingInterval: boolean
  onStartEditInterval: () => void
  onCancelEditInterval: () => void
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onRefresh: () => Promise<void>
  onError: (msg: string) => void
  onRenamed?: (oldName: string, newName: string) => void
}) {
  const builtIn = isBuiltIn(source)
  const [busy, setBusy] = useState(false)
  // Inline two-tap delete confirm. ``confirmingDelete`` swaps the
  // single ``delete`` button into a ``confirm delete`` + ``cancel``
  // pair, scoped to this row. Auto-cancels after
  // ``CONFIRM_TIMEOUT_MS`` so an abandoned confirm doesn't linger
  // forever (user opened delete, looked away, came back). The native
  // ``window.confirm`` modal was jarring inside a drawer — competing
  // iOS sheet for the user's attention. Inline keep the gesture in
  // the drawer's frame.
  const CONFIRM_TIMEOUT_MS = 4000
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Rows show name, category and freshness; the controls (pause,
  // edit, interval, fetch, delete) appear when the row is tapped,
  // like an iOS settings list, instead of six links on every row.
  const [open, setOpen] = useState(false)

  const toggleActive = async () => {
    setBusy(true)
    try {
      await api.updateSource(source.id, { active: !source.active })
      await onRefresh()
    } catch (err) {
      onError(parseApiError(err, 'failed to update source'))
    } finally {
      setBusy(false)
    }
  }

  const setInterval = async (seconds: number) => {
    setBusy(true)
    try {
      await api.updateSource(source.id, { refresh_interval_seconds: seconds })
      await onRefresh()
      onCancelEditInterval()
    } catch (err) {
      onError(parseApiError(err, 'failed to update refresh interval'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    // Inline two-tap — the first tap set ``confirmingDelete`` to
    // true (button became "confirm delete"). This is the second tap.
    // Works the same for built-in and dynamic rows — see
    // ``KNOWN_BUILT_INS`` in lib/feedRules.ts.
    setBusy(true)
    try {
      await api.deleteSource(source.id)
      setConfirmingDelete(false)
      await onRefresh()
    } catch (err) {
      onError(parseApiError(err, 'failed to delete source'))
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  // Auto-cancel the confirm after a few seconds. Reset the timer on
  // each new confirmation so a user who taps, waits, taps again gets
  // a fresh window. ``useRef`` avoids re-firing the effect when only
  // the timeout id changes.
  useEffect(() => {
    if (!confirmingDelete) return
    const t = window.setTimeout(() => setConfirmingDelete(false), CONFIRM_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [confirmingDelete])

  // Edit form local state — initialized from props so the user
  // always sees the current row values, not stale defaults. Reset
  // on each edit-start so cancelling a rename and starting again
  // doesn't show the previously-typed (and rejected) values.
  const [editName, setEditName] = useState(source.name)
  const [editUrl, setEditUrl] = useState(source.url)
  const [editCategory, setEditCategory] = useState(source.category)
  // ``editHeaders`` is a JSON-string textarea. Empty string means
  // "no override" (custom_headers column will be cleared on save);
  // any non-empty value must parse to a ``str → str`` map. We keep
  // it as a string rather than a parsed object because the user
  // expects to see exactly what they typed, and showing parsed keys
  // back to them in a different order would feel broken.
  const [editHeaders, setEditHeaders] = useState(
    source.custom_headers ? JSON.stringify(source.custom_headers) : '',
  )
  // Parse error from the last editHeaders change. Surfaced inline
  // so the user sees why Save is disabled rather than getting a
  // generic 422 on submit.
  const [headersError, setHeadersError] = useState<string | null>(null)

  // When edit mode opens, seed the inputs from the current row. Use
  // an effect keyed on ``isEditing`` rather than re-deriving in the
  // ``useState`` initializer because React only runs the initializer
  // once — closing + reopening edit mode would otherwise show stale
  // text from the previous edit.
  useEffect(() => {
    if (isEditing) {
      setEditName(source.name)
      setEditUrl(source.url)
      setEditCategory(source.category)
      setEditHeaders(
        source.custom_headers ? JSON.stringify(source.custom_headers) : '',
      )
      setHeadersError(null)
    }
  }, [isEditing, source.name, source.url, source.category, source.custom_headers])

  // Live-validate the headers textarea. Treat empty as "no override";
  // for non-empty, try-parse and confirm it's a flat string→string map.
  // We do this on every keystroke so the Save button can flip between
  // enabled and disabled without a click round-trip.
  const parsedHeaders = (() => {
    if (!editHeaders.trim()) return { ok: true as const, value: null as Record<string, string> | null }
    try {
      const parsed = JSON.parse(editHeaders)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.entries(parsed).some(
          ([k, v]) => typeof k !== 'string' || typeof v !== 'string',
        )
      ) {
        return { ok: false as const, error: 'must be a flat {"Header": "value"} map' }
      }
      return { ok: true as const, value: parsed as Record<string, string> }
    } catch {
      return { ok: false as const, error: 'invalid JSON' }
    }
  })()
  // Push the error string into state so the inline error renders,
  // but only if it changed (avoids re-renders on every keystroke
  // when the message is the same).
  useEffect(() => {
    const next = parsedHeaders.ok ? null : parsedHeaders.error
    if (next !== headersError) setHeadersError(next)
  }, [parsedHeaders.ok, parsedHeaders.error]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdit = async () => {
    const nameChanged = editName.trim() !== source.name
    const urlChanged = editUrl.trim() !== source.url
    const categoryChanged = editCategory.trim() !== source.category
    // Compare parsed headers against the source's current map. We
    // parse the textarea first so trailing-whitespace differences
    // don't accidentally trigger a no-op PATCH.
    const headersChanged =
      JSON.stringify(parsedHeaders.value ?? null) !==
      JSON.stringify(source.custom_headers ?? null)
    if (
      !nameChanged &&
      !urlChanged &&
      !categoryChanged &&
      !headersChanged
    ) {
      // Nothing to save — close the form so the user doesn't think
      // the click was eaten by a bug.
      onCancelEdit()
      return
    }
    if (!parsedHeaders.ok) {
      // Guard against the rare race where the user clicks Save with
      // an invalid textarea. The button is disabled when not
      // ``parsedHeaders.ok`` but we re-check here as a safety net.
      return
    }
    setBusy(true)
    try {
      const body: {
        name?: string
        url?: string
        category?: string
        // ``null`` clears the column; an object sets/replaces it.
        custom_headers?: Record<string, string> | null
      } = {}
      if (nameChanged) body.name = editName.trim()
      if (urlChanged) body.url = editUrl.trim()
      if (categoryChanged) body.category = editCategory.trim()
      if (headersChanged) body.custom_headers = parsedHeaders.value
      const updated = await api.updateSource(source.id, body)
      const oldName = source.name
      const newName = updated.name
      await onRefresh()
      if (nameChanged && oldName !== newName) {
        // Bubble up so App can remap the active filter chip in the
        // same render cycle as the refresh.
        onRenamed?.(oldName, newName)
      } else {
        // No rename — close edit mode without triggering the remap.
        onCancelEdit()
      }
    } catch (err) {
      onError(parseApiError(err, 'failed to save changes'))
    } finally {
      setBusy(false)
    }
  }

  if (isEditing) {
    // Inline edit form — replaces the read-only row chrome while
    // open. The fields mirror what's editable via PATCH (name +
    // url + category). ``url`` is locked for built-ins because the
    // backend rejects it with a 400 anyway; locking client-side
    // avoids the user typing something that would just bounce.
    return (
      <div className={`px-3 py-2 text-ios-caption border-b border-hairline last:border-b-0 space-y-2 ${busy ? 'opacity-60' : ''}`}>
        <label className="block">
          <span className="text-label-tertiary text-[11px] uppercase tracking-wide">name</span>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={busy || builtIn}
            className="mt-0.5 w-full bg-bg-elevated border border-hairline rounded-ios px-2 py-1 text-ios-body text-label-primary disabled:opacity-50"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="text-label-tertiary text-[11px] uppercase tracking-wide">url</span>
          <input
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            disabled={busy || builtIn}
            className="mt-0.5 w-full bg-bg-elevated border border-hairline rounded-ios px-2 py-1 text-ios-body text-label-primary disabled:opacity-50"
            spellCheck={false}
          />
          {builtIn && (
            <span className="block text-label-tertiary text-[10px] mt-0.5">
              built-in — url is bound to the plugin
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-label-tertiary text-[11px] uppercase tracking-wide">category</span>
          <input
            type="text"
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            disabled={busy}
            className="mt-0.5 w-full bg-bg-elevated border border-hairline rounded-ios px-2 py-1 text-ios-body text-label-primary disabled:opacity-50"
            list="feed-category-options"
            spellCheck={false}
          />
          <datalist id="feed-category-options">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        {/*
          Custom HTTP headers. Hidden for built-ins — the URL is
          locked too, and overriding headers on a built-in would
          defeat the point of the static plugin contract. Empty
          textarea means "use defaults"; non-empty must parse as a
          flat str→str map. ``User-Agent`` is the only override
          anyone realistically needs (CBC blocks our default UA),
          but the textarea lets power users add e.g.
          ``Accept-Language`` for region-gated feeds.
        */}
        {!builtIn && (
          <label className="block">
            <span className="text-label-tertiary text-[11px] uppercase tracking-wide">
              custom headers (JSON)
            </span>
            <textarea
              value={editHeaders}
              onChange={(e) => setEditHeaders(e.target.value)}
              disabled={busy}
              rows={3}
              spellCheck={false}
              placeholder='{"User-Agent": "Mozilla/5.0 ..."}'
              className="mt-0.5 w-full bg-bg-elevated border border-hairline rounded-ios px-2 py-1 text-ios-caption text-label-primary font-mono disabled:opacity-50"
            />
            {headersError && (
              <span className="block text-red-400 text-[10px] mt-0.5">
                {headersError}
              </span>
            )}
            {!headersError && editHeaders.trim() && (
              <span className="block text-label-tertiary text-[10px] mt-0.5">
                sent on every fetch; clear to use defaults
              </span>
            )}
          </label>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={saveEdit}
            disabled={busy || !parsedHeaders.ok}
            className="text-ios-caption text-accent active:opacity-60 disabled:opacity-40"
          >
            save
          </button>
          <button
            onClick={onCancelEdit}
            disabled={busy}
            className="text-ios-caption text-label-secondary active:opacity-60 disabled:opacity-40"
          >
            cancel
          </button>
          {!builtIn && source.url !== editUrl && (
            <span
              className="text-ios-caption text-amber-400 ml-auto"
              title="changing the url clears the cached favicon; the next ingest re-downloads"
            >
              ⚠ favicon resets
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`py-0.5 text-ios-caption border-b border-hairline last:border-b-0 ${busy ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[44px] flex items-center gap-2 min-w-0 text-left"
      >
        {/* SourceIcon — colored-letter fallback when the favicon
            hasn't landed yet. ``size={14}`` matches the original
            w-3.5 h-3.5 img (14px). */}
        <SourceIcon src={source.favicon_path} name={source.name} size={14} />
        <span
          className={`min-w-0 truncate font-medium ${
            !source.active
              ? 'text-label-secondary line-through'
              : isStale(source)
                ? 'text-label-secondary italic'
                : 'text-label-primary'
          }`}
          title={
            isStale(source)
              ? `last fetched ${timeAgo(source.last_fetch_at)} — refresh interval is ${refreshLabel(source.refresh_interval_seconds)}`
              : undefined
          }
        >
          {sourceLabel(source.name)}
        </span>
        <span
          aria-hidden="true"
          className={`ml-auto shrink-0 text-label-tertiary transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>
      {/* Caption line, always shown: category, freshness, then status
          chips. They live here rather than beside the name, so a feed's
          name keeps the width it needs on a phone; the line wraps when
          it runs long. */}
      <div className="-mt-2 pb-2 pl-[22px] flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ios-caption">
        <span className="max-w-full truncate text-label-secondary">{categoryLabel(source.category)}</span>
        <span className={isStale(source) ? 'text-amber-400' : 'text-label-tertiary'}>
          updated {timeAgo(source.last_fetch_at)} · every {refreshLabel(source.refresh_interval_seconds)}
        </span>
        {/* Auto-disabled chips take precedence over the plain
            "paused" chip — the distinction matters: a paused source
            is a user choice (no action needed); an auto-disabled
            source has hit the scheduler's consecutive-failure
            threshold and needs ``last_error`` review before a manual
            re-enable is worthwhile. ``auto_disabled`` is computed on
            the backend (``Source.auto_disabled``) so the frontend
            doesn't have to know the threshold value. */}
        {source.auto_disabled ? (
          <span
            className="text-ios-caption text-red-400 shrink-0"
            title={
              source.last_error
                ? `auto-disabled after ${source.error_count} consecutive failures — last: ${source.last_error}`
                : `auto-disabled after ${source.error_count} consecutive failures`
            }
          >
            auto-disabled
          </span>
        ) : (
          !source.active && (
            <span className="text-ios-caption text-amber-400 shrink-0">paused</span>
          )
        )}
        {/* Quantitative error chip. ``error_count > 1`` shows the
            number so the user can distinguish a chronic failure
            (``⚠ 144``) from a one-off (``⚠`` alone is fine for
            ``error_count === 1``). Gated on the count rather than
            ``last_error`` truthiness so a source that recovered
            between fetches but still has a nonzero counter doesn't
            silently flash a warning. */}
        {source.error_count > 0 && (
          <span
            className="text-ios-caption text-red-400 shrink-0"
            title={
              source.last_error
                ? `${source.error_count} consecutive failure${source.error_count === 1 ? '' : 's'} — last: ${source.last_error}`
                : `${source.error_count} consecutive failure${source.error_count === 1 ? '' : 's'}`
            }
          >
            ⚠ {source.error_count > 1 ? source.error_count : ''}
          </span>
        )}
        {/* Net vote score — sum(thumb_up) - sum(thumb_down) across
            every entry from this source. Omitted at exactly 0 (never
            voted on, or an even split — neither is actionable) so
            most rows stay quiet; only sources the user has a real
            opinion on get a badge. Negative (a source they keep
            downvoting) is the one worth surfacing loudly — red, with
            the minus sign JS already gives negative numbers.
            Positive gets a quieter green; there's no "clean this up"
            action implied by a source the user likes. */}
        {source.net_vote_score !== 0 && (
          <span
            className={`shrink-0 text-ios-caption font-semibold ${
              source.net_vote_score < 0 ? 'text-red-400' : 'text-emerald-400'
            }`}
            title={`net vote score: ${source.net_vote_score > 0 ? '+' : ''}${source.net_vote_score} (thumbs up minus thumbs down across this source's entries)`}
          >
            {source.net_vote_score > 0 ? '+' : ''}
            {source.net_vote_score}
          </span>
        )}
      </div>
      {open && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 pl-[22px]">
        <button
          onClick={toggleActive}
          disabled={busy}
          className="min-h-[36px] text-ios-caption text-accent active:opacity-60 disabled:opacity-40"
          aria-label={source.active ? 'pause source' : 'resume source'}
        >
          {source.active ? 'pause' : 'resume'}
        </button>
        <button
          onClick={onStartEdit}
          disabled={busy}
          className="text-ios-caption text-accent active:opacity-60 disabled:opacity-40"
          aria-label={`edit ${source.name}`}
        >
          edit
        </button>
        {/* Last-fetched caption. Renders inline with the action
            buttons so the user can read at-a-glance freshness
            without hovering for a tooltip. ``text-label-tertiary``
            keeps it secondary to the action affordances. Stale
            sources get ``text-amber-400`` to flag the row without
            using up another glyph in the title row. */}
        <span
          className={`text-ios-caption text-label-tertiary ${
            isStale(source) ? 'text-amber-400' : ''
          }`}
          title={
            source.last_fetch_at
              ? `last fetch: ${new Date(source.last_fetch_at).toLocaleString()}`
              : 'never fetched'
          }
        >
          · fetched {timeAgo(source.last_fetch_at)}
        </span>
        {isEditingInterval ? (
          <select
            value={source.refresh_interval_seconds}
            onChange={(e) => setInterval(Number(e.target.value))}
            disabled={busy}
            className="text-ios-caption rounded-ios bg-bg-elevated border border-hairline px-1 py-0.5 text-label-primary"
            aria-label="refresh interval"
          >
            {REFRESH_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                every {p.label}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={onStartEditInterval}
            disabled={busy}
            className="text-ios-caption text-accent active:opacity-60 disabled:opacity-40"
            aria-label="edit refresh interval"
          >
            every {refreshLabel(source.refresh_interval_seconds)}
          </button>
        )}
        {isEditingInterval && (
          <button
            onClick={onCancelEditInterval}
            disabled={busy}
            className="text-ios-caption text-label-secondary active:opacity-60 disabled:opacity-40"
          >
            cancel
          </button>
        )}
        {/* Fetch-now button. Power-user affordance: force an
            immediate ingest without waiting for the next scheduler
            tick. The backend's POST /api/ingest/{name} endpoint
            returns the same ``IngestResult`` shape, so we surface
            the row + inserted counts in a toast. We sit the button
            to the LEFT of the delete button (which is ``ml-auto``)
            so the destructive action stays at the far right. */}
        {!confirmingDelete && (
          <button
            onClick={async () => {
              setBusy(true)
              try {
                const r = await api.ingest(source.name)
                if (r.error) {
                  toast(`${source.name}: ${r.error}`, 'error')
                } else {
                  toast(
                    `Fetched ${r.fetched} from ${r.source}` +
                      (r.inserted > 0 ? ` (${r.inserted} new)` : ''),
                    'info',
                  )
                }
                await onRefresh()
              } catch (err) {
                onError(parseApiError(err, 'fetch failed'))
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="text-ios-caption text-accent active:opacity-60 disabled:opacity-40"
            aria-label={`fetch ${source.name} now`}
          >
            fetch
          </button>
        )}
        {!confirmingDelete && (
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="ml-auto text-ios-caption text-red-400 active:opacity-60 disabled:opacity-40"
            aria-label={`delete ${source.name}`}
          >
            delete
          </button>
        )}
        {confirmingDelete && (
          <>
            <button
              onClick={onDelete}
              disabled={busy}
              className="ml-auto text-ios-caption text-red-400 active:opacity-60 disabled:opacity-40 font-semibold"
              aria-label={`confirm delete ${source.name}`}
            >
              confirm delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="text-ios-caption text-label-secondary active:opacity-60 disabled:opacity-40"
              aria-label={`cancel delete ${source.name}`}
            >
              cancel
            </button>
          </>
        )}
        {builtIn && !confirmingDelete && (
          <span
            className="text-ios-caption text-label-tertiary"
            title="built-in source — url/name are locked to the plugin. Deleting it is permanent."
          >
            built-in
          </span>
        )}
      </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recommended — curated list, one-tap Add
// ---------------------------------------------------------------------------

type Recommendation = {
  name: string
  category: string
  url: string
  blurb: string
  // ``Source.type`` — ``"rss"`` (default) or ``"reddit"``. Forwarded
  // verbatim to ``POST /api/sources`` so the backend dispatches to
  // the right plugin. Recommendations without the field fall through
  // to the default ("rss") for forward compat with the editor rows
  // that predate the Reddit rollout.
  type?: string
  // Optional HTTP header overrides pre-applied at Add time. Set
  // on entries whose CDN blocks our default ``Popping/0.2`` UA
  // (CBC). The frontend passes them through to ``POST /api/sources``
  // as ``custom_headers`` — no extra click needed.
  default_headers?: Record<string, string> | null
  // "editorial" (hand-picked) or "llm" (found via the "Find more
  // feeds" button / auto-discovery). Drives the small badge next to
  // the name so a freshly-discovered row reads differently from the
  // curated set.
  source?: string
}

function RecommendedTab({
  sources,
  existingNames,
  onAdded,
  onError,
}: {
  sources: Source[]
  existingNames: Set<string>
  onAdded: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [recs, setRecs] = useState<Recommendation[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  // "Find more feeds" button state. ``discovering`` disables the
  // button while the LLM call + validation fetches are in flight
  // (a few seconds); ``discoverMsg`` is a one-line status the user
  // sees after it resolves ("found 2 new feeds" / "nothing new
  // found this time" — added=0 is a normal outcome, not an error).
  const [discovering, setDiscovering] = useState(false)
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null)

  // Shared loader — used for the mount fetch and for refetching after
  // "Find more feeds" adds new rows to the pool.
  const fetchRecs = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.feedRecommendations()
      // Backend already strips names that exist; the frontend filter
      // is a defensive belt-and-suspenders for a stale cache that
      // doesn't yet know about a freshly-added row.
      setRecs(rows.filter((r) => !existingNames.has(r.name)))
    } catch (err) {
      onError(parseApiError(err, 'failed to load recommendations'))
    } finally {
      setLoading(false)
    }
  }, [existingNames, onError])

  // Fetch on mount. We don't otherwise poll — the user can navigate
  // away and back for a fresh list, and "Find more feeds" (below)
  // covers the case where the pool itself changes.
  useEffect(() => {
    fetchRecs()
  }, [fetchRecs])

  const findMore = async () => {
    setDiscovering(true)
    setDiscoverMsg(null)
    try {
      const result = await api.discoverFeeds()
      const where = categoryLabel(result.category)
      setDiscoverMsg(
        result.added > 0
          ? `Found ${result.added} new feed${result.added === 1 ? '' : 's'} for ${where}`
          : result.note
            ? `No new feeds for ${where}: ${result.note}`
            : `Nothing new for ${where} this time`,
      )
      if (result.added > 0) await fetchRecs()
    } catch (err) {
      onError(parseApiError(err, 'failed to find more feeds'))
    } finally {
      setDiscovering(false)
    }
  }

  const add = async (rec: Recommendation) => {
    setAdding(rec.name)
    // Per-type sensible default refresh when the recommendation
    // doesn't ship one (none do today; the backend fills in the
    // same default from ``routes/sources._REDDIT_DEFAULT_REFRESH``
    // and ``_REFRESH_MIN * 60``). Mirroring the backend defaults
    // client-side means the Source row renders with the right
    // interval on first list refresh, before the backend's
    // response comes back.
    const isReddit = rec.type === 'reddit'
    // An existing spelling of the category ("News") is reused, so the
    // feed joins that column instead of starting a second one.
    const category = resolveCategory(rec.category, sources)
    try {
      await api.createSource({
        name: rec.name,
        type: rec.type ?? 'rss',
        category,
        url: rec.url,
        refresh_interval_seconds: isReddit ? 900 : 3600,
        // Recommendation-supplied header overrides (e.g. CBC's
        // browser UA). Falls through to the route's ``None``
        // branch when the recommendation doesn't ship one —
        // omitting the field leaves ``custom_headers`` at the
        // backend default (empty map → use source-plugin defaults).
        custom_headers: rec.default_headers ?? undefined,
      })
      toast(`Added ${sourceLabel(rec.name)} to ${categoryLabel(category)}`, 'info')
      await onAdded()
      // Optimistically remove from the local list so the row
      // disappears immediately rather than after the next refresh.
      setRecs((prev) => (prev ? prev.filter((r) => r.name !== rec.name) : prev))
    } catch (err) {
      toast(`Couldn't add ${sourceLabel(rec.name)}: ${fieldSaveMessage(err, 'name', rec.name, sourceLabel)}`, 'error')
    } finally {
      setAdding(null)
    }
  }

  // "Find more feeds" header — shown above the list regardless of
  // loading/empty state so the user can trigger discovery even when
  // the curated pool is fully added (the most likely time they'd
  // actually want it).
  const findMoreHeader = (
    <div className="pt-1 pb-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline">
      <button
        onClick={findMore}
        disabled={discovering}
        className="shrink-0 min-h-[44px] rounded-ios border border-accent text-accent active:opacity-60 disabled:opacity-40 px-3 text-ios-caption"
      >
        {discovering ? 'Looking…' : '🔎 Find more feeds'}
      </button>
      {discoverMsg && (
        <span className="min-w-0 text-ios-caption text-label-tertiary break-words">{discoverMsg}</span>
      )}
    </div>
  )

  if (loading) {
    return (
      <>
        {findMoreHeader}
        <p className="text-ios-body text-label-secondary italic py-2">Loading…</p>
      </>
    )
  }
  if (!recs || recs.length === 0) {
    return (
      <>
        {findMoreHeader}
        <p className="text-ios-body text-label-secondary italic py-2">
          You've added every suggested feed. Try Find more feeds, or the Add tab.
        </p>
      </>
    )
  }
  return (
    <>
      {findMoreHeader}
      <ul>
        {recs.map((r) => (
          <li
            key={r.name}
            className="py-2 text-ios-caption border-b border-hairline last:border-b-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="min-w-0 truncate text-ios-body font-medium text-label-primary">{sourceLabel(r.name)}</span>
              <span className="text-label-tertiary shrink-0 text-[11px]">{categoryLabel(r.category)}</span>
              {r.source === 'llm' && (
                <span className="shrink-0 inline-flex items-center rounded-full bg-accent-soft px-1.5 text-[11px] uppercase tracking-wide text-accent">
                  found for you
                </span>
              )}
              <button
                onClick={() => add(r)}
                disabled={adding === r.name}
                className="ml-auto shrink-0 min-h-[44px] min-w-[44px] rounded-ios bg-accent active:opacity-80 disabled:opacity-40 text-white px-3 text-ios-caption"
                aria-label={`add ${sourceLabel(r.name)}`}
              >
                {adding === r.name ? 'Adding…' : 'Add'}
              </button>
            </div>
            <p className="text-ios-caption text-label-secondary mt-0.5 break-words">{r.blurb}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------------------
// Auto feed — one link in, one source out. Sits above the manual form
// as a shortcut: paste any site's link (not necessarily a feed) and the
// backend finds its real feed, or falls back to checking the page for
// new articles if it has none. YouTube links, @handles and channel IDs
// go to the backend's YouTube branch; a subreddit or an Apple Podcasts
// page fills in the form below instead, since those need its type.
// The source's name comes from the link; rename it afterward from the
// row list like any other source.
// ---------------------------------------------------------------------------

type FeedType = 'rss' | 'reddit' | 'podcast' | 'youtube_channel' | 'generic_scrape'

// An existing spelling of a default category ("Video", "News") is
// reused, so a new feed doesn't start a second column with the same
// label (columns group by the stored string).
function resolveCategory(category: string, sources: Source[]): string {
  const r = resolveNewCategory(category, sources.map((s) => s.category), CATEGORY_OPTIONS, categoryLabel)
  return r.ok ? r.value : category
}

function AutoFeedBlock({
  sources,
  onAdded,
  onPrefill,
}: {
  sources: Source[]
  onAdded: () => Promise<void>
  onPrefill: (type: 'reddit' | 'podcast', url: string) => void
}) {
  const [autoUrl, setAutoUrl] = useState('')
  const [autoSubmitting, setAutoSubmitting] = useState(false)
  // Track-anyway path. ``trackSubmitting`` is true while the
  // generic_scrape POST is in flight. Surfaced as a button next
  // to the "couldn't find a feed" error so the user has a path
  // forward when auto-discovery gives up.
  const [trackSubmitting, setTrackSubmitting] = useState(false)
  const [autoMessage, setAutoMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const trackAnyway = async () => {
    const trimmed = normalizeFeedInput('generic_scrape', autoUrl)
    if (!trimmed) return
    setTrackSubmitting(true)
    try {
      // Mirror the backend's ``_slugify_hostname`` so the name
      // matches what Auto-add would have produced for the same
      // link, then step past names already taken (POST answers 409
      // on a duplicate name).
      const host = (() => {
        try {
          return new URL(trimmed).hostname || 'site'
        } catch {
          return 'site'
        }
      })().toLowerCase().replace(/^www\./, '')
      const base = (host.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'site').slice(0, 100)
      const taken = new Set(sources.map((s) => s.name))
      let name = base
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
      const category = resolveCategory('news', sources)
      await api.createSource({
        name,
        type: 'generic_scrape',
        category,
        url: trimmed,
        refresh_interval_seconds: 7200,
      })
      toast(`Added ${sourceLabel(name)} to ${categoryLabel(category)}. Popping will check the page for new articles.`, 'info')
      setAutoUrl('')
      setAutoMessage(null)
      await onAdded()
    } catch (err) {
      setAutoMessage({ kind: 'err', text: fieldSaveMessage(err, 'url', trimmed, sourceLabel) })
    } finally {
      setTrackSubmitting(false)
    }
  }

  const autoAdd = async () => {
    const trimmed = autoUrl.trim()
    if (!trimmed) {
      setAutoMessage({ kind: 'err', text: 'Paste a link first.' })
      return
    }
    const kind = classifyPaste(trimmed)
    if (kind === 'reddit' || kind === 'podcast') {
      onPrefill(kind, trimmed)
      setAutoUrl('')
      setAutoMessage(null)
      return
    }
    setAutoSubmitting(true)
    setAutoMessage(null)
    try {
      const result =
        kind === 'youtube'
          ? await api.autoAddSource(trimmed, resolveCategory('video', sources))
          : await api.autoAddSource(normalizeFeedInput('rss', trimmed), resolveCategory('other', sources))
      const added = result.found ? result.source : null
      if (added) {
        const label = sourceLabel(added.name)
        if (sources.some((s) => s.id === added.id)) {
          toast(`Already added: ${label}`, 'info')
        } else {
          const note = result.kind === 'generic_scrape' ? '. It has no feed, so Popping will check the page for new articles.' : ''
          toast(`Added ${label} to ${categoryLabel(added.category)}${note}`, 'info')
        }
        setAutoUrl('')
        await onAdded()
      } else {
        setAutoMessage({
          kind: 'err',
          text: "Popping couldn't find a feed or a page list at that address.",
        })
      }
    } catch (err) {
      setAutoMessage({ kind: 'err', text: fieldSaveMessage(err, 'url', trimmed, sourceLabel) })
    } finally {
      setAutoSubmitting(false)
    }
  }

  return (
    <div className="rounded-ios border border-hairline bg-bg-elevated p-3 space-y-2 mb-4">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true">✨</span>
        <span className="text-ios-caption uppercase tracking-wide text-label-tertiary">Auto feed</span>
      </div>
      <p className="text-ios-caption text-label-secondary">
        Paste any site's link. Popping finds its feed, or checks the page for new articles if it has none. YouTube
        links, @handles and channel IDs work too.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="link to add"
          value={autoUrl}
          onChange={(e) => setAutoUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void autoAdd()
            }
          }}
          placeholder="https://example.com"
          disabled={autoSubmitting}
          className="flex-1 min-w-0 min-h-[44px] rounded-ios bg-bg-surface border border-hairline px-3 text-ios-body text-label-primary placeholder:text-label-tertiary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void autoAdd()}
          disabled={autoSubmitting}
          className="shrink-0 min-h-[44px] rounded-ios bg-accent text-white px-3 text-ios-caption font-medium active:opacity-70 disabled:opacity-40"
        >
          {autoSubmitting ? 'Looking…' : 'Auto-add'}
        </button>
      </div>
      {autoMessage && (
        <div className="space-y-2">
          <p className={`text-ios-caption break-words ${autoMessage.kind === 'err' ? 'text-red-300' : 'text-label-secondary'}`}>
            {autoMessage.text}
          </p>
          {autoMessage.kind === 'err' &&
            autoMessage.text.includes("couldn't find a feed") && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => void trackAnyway()}
                  disabled={trackSubmitting || !autoUrl.trim()}
                  className="shrink-0 min-h-[44px] rounded-ios bg-bg-surface border border-hairline px-3 text-ios-caption font-medium text-label-primary active:opacity-70 disabled:opacity-40"
                >
                  {trackSubmitting ? 'Tracking…' : 'Track this URL anyway'}
                </button>
                <span className="text-ios-caption text-label-tertiary">
                  Popping checks the page for new articles instead
                </span>
              </div>
            )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add — the manual form
// ---------------------------------------------------------------------------

// Types whose fetcher sends custom headers; subreddits ignore them.
const HEADER_TYPES: FeedType[] = ['rss', 'podcast', 'youtube_channel', 'generic_scrape']

// A Test whose YouTube lookup worked but whose feed fetch didn't.
const YOUTUBE_FEED_DOWN_KINDS = ['not_found', 'timeout', 'network_error', 'unknown']

type TestOutcome = {
  kind: 'ok' | 'err'
  message: string
  itemCount?: number
  sampleTitles?: string[]
  // The feed the server resolved the link to (a YouTube channel or
  // playlist, an Apple Podcasts show). Add sends it, so the server
  // doesn't look the link up a second time.
  resolvedUrl?: string
}

const fieldClass =
  'w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline px-3 text-ios-body text-label-primary placeholder:text-label-tertiary'
const labelClass = 'block text-ios-caption uppercase tracking-wide text-label-tertiary mb-1'
const radioLabelClass = 'flex items-center gap-2 min-h-[44px] text-ios-body text-label-primary'

function isWebAddress(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function AddCustomTab({
  sources,
  onAdded,
}: {
  sources: Source[]
  onAdded: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('news')
  const [refresh, setRefresh] = useState<number>(3600)
  // Subtype selector — drives the address label, the validation and
  // the request. ``"rss"`` (default) takes a feed URL; ``"reddit"`` a
  // subreddit reference (``r/python`` or a reddit.com/r/python link);
  // ``"podcast"`` a podcast feed or an Apple Podcasts show page;
  // ``"youtube_channel"`` any YouTube link, @handle or channel ID,
  // which the backend resolves to the channel's video feed;
  // ``"generic_scrape"`` a page without a feed.
  const [sourceType, setSourceType] = useState<
    'rss' | 'reddit' | 'podcast' | 'youtube_channel' | 'generic_scrape'
  >('rss')
  // Slice 20: optional discovery hints for generic_scrape sources.
  // ``sitemapUrl`` is a direct sitemap URL (parsed by the plugin
  // instead of asking trafilatura to discover the sitemap from
  // the page). ``linkPattern`` is a path-prefix filter for the
  // page_links fallback (the plugin fetches self.url and extracts
  // <a href> URLs matching this prefix when sitemap discovery
  // returns nothing). Both empty by default; only meaningful when
  // sourceType='generic_scrape' is selected.
  const [sitemapUrl, setSitemapUrl] = useState('')
  const [linkPattern, setLinkPattern] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Test step. ``testResult`` holds the last result so the user can
  // see it until they edit the form again; it clears on any change to
  // the name, address or type so a stale "Looks good" isn't trusted.
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestOutcome | null>(null)
  // Inline validation, shown under each field. The address error
  // waits until the field has been left once, so it doesn't nag
  // while the address is being typed.
  const [urlError, setUrlError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [urlTouched, setUrlTouched] = useState(false)
  // True while the New-category field holds text not yet added. Add
  // waits, or the feed would land in the previous category.
  const [categoryDraft, setCategoryDraft] = useState(false)
  const [headersOpen, setHeadersOpen] = useState(false)
  const [headers, setHeaders] = useState<HeaderMap | null>(null)
  const [headersOk, setHeadersOk] = useState(true)
  // Bumped to start the headers over (after Add, or on Subreddit).
  const [headersKey, setHeadersKey] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  const existingNames = useMemo(() => new Set(sources.map((s) => s.name)), [sources])
  const takesHeaders = HEADER_TYPES.includes(sourceType)
  const headersBlocked = takesHeaders && !headersOk
  const normalized = normalizeFeedInput(sourceType, url)
  const suggested = name.trim() ? null : suggestName(sourceType, normalized, existingNames, testResult?.resolvedUrl)

  const chooseType = (t: FeedType) => {
    setSourceType(t)
    // Picking "Podcast" or "YouTube" bumps the refresh default to 6h
    // (episodes and videos are infrequent; see _PODCAST_DEFAULT_REFRESH
    // and _YOUTUBE_DEFAULT_REFRESH on the backend) unless the user has
    // already changed it from the plain-RSS default. 2h is the
    // backend default for generic_scrape: one poll can mean several
    // page fetches.
    if (t === 'rss') {
      if (refresh === PODCAST_DEFAULT_REFRESH) setRefresh(3600)
    } else if (t === 'reddit') {
      if (refresh === PODCAST_DEFAULT_REFRESH) setRefresh(900)
      setHeaders(null)
      setHeadersOk(true)
      setHeadersOpen(false)
      setHeadersKey((k) => k + 1)
    } else if (t === 'podcast') {
      if (refresh === 3600) setRefresh(PODCAST_DEFAULT_REFRESH)
      if (category === 'news') setCategory(resolveCategory('podcast', sources))
    } else if (t === 'youtube_channel') {
      if (refresh === 3600) setRefresh(YOUTUBE_DEFAULT_REFRESH)
      if (category === 'news') setCategory(resolveCategory('video', sources))
    } else if (t === 'generic_scrape') {
      if (refresh === 3600 || refresh === PODCAST_DEFAULT_REFRESH) setRefresh(7200)
    }
  }

  // Auto feed handed over a subreddit or an Apple Podcasts link.
  const prefill = (t: 'reddit' | 'podcast', link: string) => {
    chooseType(t)
    setUrl(link)
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  // Shared validator for Test and Add. Returns ``null`` on success,
  // the message to show on failure.
  const validateForm = (): string | null => {
    const trimmedUrl = normalizeFeedInput(sourceType, url)
    if (name.trim()) {
      const checked = checkName(name)
      if (!checked.ok) return checked.message
    }
    if (!trimmedUrl) return sourceType === 'reddit' ? 'Type a subreddit, like r/python.' : 'Paste the address first.'
    if (
      sourceType === 'rss' ||
      sourceType === 'podcast' ||
      sourceType === 'youtube_channel' ||
      sourceType === 'generic_scrape'
    ) {
      if (!isWebAddress(trimmedUrl)) {
        return sourceType === 'youtube_channel'
          ? 'Paste a channel link, video link, @handle or channel ID.'
          : 'Use a web address that starts with https://'
      }
    } else if (sourceType === 'reddit') {
      if (trimmedUrl.length < 3) return 'Type a subreddit, like r/python.'
    }
    return null
  }

  // Re-validate on every form change so the Add / Test buttons
  // reflect whether the form is submittable. Errors show under the
  // field (not as a toast): toasts are for confirmations.
  useEffect(() => {
    if (name.trim()) {
      const checked = checkName(name)
      setNameError(checked.ok ? null : checked.message)
    } else {
      setNameError(null)
    }
    const trimmedUrl = normalizeFeedInput(sourceType, url)
    if (!trimmedUrl) {
      setUrlError(null)
    } else if (
      sourceType === 'rss' ||
      sourceType === 'podcast' ||
      sourceType === 'youtube_channel' ||
      sourceType === 'generic_scrape'
    ) {
      try {
        const parsed = new URL(trimmedUrl)
        setUrlError(parsed.protocol === 'http:' || parsed.protocol === 'https:' ? null : 'Use a web address that starts with https://')
      } catch {
        setUrlError(
          sourceType === 'youtube_channel'
            ? 'Paste a channel link, video link, @handle or channel ID.'
            : 'Use a web address that starts with https://',
        )
      }
    } else if (sourceType === 'reddit') {
      setUrlError(trimmedUrl.length < 3 ? 'Type a subreddit, like r/python.' : null)
    } else {
      setUrlError(null)
    }
    // Clear stale test result on any form change so the user
    // doesn't trust the old "Looks good" status after editing.
    setTestResult(null)
  }, [name, url, sourceType])

  // Probe the address with the same plugin Add would use, no DB
  // write. Returns the outcome too, so Add can wait on it.
  const test = async (): Promise<TestOutcome | null> => {
    setUrlTouched(true)
    const err = validateForm()
    if (err) {
      setTestResult({ kind: 'err', message: err })
      return null
    }
    setTesting(true)
    setTestResult(null)
    let outcome: TestOutcome
    try {
      const checked = name.trim() ? checkName(name) : null
      const result = await api.testSource({
        name: checked?.ok ? checked.value : undefined,
        type: sourceType,
        category,
        url: normalizeFeedInput(sourceType, url),
        ...(takesHeaders && headers ? { custom_headers: headers } : {}),
      })
      const resolvedUrl = result.resolved_url ?? undefined
      if (result.ok) {
        const n = result.item_count ?? 0
        outcome = {
          kind: 'ok',
          message: `Looks good: found ${n} recent item${n === 1 ? '' : 's'}.`,
          itemCount: n,
          sampleTitles: result.sample_titles,
          resolvedUrl,
        }
      } else if (sourceType === 'youtube_channel' && resolvedUrl && YOUTUBE_FEED_DOWN_KINDS.includes(result.error_kind ?? 'unknown')) {
        outcome = {
          kind: 'err',
          message: "Found the channel, but YouTube's feed isn't answering right now. You can add it anyway; Popping will keep checking.",
          resolvedUrl,
        }
      } else {
        outcome = { kind: 'err', message: friendlyTestError(result.error_kind, result.error, sourceLabel), resolvedUrl }
      }
    } catch (e) {
      outcome = { kind: 'err', message: fieldSaveMessage(e, 'url', url, sourceLabel) }
    } finally {
      setTesting(false)
    }
    setTestResult(outcome)
    return outcome
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setUrlTouched(true)
    if (categoryDraft || headersBlocked) return
    const err = validateForm()
    if (err) {
      setTestResult({ kind: 'err', message: err })
      return
    }
    setSubmitting(true)
    let sendUrl = normalized
    try {
      let outcome = testResult
      let feedName = name.trim() ? normalizeName(name) : suggested
      if (!feedName) {
        // A YouTube video link or a non-Latin handle: the name comes
        // from the channel, which Test looks up.
        outcome = await test()
        if (!outcome?.resolvedUrl) return
        feedName = suggestName(sourceType, normalized, existingNames, outcome.resolvedUrl)
        if (!feedName) {
          setTestResult({ kind: 'err', message: 'Type a name for this feed.' })
          return
        }
      }
      sendUrl = outcome?.resolvedUrl ?? normalized
      // Slice 20: only send the discovery hints when type='generic_scrape'
      // (other types ignore them server-side). Empty values are left out
      // so the backend leaves the columns NULL (= default discovery).
      const trimmedSitemapUrl = sitemapUrl.trim()
      const trimmedLinkPattern = linkPattern.trim()
      await api.createSource({
        name: feedName,
        type: sourceType,
        category,
        url: sendUrl,
        refresh_interval_seconds: refresh,
        ...(takesHeaders && headers ? { custom_headers: headers } : {}),
        ...(sourceType === 'generic_scrape' && trimmedSitemapUrl
          ? { sitemap_url: trimmedSitemapUrl }
          : {}),
        ...(sourceType === 'generic_scrape' && trimmedLinkPattern
          ? { link_pattern: trimmedLinkPattern }
          : {}),
      })
      toast(`Added ${sourceLabel(feedName)} to ${categoryLabel(category)}`, 'info')
      setName('')
      setUrl('')
      setUrlTouched(false)
      // Slice 20: also clear the discovery hints so the next Add
      // starts with empty inputs.
      setSitemapUrl('')
      setLinkPattern('')
      setHeaders(null)
      setHeadersOk(true)
      setHeadersOpen(false)
      setHeadersKey((k) => k + 1)
      setTestResult(null)
      await onAdded()
    } catch (e) {
      setTestResult({ kind: 'err', message: fieldSaveMessage(e, 'url', sendUrl, sourceLabel) })
    } finally {
      setSubmitting(false)
    }
  }

  const nameHint =
    nameError ??
    (name.trim()
      ? `Will be saved as: ${normalizeName(name)}`
      : suggested
        ? `Will be saved as: ${suggested}`
        : sourceType === 'youtube_channel' && url.trim()
          ? 'Name is chosen after Test.'
          : 'Leave it blank to name the feed after its address.')
  const blocked = !url.trim() || !!(nameError || urlError) || headersBlocked

  return (
    <>
      <AutoFeedBlock sources={sources} onAdded={onAdded} onPrefill={prefill} />
      <form ref={formRef} onSubmit={submit} noValidate className="space-y-4 text-ios-body scroll-mt-4">
      {/* Type first: it decides what the address field takes. Radios
          rather than a dropdown so the choices are visible at once. */}
      <fieldset>
        <legend className={labelClass}>Type</legend>
        <div className="flex flex-wrap gap-x-4">
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="fm-type"
              value="rss"
              checked={sourceType === 'rss'}
              onChange={() => chooseType('rss')}
              className="accent-accent w-5 h-5"
            />
            RSS / Atom
          </label>
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="fm-type"
              value="reddit"
              checked={sourceType === 'reddit'}
              onChange={() => chooseType('reddit')}
              className="accent-accent w-5 h-5"
            />
            Subreddit
          </label>
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="fm-type"
              value="podcast"
              checked={sourceType === 'podcast'}
              onChange={() => chooseType('podcast')}
              className="accent-accent w-5 h-5"
            />
            Podcast
          </label>
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="fm-type"
              value="youtube_channel"
              checked={sourceType === 'youtube_channel'}
              onChange={() => chooseType('youtube_channel')}
              className="accent-accent w-5 h-5"
            />
            YouTube
          </label>
          <label
            className={radioLabelClass}
            title="For sites without an RSS feed: Popping checks the page for new articles."
          >
            <input
              type="radio"
              name="fm-type"
              value="generic_scrape"
              checked={sourceType === 'generic_scrape'}
              onChange={() => chooseType('generic_scrape')}
              className="accent-accent w-5 h-5"
            />
            Track page (no RSS)
          </label>
        </div>
      </fieldset>
      <div>
        <label className={labelClass} htmlFor="fm-url">
          {sourceType === 'reddit'
            ? 'Subreddit'
            : sourceType === 'podcast'
              ? 'Podcast RSS URL'
              : sourceType === 'youtube_channel'
                ? 'YouTube channel link or channel ID'
                : sourceType === 'generic_scrape'
                  ? 'Page URL (no RSS — will be scraped)'
                  : 'RSS / Atom URL'}
        </label>
        <input
          id="fm-url"
          type={sourceType === 'reddit' ? 'text' : 'url'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setUrlTouched(true)}
          placeholder={
            sourceType === 'reddit'
              ? 'r/python or https://www.reddit.com/r/python'
              : sourceType === 'podcast'
                ? 'https://example.com/podcast/feed.xml'
                : sourceType === 'youtube_channel'
                  ? '@handle or https://www.youtube.com/@handle'
                  : sourceType === 'generic_scrape'
                    ? 'https://example.com'
                    : 'https://example.com/feed.xml'
          }
          className={fieldClass}
        />
        {sourceType === 'youtube_channel' && (
          <p className="text-ios-caption text-label-secondary mt-1">
            A channel link, video link, @handle or channel ID (starts with UC)
          </p>
        )}
        {urlTouched && urlError && <p className="text-ios-caption text-red-300 mt-1 break-words">{urlError}</p>}
      </div>
      <div>
        <label className={labelClass} htmlFor="fm-name">Name (optional)</label>
        <input
          id="fm-name"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my_blog"
          className={fieldClass}
        />
        <p className={`text-ios-caption mt-1 break-words ${nameError ? 'text-red-300' : 'text-label-secondary'}`}>
          {nameHint}
        </p>
      </div>
      {/* Slice 20: discovery hints for ``type='generic_scrape'`` sources.
          Two optional inputs that let the user bypass the homepage-based
          sitemap discovery (sitemapUrl) or fall through to page_links
          (linkPattern) without having to PATCH the row after creating.
          Only shown for type=generic_scrape; other types ignore them
          server-side. */}
      {sourceType === 'generic_scrape' && (
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="fm-sitemap-url">
              Sitemap address (optional)
            </label>
            <input
              id="fm-sitemap-url"
              type="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={sitemapUrl}
              onChange={(e) => setSitemapUrl(e.target.value)}
              placeholder="https://example.com/sitemap-news.xml"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="fm-link-pattern">
              Only links starting with (optional)
            </label>
            <input
              id="fm-link-pattern"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={linkPattern}
              onChange={(e) => setLinkPattern(e.target.value)}
              placeholder="/library/"
              className={fieldClass}
            />
          </div>
        </div>
      )}
      <div>
        <label className={labelClass} htmlFor="fm-category">Category</label>
        <CategoryPicker
          inputId="fm-category"
          value={category}
          sources={sources}
          onChange={setCategory}
          defaultInSuggestions
          onDraftChange={setCategoryDraft}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="fm-refresh">Check for new items</label>
        <select
          id="fm-refresh"
          value={refresh}
          onChange={(e) => setRefresh(Number(e.target.value))}
          className="select-ios w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline pl-3 pr-8 text-ios-body text-label-primary"
        >
          {!REFRESH_PRESETS.some((p) => p.value === refresh) && (
            <option value={refresh}>every {refreshLabel(refresh)}</option>
          )}
          {REFRESH_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>every {p.label}</option>
          ))}
        </select>
      </div>
      {takesHeaders && (
        <div className="space-y-3">
          <button
            type="button"
            aria-expanded={headersOpen}
            aria-controls="fm-headers"
            onClick={() => setHeadersOpen((open) => !open)}
            className="w-full min-h-[44px] flex items-center justify-between gap-2 rounded-ios border border-hairline px-3 py-2 text-left active:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-ios-body text-label-primary">Advanced</span>
              <span className="block text-ios-caption text-label-secondary">Headers for sites that block readers</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-label-tertiary">{headersOpen ? '▴' : '▾'}</span>
          </button>
          {/* Kept mounted while closed, so typed rows survive. */}
          <div id="fm-headers" hidden={!headersOpen}>
            <HeadersEditor
              key={headersKey}
              mode="local"
              value={null}
              onCommit={setHeaders}
              onValidChange={setHeadersOk}
              disabled={submitting}
            />
          </div>
          {headersBlocked && !headersOpen && (
            <p className="text-ios-caption text-red-300">Fix the headers under Advanced, or remove them.</p>
          )}
        </div>
      )}
      {/* Test result inline. ``data-test-result`` is the hook the
          flows in scripts/iphone-audit assert on. Add failures land
          here too, so they show inside the sheet. */}
      {testResult && (
        <div
          data-test-result={testResult.kind}
          role="status"
          className={`rounded-ios p-3 text-ios-body break-words ${
            testResult.kind === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'
              : 'bg-red-500/15 border border-red-500/40 text-red-200'
          }`}
        >
          <div className="font-medium">
            {testResult.kind === 'ok' ? '✓ ' : '✗ '}
            {testResult.message}
          </div>
          {testResult.resolvedUrl && (
            <div className="mt-1 text-ios-caption opacity-80 break-all">
              Feed address: {testResult.resolvedUrl}
            </div>
          )}
          {testResult.kind === 'ok' && testResult.sampleTitles && testResult.sampleTitles.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-ios-caption text-emerald-200/80">
              {testResult.sampleTitles.map((t, i) => (
                <li key={i} className="truncate">· {t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Test (outlined) and Add (filled, the default action). Both
          wait while a request is in flight. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || submitting || blocked}
          className="flex-1 min-h-[44px] rounded-ios border border-accent text-accent active:opacity-60 disabled:opacity-40"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button
          type="submit"
          disabled={submitting || testing || blocked || categoryDraft}
          className="flex-1 min-h-[44px] rounded-ios bg-accent active:opacity-80 disabled:opacity-40 text-white"
        >
          {submitting ? 'Adding…' : 'Add feed'}
        </button>
      </div>
      {categoryDraft && (
        <p className="text-ios-caption text-label-secondary">Finish or cancel the new category.</p>
      )}
      </form>
    </>
  )
}
