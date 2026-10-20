/// <reference types="vite/client" />
// Moving a running page onto a new build (PR1r, D22).
//
// index.html is served no-cache and the bundle under /static/ as
// immutable, with no service worker, so only a cold launch loads a new
// build. A home-screen app on an iPhone is resumed for days instead, so
// this asks the server which build it serves whenever the user comes
// back after RETURN_CHECK_MS or more away:
// - Time away is measured with Date.now: timers stop while iOS
//   suspends the page.
// - The builds are compared by id (buildId.ts), so a revert counts too.
// - The desktop never reloads by itself; it gets a "New version ·
//   Reload" button instead (``ready``).
// The phone reloads onto the new build, unless:
// - the page hid within OPEN_GUARD_MS of opening a story, so that
//   story's card is still there for ▲ or Save;
// - the user touches it or presses a key first: the page never reloads
//   under someone who is already using it;
// - a sheet (the Menu, Settings) is open or a text field holds text;
// - the new entry script isn't served (the reload would land on a
//   broken page);
// - the pending writes didn't all get through within FLUSH_CAP_MS;
// - it already reloaded once for this build id (sessionStorage), so a
//   server that keeps naming a build the reload doesn't land on can't
//   loop.
// Any of these leaves it for the next return. Only in a production
// build: the dev server has no build id.

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildIdFromHtml, buildIdFromUrls, entryScriptFromHtml } from './buildId'
import { flushNow as flushInteractions, lastStoryOpenAt } from './interactions'
import { usePreferences } from './preferences'
import { whenAllIdle as feedSavesIdle } from './sourceSaves'
import { toast } from '../components/Toast'

export const RETURN_CHECK_MS = 10 * 60_000
const OPEN_GUARD_MS = 2_000
const FLUSH_CAP_MS = 3_000
// A request that hangs (a dead connection after a resume) gives up, so
// the next return can check again.
const FETCH_TIMEOUT_MS = 10_000
// sessionStorage: the build id this tab last reloaded for.
const RELOADED_FOR_KEY = 'popping.v1.reloadedFor'

/** The running page's build id, from the module scripts and
 *  stylesheets it loaded. '' under the dev server. */
export function liveBuildId(): string {
  const urls: string[] = []
  document.querySelectorAll('script[type="module"][src]').forEach((el) => urls.push(el.getAttribute('src') || ''))
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((el) => urls.push(el.getAttribute('href') || ''))
  return buildIdFromUrls(urls)
}

function reloadedFor(): string | null {
  try {
    return window.sessionStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    return null
  }
}

// False when the guard can't be stored: without it a reload could loop,
// so the reload doesn't happen.
function rememberReload(id: string): boolean {
  try {
    window.sessionStorage.setItem(RELOADED_FOR_KEY, id)
    return window.sessionStorage.getItem(RELOADED_FOR_KEY) === id
  } catch {
    return false
  }
}

// A sheet is open (the Menu stays mounted, inert, while closed), or a
// text field holds text: a reload would close it or drop what was typed.
function pageBusy(): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]:not([inert])')) return true
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], textarea',
  )
  return Array.from(fields).some((el) => el.value.trim() !== '')
}

// One request and reading its answer, given up on (rejected) after
// FETCH_TIMEOUT_MS.
async function fetchWithin<T>(url: string, init: RequestInit, read: (res: Response) => Promise<T> | T): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
    return await read(res)
  } finally {
    clearTimeout(timer)
  }
}

type Served = { id: string; entry: string }

// The build the server serves now, or null when it can't be told (offline,
// an error page, an index.html without an entry script under /static/).
async function servedBuild(): Promise<Served | null> {
  try {
    const html = await fetchWithin('/', {}, (res) => (res.ok ? res.text() : null))
    if (html == null) return null
    const id = buildIdFromHtml(html)
    const entry = entryScriptFromHtml(html)
    return id && entry ? { id, entry } : null
  } catch {
    return null
  }
}

