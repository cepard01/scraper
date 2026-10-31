import { describe, it, expect } from 'vitest';
import type { Cents, ListingStatus } from '../src/types';

describe('toolchain', () => {
  it('resolve tipos do domínio e roda ESM', () => {
    const price: Cents = 98_000;
    const status: ListingStatus = 'new';
    expect(price / 100).toBe(980);
    expect(status).toBe('new');
  });
});
