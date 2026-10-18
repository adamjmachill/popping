// Category rules shared by the category picker, the Add form and the
// Suggested and Auto-add paths. No imports (see feedRules.ts); the
// label function is passed in.

// Categories offered when nothing else suggests one. The backend
// accepts any 40-character string; these keep new feeds in the
// usual columns instead of near-duplicates like "tech" and "Tech".
export const CATEGORY_OPTIONS: readonly string[] = [
  'news',
  'tech',
  'vulns',
  'science',
  'finance',
  'policy',
  'longform',
  'deals',
  'podcast',
  'video',
  // Leisure categories (0019_leisure_feed_recommendations) — kept
  // after the original work-adjacent set so the dropdown reads as
  // "the usual suspects, then the fun stuff" rather than an
  // alphabetical shuffle that'd bury either group.
  'sports',
  'entertainment',
  'gaming',
  'food',
  'music',
  'other',
]

// Mirrors _CATEGORY_MAX and _RESERVED_CATEGORY_NAMES in
// backend/app/routes/sources.py (a backend test compares them).
export const CATEGORY_MAX = 40
export const RESERVED_CATEGORIES: readonly string[] = ['saved', 'for you']

/** The backend's reserved-name normalisation: lower case, runs of
 *  underscores, dashes and spaces become one space. Every "same
 *  category" comparison uses it. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[_\s-]+/g, ' ').trim()
}

type Label = (name: string) => string

export type CategoryOption = { value: string; text: string }

/** The picker's two groups. "yours" holds every category a feed
 *  uses, as stored; "suggestions" holds the presets nobody uses yet
 *  (compared with ``fold``). ``current`` always gets an option, so
 *  the select never shows a different value from the one it holds:
 *  the Add form marks a typed-in category "(new)". */
export function categoryOptions(
  sources: ReadonlyArray<{ category: string }>,
  current: string,
  label: Label,
  opts: { defaultInSuggestions?: boolean } = {},
): { yours: Array<CategoryOption & { count: number }>; suggestions: CategoryOption[] } {
  const counts = new Map<string, number>()
  for (const s of sources) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  const yoursFolds = new Set(Array.from(counts.keys(), fold))
  const suggestions = CATEGORY_OPTIONS.filter((c) => !yoursFolds.has(fold(c))).map((c) => ({ value: c, text: label(c) }))

  const added = !counts.has(current) && !suggestions.some((s) => s.value === current) && current !== ''
  if (added) counts.set(current, 0)

  const byLabel = new Map<string, number>()
  for (const raw of counts.keys()) byLabel.set(label(raw), (byLabel.get(label(raw)) ?? 0) + 1)
  const yours = Array.from(counts, ([value, count]) => {
    const base = label(value)
    let text = byLabel.get(base)! > 1 ? `${base} (“${value}”)` : base
    if (added && value === current && opts.defaultInSuggestions) text = `${text} (new)`
    return { value, text, count }
  }).sort((a, b) => label(a.value).localeCompare(label(b.value), undefined, { sensitivity: 'base' }) || a.value.localeCompare(b.value))
  return { yours, suggestions }
}

export type NewCategory =
  | { ok: true; value: string; reused: 'existing' | 'suggestion' | null; text: string }
  | { ok: false; message: string }

/** Check a typed category and say what will be stored. Keeps the case
 *  as typed ("NHL" stays "NHL"), but reuses an existing category or a
 *  suggestion that folds the same, so "NEWS" lands in "news". */
export function resolveNewCategory(
  input: string,
  existing: Iterable<string>,
  suggestions: Iterable<string>,
  label: Label,
): NewCategory {
  const s = input.trim().replace(/\s+/g, ' ')
  if (!s) return { ok: false, message: 'Type a name.' }
  // Code points, like Python's len and Postgres varchar(40).
  if (Array.from(s).length > CATEGORY_MAX) {
    return { ok: false, message: `Keep it to ${CATEGORY_MAX} characters or fewer.` }
  }
  const f = fold(s)
  if (RESERVED_CATEGORIES.includes(f)) {
    return { ok: false, message: `“${s}” is used by the app. Pick another name.` }
  }
  const existingList = Array.from(existing)
  const match = existingList.find((x) => x === s) ?? existingList.find((x) => fold(x) === f)
  if (match !== undefined) return { ok: true, value: match, reused: 'existing', text: label(match) }
  const suggestion = Array.from(suggestions).find((x) => fold(x) === f)
  if (suggestion !== undefined) return { ok: true, value: suggestion, reused: 'suggestion', text: label(suggestion) }
  return { ok: true, value: s, reused: null, text: label(s) }
}
