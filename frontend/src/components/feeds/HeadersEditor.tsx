// Request headers as rows instead of JSON (REDESIGN_PLAN.md section 8).
// The rules live in lib/headers.ts and mirror the backend's.
//
// This is the `local` mode the Add form uses: every change reports the
// map to send and whether it can be sent. The feed editor's autosave
// mode arrives with PR6.

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  HEADERS_MAX,
  HEADER_PRESETS,
  blocksSave,
  checkRows,
  rowsToMap,
  type HeaderMap,
  type HeaderRow,
} from '../../lib/headers'

// Keeps focus in a header field when a button in the group is tapped,
// so no early blur fires (WebKit doesn't focus buttons on tap).
const keepFocus = (e: React.SyntheticEvent) => e.preventDefault()

const fieldClass =
  'w-full min-w-0 min-h-[44px] rounded-ios bg-bg-elevated border border-hairline px-3 text-ios-body text-label-primary placeholder:text-label-tertiary disabled:opacity-50'

export function HeadersEditor({
  value,
  onCommit,
  onValidChange,
  disabled,
}: {
  mode: 'local'
  // The rows to start from.
  value: HeaderMap | null
  // Called with the map to send (null for none) whenever it changes.
  onCommit: (map: HeaderMap | null) => void
  // False while any row is half-filled or breaks a rule, so the form
  // can hold Test and Add until it is fixed.
  onValidChange?: (ok: boolean) => void
  disabled?: boolean
}) {
  const nextKey = useRef(0)
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    Object.entries(value ?? {}).map(([name, v]) => ({ key: nextKey.current++, name, value: v })),
  )
  // "Fill in both" waits until focus has left the headers.
  const [focusInside, setFocusInside] = useState(false)
  const nameInputs = useRef(new Map<number, HTMLInputElement>())

  const check = checkRows(rows)
  const ok = !blocksSave(check) && check.problems.length === 0
  const map = ok ? rowsToMap(rows, null) : null
  const mapKey = JSON.stringify(map)

  useEffect(() => {
    onValidChange?.(ok)
  }, [ok, onValidChange])
  // Keyed on the map's JSON, so a re-render with the same rows reports
  // nothing new.
  useEffect(() => {
    onCommit(JSON.parse(mapKey) as HeaderMap | null)
  }, [mapKey, onCommit])

  const update = (key: number, patch: Partial<HeaderRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addRow = (name = '', v = '') => {
    const key = nextKey.current++
    // Focus inside the same tap, or iOS won't raise the keyboard.
    flushSync(() => setRows((prev) => [...prev, { key, name, value: v }]))
    if (!name) nameInputs.current.get(key)?.focus()
  }

  const has = (name: string) => rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())
  const filled = rows.filter((r) => r.name.trim() || r.value.trim()).length

  return (
    <div
      className="space-y-3"
      onFocus={() => setFocusInside(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false)
      }}
    >
      {rows.map((row) => {
        const problem = check.problems.find((p) => p.key === row.key)
        const showProblem = problem && (!problem.incomplete || !focusInside)
        return (
          <div key={row.key} className="space-y-1">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                ref={(el) => {
                  if (el) nameInputs.current.set(row.key, el)
                  else nameInputs.current.delete(row.key)
                }}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="Header name"
                aria-label="header name"
                value={row.name}
                disabled={disabled}
                onChange={(e) => update(row.key, { name: e.target.value })}
                className={fieldClass}
              />
              <button
                type="button"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                disabled={disabled}
                aria-label={`remove header ${row.name.trim() || 'row'}`}
                className="w-11 h-11 flex items-center justify-center rounded-ios text-red-300 active:opacity-60 disabled:opacity-40"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12h8" />
                </svg>
              </button>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="Value"
                aria-label={`value for ${row.name.trim() || 'header'}`}
                value={row.value}
                disabled={disabled}
                onChange={(e) => update(row.key, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
                className={`${fieldClass} col-span-2`}
              />
            </div>
            {showProblem && <p className="text-ios-caption text-red-300 break-words">{problem.message}</p>}
          </div>
        )
      })}
      {check.tooMany && <p className="text-ios-caption text-red-300">{check.tooMany}</p>}
      <div className="flex flex-wrap gap-2">
        {filled < HEADERS_MAX && (
          <button
            type="button"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => addRow()}
            disabled={disabled}
            className="min-h-[44px] px-3 rounded-ios border border-hairline text-accent text-ios-body active:opacity-60 disabled:opacity-40"
          >
            Add header
          </button>
        )}
        {HEADER_PRESETS.filter((p) => !has(p.name)).map((p) => (
          <button
            key={p.name}
            type="button"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => addRow(p.name, p.value)}
            disabled={disabled}
            className="min-h-[44px] px-3 rounded-ios border border-hairline text-accent text-ios-body active:opacity-60 disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-ios-caption text-label-secondary">
        Some sites block automated readers. A browser identity usually fixes it. Headers are saved as plain text that
        anyone who can open Popping can read, so don't put passwords or keys here.
      </p>
    </div>
  )
}
