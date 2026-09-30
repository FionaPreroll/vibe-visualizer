import { describe, expect, it } from 'vitest';
import { logoLines } from './default-logo';

describe('default logo', () => {
  it('writes the app name in lines', () => {
    expect(logoLines('FibeStation')).toEqual(['Fibe', 'Station']);
    expect(logoLines('DJ Foo')).toEqual(['DJ', 'Foo']);
    expect(logoLines('  Vibes  ')).toEqual(['Vibes']);
    expect(logoLines('Late Night Radio Show')).toEqual(['Late Night', 'Radio Show']);
    // A name in capitals, or of many camel-case parts, stays one word.
    expect(logoLines('ABCD')).toEqual(['ABCD']);
    expect(logoLines('OneTwoThreeFour')).toEqual(['OneTwoThreeFour']);
    expect(logoLines('')).toEqual([]);
  });
});
