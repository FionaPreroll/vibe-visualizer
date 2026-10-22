import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  clamped,
  color,
  colorList,
  defaults,
  flag,
  oneOf,
  orNone,
  readWith,
  record,
  sanitize,
  trimmedText,
  uniqueTexts,
} from './schema';

const SCHEMA = record({
  level: clamped(0.5, 0, 1),
  count: clamped(4, 1, 8, true),
  mode: oneOf(['a', 'b'], 'a'),
  on: flag(false),
  name: trimmedText('none', 5),
  tint: color('#ffffff'),
  colors: colorList(2, () => ['#000000', '#ffffff']),
  tags: uniqueTexts(),
  inner: record({ value: clamped(1, 0, 2) }),
  read: readWith((value) => (typeof value === 'string' ? value.length : -1)),
});

describe('the schemas of what is stored', () => {
  it('give their defaults for nothing, and for anything but an object', () => {
    const expected = {
      level: 0.5,
      count: 4,
      mode: 'a',
      on: false,
      name: 'none',
      tint: '#ffffff',
      colors: ['#000000', '#ffffff'],
      tags: [],
      inner: { value: 1 },
      read: -1,
    };
    expect(defaults(SCHEMA)).toEqual(expected);
    expect(sanitize(SCHEMA, 'x')).toEqual(expected);
    expect(sanitize(SCHEMA, {})).toEqual(expected);
  });

  it('keep what is valid, clamp numbers, and drop what is not or is unknown', () => {
    expect(
      sanitize(SCHEMA, {
        level: 7,
        count: 2.6,
        mode: 'b',
        on: true,
        name: '  long name ',
        tint: '#AA00cc',
        colors: ['#123456', 'red', 3, '#654321'],
        tags: ['x', 1, 'y', 'x'],
        inner: { value: -1, other: 1 },
        read: 'abc',
        unknown: 1,
      }),
    ).toEqual({
      level: 1,
      count: 3,
      mode: 'b',
      on: true,
      name: 'long ',
      tint: '#AA00cc',
      colors: ['#123456', '#654321'],
      tags: ['x', 'y'],
      inner: { value: 0 },
      read: 3,
    });
    expect(
      sanitize(SCHEMA, {
        level: Number.NaN,
        count: '3',
        mode: 'c',
        on: 'yes',
        name: '   ',
        tint: 'white',
        colors: ['#123456'],
        tags: 'x',
        inner: null,
      }),
    ).toEqual(defaults(SCHEMA));
  });

  it('make a new object and list with each read, to be changed freely', () => {
    const first = defaults(SCHEMA);
    first.inner.value = 2;
    first.colors.push('#111111');
    first.tags.push('z');
    expect(defaults(SCHEMA)).toMatchObject({
      inner: { value: 1 },
      colors: ['#000000', '#ffffff'],
      tags: [],
    });
  });

  it('give null for none, and for anything else, where null is allowed', () => {
    const time = orNone(v.pipe(v.number(), v.finite()));
    expect(sanitize(time, 5)).toBe(5);
    expect(sanitize(time, null)).toBeNull();
    expect(sanitize(time, 'x')).toBeNull();
    expect(sanitize(record({ time }), {})).toEqual({ time: null });
  });
});
