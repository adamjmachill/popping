// The Menu: the panel behind the one top-bar button (≡).
//
// On every viewport it is a right-side panel that slides in from the
// right edge: 88vw (max 420px) on phones, a 360px sidebar on desktop.
// Anchoring it to the right puts it under the ≡ button, so the panel
// grows from beneath the tap target.
//
// Swipe to dismiss on phones: a mostly sideways drag of more than
// 100px either way closes it (rightward is the way it slides out).
//
// The body is iOS-style grouped sections:
//
//   1. (no label)        — Settings, and Save current view
//   2. JUMP TO COLUMN    — by-category navigation
//   3. SOURCES           — the multi-select filter; each row's › opens
//                          that feed in Settings
//
// Rows are at least 44px tall, the iOS HIG minimum tap target. While
// closed the panel is inert, so Tab never lands in it.

import { useEffect, useRef } from 'react'
import type { Source } from '../api'
import { SourceIcon } from './SourceIcon'
import { categoryLabel, sourceLabel } from '../lib/labels'
import type { SettingsTab } from './Settings'

type Props = {
  open: boolean
  onClose: () => void
  categories: string[]
  // Source list, owned by App (the same fetch that already feeds
  // FeedManager/Settings — see App.tsx's `refresh()`). The Drawer
  // used to fetch its own copy on every open, which meant an extra
  // network round-trip every time plus a staleness window against
  // whatever Settings/FeedManager had just changed. Passed as a
  // prop instead, same pattern as <Settings sources={sources} />.
  sources: Source[]
  // Re-run App's own source fetch. Wired to the "Couldn't load
  // sources" retry row below, same as FeedManager's onRefresh.
  onRefreshSources?: () => Promise<void>
  // Active source filter (multi-select). Empty set = no filter.
  activeSources: Set<string>
  onSourceToggle: (name: string) => void
  // Wipe the active filter set in one call. Wired to the "Filtering:
  // …" header's clear-all button so the user doesn't have to untick
  // each row individually.
  onClearAllFilters?: () => void
  // "Scroll to column" support. The Drawer's category list calls
  // back with the category name; App owns the column refs and
  // scrolls the right one into view.
  onCategoryJump?: (category: string) => void
  // Open the Settings overlay (the Settings row).
  onOpenSettings?: (tab?: SettingsTab) => void
  // Open one feed in Settings → Feeds (each source row's ›).
  onEditSource?: (id: number) => void
  // Save the current source filter + column prefs as a
  // named preset. The Drawer collects the name via a
  // native prompt and calls the callback with the
  // trimmed name. Caller is responsible for actually
  // writing the preset to localStorage.
  onSavePreset?: () => void
}


