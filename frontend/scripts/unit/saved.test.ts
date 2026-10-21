import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reinsert, savedStories, savedToFetch } from '../../src/lib/saved.ts'

type Story = { id: number; title: string }
const story = (id: number): Story => ({ id, title: `story ${id}` })
const ids = (list: readonly { id: number }[]) => list.map((e) => e.id)
const byId = (...list: number[]) => {
  const m = new Map(list.map((id) => [id, story(id)]))
  return (id: number) => m.get(id)
}
const never = () => false

test('savedStories: newest save first (the last id saved leads)', () => {
  // Saved in the order 105, 503, 103: 103 is the newest save.
  assert.deepEqual(ids(savedStories([105, 503, 103], byId(103, 105, 503), never)), [103, 503, 105])
})

test('savedStories: a save with no copy yet is left out until it has one', () => {
  assert.deepEqual(ids(savedStories([1, 2, 3], byId(1, 3), never)), [3, 1])
})

test('savedStories: hide wins over saved (isRemoved)', () => {
  const hidden = new Set([2])
  assert.deepEqual(ids(savedStories([1, 2, 3], byId(1, 2, 3), (e) => hidden.has(e.id))), [3, 1])
})

test('savedStories: an id stored twice is drawn once, at its newest place', () => {
  assert.deepEqual(ids(savedStories([1, 2, 1], byId(1, 2), never)), [1, 2])
  assert.deepEqual(savedStories([], byId(1), never), [])
})

test('savedToFetch: newest save first, only the ids skip leaves', () => {
  const held = new Set([2, 4])
  assert.deepEqual(savedToFetch([1, 2, 3, 4, 5], (id) => held.has(id)), [5, 3, 1])
  assert.deepEqual(savedToFetch([1, 2], () => true), [])
  // An id stored twice is asked for once.
  assert.deepEqual(savedToFetch([7, 8, 7], never), [7, 8])
})

test('reinsert: the story goes back at its place, clamped to the list', () => {
  const list = [story(1), story(2), story(3)]
  assert.deepEqual(ids(reinsert(list, story(9), 1)), [1, 9, 2, 3])
  assert.deepEqual(ids(reinsert(list, story(9), 0)), [9, 1, 2, 3])
  // The list got shorter since the hide: at the end.
  assert.deepEqual(ids(reinsert(list, story(9), 10)), [1, 2, 3, 9])
  assert.deepEqual(ids(reinsert([], story(9), 4)), [9])
  // The input list is never changed.
  assert.deepEqual(ids(list), [1, 2, 3])
})

test('reinsert: a list that holds the story already comes back as it is', () => {
  const list = [story(1), story(9)]
  assert.equal(reinsert(list, story(9), 0), list)
})