// The new entry script is served, as JavaScript. (vite preview answers an
// unknown path with index.html and a 200, hence the type.)
async function entryServed(entry: string): Promise<boolean> {
  try {
    return await fetchWithin(
      entry,
      { method: 'HEAD' },
      (res) => res.status === 200 && /javascript|ecmascript/i.test(res.headers.get('content-type') || ''),
    )
  } catch {
    return false
  }
}

// Pending preference writes, queued engagement events and feed saves.
// True when the preference writes were all saved within FLUSH_CAP_MS
// (engagement events are advisory; feed saves report their own errors).
async function flushWrites(flushPrefs: () => Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), FLUSH_CAP_MS)
  })
  const done = Promise.all([flushPrefs(), flushInteractions(), feedSavesIdle()]).then(
    ([prefsSaved]) => prefsSaved,
    () => false,
  )
  const saved = await Promise.race([done, cap])
  clearTimeout(timer)
  return saved
}

export type UpdateCheck = {
  /** Desktop only: the server serves a newer build than this page. */
  ready: boolean
  /** Desktop's Reload button: flush, then reload onto it. */
  reload: () => void
}

export function useUpdateCheck(isDesktop: boolean): UpdateCheck {
  const { flushPending } = usePreferences()
  const [ready, setReady] = useState(false)
  const desktopRef = useRef(isDesktop)
  desktopRef.current = isDesktop
  const flushRef = useRef(flushPending)
  flushRef.current = flushPending
  // The build the desktop button reloads onto.
  const nextRef = useRef<Served | null>(null)
  const reloadingRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    let hiddenAt: number | null = null
    // Bumped by every hide and every input, so a check under way can
    // tell that it has to give up.
    let epoch = 0
    let checking = false

    const check = async () => {
      const mine = epoch
      const stale = () => epoch !== mine
      const live = liveBuildId()
      if (!live) return
      const next = await servedBuild()
      if (!next) return
      if (next.id === live) {
        nextRef.current = null
        setReady(false)
        return
      }
      if (reloadedFor() === next.id) return
      if (desktopRef.current) {
        nextRef.current = next
        setReady(true)
        return
      }
      if (stale() || pageBusy()) return
      if (!(await entryServed(next.entry)) || stale()) return
      const saved = await flushWrites(flushRef.current)
      if (!saved || stale() || pageBusy() || !rememberReload(next.id)) return
      window.location.reload()
    }

    const onHidden = () => {
      epoch++
      if (hiddenAt == null) hiddenAt = Date.now()
    }
    const onShown = () => {
      if (hiddenAt == null) return
      const away = Date.now() - hiddenAt
      // The desktop opens stories in another tab and never reloads by
      // itself, so the guard is the phone's.
      const justOpened = !desktopRef.current && hiddenAt - lastStoryOpenAt() <= OPEN_GUARD_MS
      hiddenAt = null
      if (away < RETURN_CHECK_MS || justOpened || checking) return
      checking = true
      void check().finally(() => {
        checking = false
      })
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? onHidden() : onShown())
    // Back from the back-forward cache: the gap runs from pagehide.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onShown()
    }
    const onInput = () => {
      epoch++
    }
    const inputs = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHidden)
    window.addEventListener('pageshow', onPageShow)
    for (const t of inputs) window.addEventListener(t, onInput, { capture: true, passive: true })
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHidden)
      window.removeEventListener('pageshow', onPageShow)
      for (const t of inputs) window.removeEventListener(t, onInput, { capture: true })
    }
  }, [])

  const reload = useCallback(() => {
    const next = nextRef.current
    if (!next || reloadingRef.current) return
    reloadingRef.current = true
    void (async () => {
      try {
        // The server stopped serving it: the button goes, and the next
        // return checks again.
        if (!(await entryServed(next.entry))) {
          nextRef.current = null
          setReady(false)
          return
        }
        if (!(await flushWrites(flushRef.current))) {
          toast("Couldn't save your latest changes yet. Try Reload again.", 'error')
          return
        }
        rememberReload(next.id)
        window.location.reload()
      } finally {
        reloadingRef.current = false
      }
    })()
  }, [])

  return { ready, reload }
}