export function Drawer({
  open,
  onClose,
  categories,
  sources,
  onRefreshSources,
  activeSources,
  onSourceToggle,
  onClearAllFilters,
  onCategoryJump,
  onOpenSettings,
  onEditSource,
  // App wires this to ``savePreset`` and a name prompt, and toasts
  // the new preset's name.
  onSavePreset,
}: Props) {
  // Set by a row that hands over to Settings, which takes focus
  // itself; otherwise closing returns focus to the ≡ button.
  const handingOff = useRef(false)

  // Esc dismisses the drawer. Mirrors the iOS sheet pattern where
  // the swipe-down and back-tap gestural dismiss are also Esc on a
  // keyboard. ``capture: true`` so the handler fires before any
  // inner element's keydown (e.g. a focused input's "submit on
  // Enter" listener). Stops the event so the App-level keyboard
  // effect doesn't also see Esc and fire its global close logic.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // Swipe to dismiss on phones: a touch anywhere in the panel that
  // drags mostly sideways, more than 100px either way, closes it.
  // Rightward is the direction the right-anchored panel slides out;
  // leftward is kept for those used to it. Set up via
  // addEventListener (not JSX onTouch*) so touchmove can be
  // ``{ passive: false }`` and call ``preventDefault`` — without it
  // the page scrolls underneath mid-gesture. Mostly vertical drags
  // are left alone, so the list still scrolls.
  const SWIPE_DISMISS_PX = 100
  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return

    let startX = 0
    let startY = 0
    let armed = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      armed = true
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!armed) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        // A sideways drag: keep the page from scrolling underneath.
        e.preventDefault()
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!armed) return
      armed = false
      // ``changedTouches`` (not ``touches``) because the gesture
      // ended and the finger is no longer on screen.
      const touch = e.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (Math.abs(dx) > SWIPE_DISMISS_PX && Math.abs(dx) > Math.abs(dy)) onClose()
    }
    const onTouchCancel = () => {
      armed = false
    }
    drawer.addEventListener('touchstart', onTouchStart, { passive: true })
    drawer.addEventListener('touchmove', onTouchMove, { passive: false })
    drawer.addEventListener('touchend', onTouchEnd, { passive: true })
    drawer.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      drawer.removeEventListener('touchstart', onTouchStart)
      drawer.removeEventListener('touchmove', onTouchMove)
      drawer.removeEventListener('touchend', onTouchEnd)
      drawer.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [open, onClose])

  // Focus trap. Move focus into the drawer on open and cycle it
  // between the first and last tabbable elements so Tab can't
  // escape into the dashboard behind the backdrop. Without this,
  // a keyboard-only user can Tab past the drawer's Done button
  // into the dashboard's hidden-but-still-tabbable columns.
  // The trap is opt-out for screen-reader users (the dialog's
  // aria-modal already announces modality to AT; the visual
  // focus ring still follows their focus).
  const drawerRef = useRef<HTMLElement | null>(null)
  const firstFocusableRef = useRef<HTMLElement | null>(null)

  // Closed: inert and hidden from assistive tech (React 18 has no
  // ``inert`` prop). Closing returns focus to the ≡ button unless a
  // row is handing over to Settings.
  const wasOpen = useRef(open)
  useEffect(() => {
    const el = drawerRef.current
    if (el) {
      el.toggleAttribute('inert', !open)
      if (open) el.removeAttribute('aria-hidden')
      else el.setAttribute('aria-hidden', 'true')
    }
    if (wasOpen.current && !open && !handingOff.current) {
      document.querySelector<HTMLElement>('button[aria-label="open menu"]')?.focus()
    }
    handingOff.current = false
    wasOpen.current = open
  }, [open])
  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return

    // Defer to next frame so the slide-up animation hasn't
    // started yet — focusing inside a 0-opacity panel reads as
    // a no-op to assistive tech.
    const id = window.requestAnimationFrame(() => {
      firstFocusableRef.current?.focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    drawer.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(id)
      drawer.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      {/* Backdrop. Same backdrop-blur treatment on both breakpoints;
          the only difference is the opacity — slightly heavier on
          mobile so the sheet reads as a clearly separate surface,
          lighter on desktop where the panel is a sidebar, not a
          takeover. z-30 sits above the header (z-20) but below the
          sheet chrome (z-40). */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-black/60 md:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm motion-safe:transition-opacity motion-safe:duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* A panel anchored to the right edge on every width: 88vw (max
          420px) on phones, 360px on desktop. It slides in from the
          right with a transform; the same classes serve both widths. */}
      <aside
        ref={(el) => {
          drawerRef.current = el
          // Initial focus goes to the Done button, found by its label
          // rather than by position (it sits after the title in the
          // header), so focus never starts on a row that may not
          // exist on first render.
          firstFocusableRef.current = el?.querySelector<HTMLElement>(
            'button[aria-label="close menu"]',
          ) ?? null
        }}
        role="dialog"
        aria-modal="true"
        aria-label="menu"
        // ``touch-pan-y`` matches the swipe-left dismiss handler
        // below: horizontal pans are handled in JS (the dismiss
        // gesture), vertical scrolling of the drawer body stays
        // native. Without it a mostly-horizontal touch can be
        // claimed by the browser for scrolling an ancestor before
        // the JS preventDefault engages.
        className={`fixed z-40 bg-bg-app shadow-2xl flex flex-col touch-pan-y-zoom
                    inset-y-0 right-0 top-0 left-auto h-full w-[88vw] max-w-[420px] rounded-l-ios-lg
                    pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]
                    md:w-[360px] md:rounded-none
                    motion-safe:transition-transform motion-safe:duration-300 ease-out
                    ${open
                      ? 'translate-x-0'
                      : 'translate-x-full'
                    }`}
      >
        {/* Vertical grabber on phones — the small line at the top-left
            of the panel, the iOS side-sheet affordance that says "swipe
            to dismiss". Below the status bar on notched phones.
            ``md:hidden``: the desktop sidebar has a visible edge. */}
        <div
          aria-hidden="true"
          className="md:hidden absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-2 h-10 w-1 rounded-full bg-label-tertiary"
        />
        {/* Header row — iOS sheet layout: title "Menu" on the leading
            edge, Done on the trailing edge, with the standard hairline
            under it. ``pl-10 md:pl-0`` on the title leaves room for the
            vertical grabber on phones. */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-3 md:pt-5 md:pb-4 border-b border-hairline shrink-0">
          <h2 className="min-w-0 flex-1 truncate pl-10 md:pl-0 text-2xl md:text-ios-large-title font-bold text-label-primary tracking-tight">
            Menu
          </h2>
          <button
            onClick={onClose}
            aria-label="close menu"
            className="shrink-0 min-h-[44px] min-w-[44px] px-2 flex items-center justify-center rounded-ios text-ios-body font-semibold text-accent active:bg-bg-elevated"
          >
            Done
          </button>
        </div>

        {/* Body. ``min-h-0`` lets the nav actually shrink below its
            content height — without it, ``overflow-y-auto`` is a
            no-op because the flex item refuses to be smaller than
            its contents and the parent grows to fit (overflowing
            the viewport). ``p-4`` matches iOS grouped-list left/
            right margins. Background ``bg-bg-app`` keeps the section
            gaps from showing the sheet's underlying surface. */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-bg-app pb-8">
          <GroupedSection>
            <GroupedRow
              onClick={() => {
                handingOff.current = true
                onOpenSettings?.('feeds')
                onClose()
              }}
              title="Settings"
              subtitle="Feeds, AI, history, saved"
              showChevron
            />
            {/* Saves the current source filter and column settings as
                a named view; its chip appears above the dashboard. */}
            {onSavePreset && (
              <GroupedRow
                onClick={() => {
                  onSavePreset()
                  onClose()
                }}
                title="Save current view"
                subtitle="keep this layout to come back to"
                showChevron
              />
            )}
          </GroupedSection>

          {categories.length > 0 && (
            <GroupedSection label="Jump to column">
              {categories.map((c) => (
                // Each category is its own row. Tap → close drawer
                // and scroll the desktop grid to that column.
                <GroupedRow
                  key={c}
                  title={categoryLabel(c)}
                  onClick={() => {
                    onCategoryJump?.(c)
                    onClose()
                  }}
                  showChevron
                />
              ))}
            </GroupedSection>
          )}

          <GroupedSection
            label="Sources"
            footnote={
              activeSources.size > 0
                ? `Showing only: ${Array.from(activeSources).map(sourceLabel).join(', ')}`
                : undefined
            }
            action={
              activeSources.size > 0 && onClearAllFilters ? (
                <button
                  onClick={onClearAllFilters}
                  aria-label="clear all source filters"
                  className="min-h-[44px] px-2 -mr-2 text-ios-body text-accent active:opacity-60"
                >
                  Clear
                </button>
              ) : undefined
            }
          >
            {sources.length === 0 ? (
              onRefreshSources ? (
                <GroupedRow
                  onClick={() => { void onRefreshSources() }}
                  title="No sources loaded"
                  subtitle="Tap to try again"
                />
              ) : (
                <p className="px-4 py-3 text-ios-body text-label-secondary">
                  No feeds yet.
                </p>
              )
            ) : (
              // A checkbox list: each row's label toggles the filter, the
              // same multi-select as the chip bar in the header. App's
              // ``toggleSourceAndMaybeClose`` closes the Menu on the
              // first pick so the filtered dashboard shows; later taps
              // keep it open. The › beside each row is a separate
              // button (not inside the label), so it never toggles the
              // filter: it opens that feed in Settings.
              <>
                {sources.map((s) => {
                  const active = activeSources.has(s.name)
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center border-b border-hairline last:border-b-0 ${active ? 'bg-bg-elevated' : ''}`}
                    >
                      <label
                        className={`flex flex-1 min-w-0 items-center gap-3 pl-4 ${onEditSource ? '' : 'pr-4'} min-h-[44px] cursor-pointer transition ${
                          active ? '' : 'active:bg-bg-elevated'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => onSourceToggle(s.name)}
                          className="shrink-0 h-4 w-4 accent-accent"
                          aria-label={`filter by ${sourceLabel(s.name)}`}
                        />
                        {/* SourceIcon. Falls back to a colored letter
                            when the favicon hasn't been fetched yet. */}
                        <SourceIcon src={s.favicon_path} name={s.name} size={18} />
                        <span className="flex-1 min-w-0 truncate text-ios-body text-label-primary">
                          {sourceLabel(s.name)}
                        </span>
                        {/* Desktop only: on phones the panel is too narrow
                            for a name, a category and the › side by side,
                            and the name matters more for picking. */}
                        <span className="hidden md:inline shrink min-w-0 max-w-[40%] truncate text-ios-caption text-label-tertiary">
                          {categoryLabel(s.category)}
                        </span>
                      </label>
                      {onEditSource && (
                        <button
                          type="button"
                          aria-label={`edit ${sourceLabel(s.name)}`}
                          onClick={() => {
                            handingOff.current = true
                            onEditSource(s.id)
                            onClose()
                          }}
                          className="w-11 h-11 shrink-0 flex items-center justify-center text-label-tertiary active:bg-bg-elevated"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </GroupedSection>

        </nav>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// iOS grouped-list primitives
// ---------------------------------------------------------------------------

// Section. The iOS convention is to render an uppercase label in
// ``text-label-tertiary`` above a rounded card of rows (the first
// section has none). The label has
// generous left/right padding (``px-4``) and a small bottom margin.
// The card is a single rounded ``bg-bg-surface`` block; rows inside
// are separated by ``border-hairline`` so dividers extend to the
// edges of the card (not full bleed). ``footnote`` sits below the
// card in ``text-ios-caption text-label-secondary`` — useful for
// explanatory copy (e.g. "filtering: reuters, hackernews").
//
// ``action`` (e.g. a "Clear" button) renders on the right side of
// the label row, like the "Edit" button next to the "Reminders"
// header in iOS Settings.
function GroupedSection({
  label,
  footnote,
  action,
  children,
}: {
  label?: string
  footnote?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mt-6 first:mt-2">
      {(label || action) && (
        <div className="flex items-end justify-between px-4 mb-2">
          {label && (
            <h3 className="text-ios-caption uppercase tracking-wide text-label-tertiary">
              {label}
            </h3>
          )}
          {action}
        </div>
      )}
      {/* The rows go inside a single rounded card so the iOS grouped-
          list visual works: rounded card on the page, hairline
          dividers between rows, no outside border. ``overflow-hidden``
          keeps the first/last row from poking past the card corners. */}
      <div className="mx-4 rounded-ios bg-bg-surface overflow-hidden">
        {children}
      </div>
      {footnote && (
        <p className="px-4 mt-2 text-ios-caption text-label-secondary">
          {footnote}
        </p>
      )}
    </div>
  )
}

// Single iOS-style row. ``title`` is the primary text, ``subtitle``
// is the secondary line beneath it (font-300, ``label-secondary``).
// Renders as a 44px-tall button when ``onClick`` is set — the entire
// row is the tap target. When used as a static display (no
// ``onClick``) it falls back to a non-button ``<div>``.
//
// ``tone`` recolors the chevron-area / title when there's a state to
// surface (success / warning / destructive) — iOS uses these for
// health-check rows in Settings → Battery, for example.
function GroupedRow({
  title,
  subtitle,
  onClick,
  showChevron,
  tone,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClick?: () => void
  showChevron?: boolean
  tone?: 'success' | 'warning' | 'destructive'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-400'
      : tone === 'warning'
      ? 'text-amber-400'
      : tone === 'destructive'
      ? 'text-red-400'
      : 'text-label-primary'
  const content = (
    <>
      <div className="flex-1 min-w-0">
        <div className={`text-ios-body ${toneClass} truncate`}>{title}</div>
        {subtitle && (
          <div className="text-ios-caption text-label-secondary truncate">
            {subtitle}
          </div>
        )}
      </div>
      {showChevron && (
        <ChevronRight className="shrink-0 w-4 h-4 text-label-tertiary" />
      )}
    </>
  )
  const baseClass =
    'flex items-center gap-3 px-4 min-h-[44px] border-b border-hairline last:border-b-0'
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} w-full text-left active:bg-bg-elevated`}
      >
        {content}
      </button>
    )
  }
  return <div className={baseClass}>{content}</div>
}

// iOS chevron — used for navigation rows. Right-pointing, single 1.5
// stroke. Pulled inline (rather than into an icon library) because
// the Drawer is the only consumer.
function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}



