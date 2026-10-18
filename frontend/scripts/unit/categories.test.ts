import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_OPTIONS, categoryOptions, fold, resolveNewCategory } from '../../src/lib/categories.ts'

// A copy of categoryLabel (src/lib/labels.ts) without its acronym list,
// enough for these cases: names with a capital are kept as they are.
const label = (name: string) =>
  /[A-Z]/.test(name)
    ? name
    : name
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((w) => (w === 'nhl' ? 'NHL' : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ')

const resolve = (input: string, existing: string[] = []) => resolveNewCategory(input, existing, CATEGORY_OPTIONS, label)

test('fold matches the backend normalisation', () => {
  assert.equal(fold('For_You'), 'for you')
  assert.equal(fold('for-you'), 'for you')
  assert.equal(fold(' Saved_ '), 'saved')
  assert.equal(fold('Tech  News'), 'tech news')
})

test('a suggestion is reused by its slug', () => {
  assert.deepEqual(resolve('Tech'), { ok: true, value: 'tech', reused: 'suggestion', text: 'Tech' })
})

test('an existing category that folds the same is reused as stored', () => {
  assert.deepEqual(resolve('tech_news', ['Tech News']), { ok: true, value: 'Tech News', reused: 'existing', text: 'Tech News' })
  assert.deepEqual(resolve('Tech_News', ['tech news']), { ok: true, value: 'tech news', reused: 'existing', text: 'Tech News' })
  assert.deepEqual(resolve('NEWS', ['news']), { ok: true, value: 'news', reused: 'existing', text: 'News' })
})

test('an exact twin wins over a folded one', () => {
  const r = resolve('News', ['news', 'News'])
  assert.ok(r.ok && r.value === 'News')
})

test('length counts code points, like the backend', () => {
  assert.deepEqual(resolve('x'.repeat(41)), { ok: false, message: 'Keep it to 40 characters or fewer.' })
  const emoji = '\u{1F3D2}'.repeat(21) // 42 UTF-16 units
  const r = resolve(emoji)
  assert.ok(r.ok)
})

test('reserved names are refused in every spelling', () => {
  for (const name of ['for_you', 'For_You', 'For-You', 'saved_', ' Saved ', 'For You']) {
    const r = resolve(name)
    assert.equal(r.ok, false, name)
    assert.equal(!r.ok && r.message, `“${name.trim()}” is used by the app. Pick another name.`)
  }
})

test('inner whitespace collapses, case is kept, empty is refused', () => {
  assert.deepEqual(resolve('  Ice   Hockey '), { ok: true, value: 'Ice Hockey', reused: null, text: 'Ice Hockey' })
  assert.deepEqual(resolve('NHL'), { ok: true, value: 'NHL', reused: null, text: 'NHL' })
  assert.deepEqual(resolve('   '), { ok: false, message: 'Type a name.' })
})

test('yours lists every category in use; twins show their stored text', () => {
  const sources = [{ category: 'news' }, { category: 'News' }, { category: 'news ' }, { category: 'tech' }, { category: 'tech' }]
  const { yours } = categoryOptions(sources, 'tech', label)
  assert.deepEqual(
    yours.map((o) => [o.value, o.text, o.count]),
    [
      ['news', 'News (“news”)', 1],
      ['News', 'News (“News”)', 1],
      ['news ', 'News (“news ”)', 1],
      ['tech', 'Tech', 2],
    ],
  )
})

test('suggestions leave out anything already in use', () => {
  const { suggestions } = categoryOptions([{ category: 'Tech' }], 'Tech', label)
  assert.ok(!suggestions.some((s) => s.value === 'tech'))
  assert.ok(suggestions.some((s) => s.value === 'news'))
})

test("the Add form's default sits in Suggestions on a fresh install", () => {
  const { yours, suggestions } = categoryOptions([], 'news', label, { defaultInSuggestions: true })
  assert.deepEqual(yours, [])
  assert.deepEqual(suggestions.map((s) => s.value), CATEGORY_OPTIONS)
})

test('a current value no feed uses still gets an option', () => {
  const add = categoryOptions([{ category: 'news' }], 'Hockey', label, { defaultInSuggestions: true })
  assert.deepEqual(add.yours.find((o) => o.value === 'Hockey'), { value: 'Hockey', text: 'Hockey (new)', count: 0 })
  const editor = categoryOptions([{ category: 'news' }], 'Hockey', label)
  assert.deepEqual(editor.yours.find((o) => o.value === 'Hockey'), { value: 'Hockey', text: 'Hockey', count: 0 })
})

test('yours sorts by label, ignoring case', () => {
  const { yours } = categoryOptions([{ category: 'tech' }, { category: 'Hockey' }, { category: 'nhl' }, { category: 'apple' }], 'tech', label)
  assert.deepEqual(yours.map((o) => o.value), ['apple', 'Hockey', 'nhl', 'tech'])
})
