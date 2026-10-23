import { describe, expect, it, vi } from 'vitest';
import { Lazy } from './later.svelte';
import { reportProblem } from './problems';

vi.mock('./problems', () => ({ reportProblem: vi.fn() }));

describe('a part of the UI loaded later', () => {
  it('loads once, however often it is asked for', async () => {
    const importer = vi.fn(async () => ({ default: 'Dialog' }));
    const part = new Lazy('A dialog', importer);
    expect(part.component).toBeNull();
    await Promise.all([part.load(), part.load()]);
    await part.load();
    expect(part.component).toBe('Dialog');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('reports a load that failed, and tries again when asked again', async () => {
    const importer = vi
      .fn<() => Promise<{ default: string }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: 'Dialog' });
    const part = new Lazy('A dialog', importer);
    await part.load();
    expect(part.component).toBeNull();
    expect(reportProblem).toHaveBeenCalledWith(expect.any(Error), 'A dialog');
    await part.load();
    expect(part.component).toBe('Dialog');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
