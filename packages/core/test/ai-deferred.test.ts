import { describe, expect, it } from 'vitest';
import { openDb, migrateDb } from '../src/db/client';
import {
  countAiDeferred, listAiDeferred, pushAiDeferred, removeAiDeferred,
} from '../src/db/repo/ai';
import type { TriageInput } from '../src/ai-port';

const item = (id: number, title: string): TriageInput => ({
  listingId: id, externalId: `ext-${id}`, title, askingCents: 250_000,
});

const dbOf = () => {
  const { db } = openDb(':memory:');
  migrateDb(db);
  return db;
};

describe('fila postergada de IA', () => {
  it('persiste, atualiza por listingId e remove sem duplicar', () => {
    const db = dbOf();

    pushAiDeferred(db, [item(1, 'iPhone 12'), item(2, 'iPhone 13')]);
    expect(listAiDeferred(db).map((i) => i.listingId)).toEqual([1, 2]);
    expect(countAiDeferred(db)).toBe(2);

    pushAiDeferred(db, [item(1, 'iPhone 12 128GB')]);
    expect(listAiDeferred(db).map((i) => [i.listingId, i.title])).toEqual([
      [1, 'iPhone 12 128GB'], [2, 'iPhone 13'],
    ]);

    removeAiDeferred(db, [1]);
    expect(listAiDeferred(db).map((i) => i.listingId)).toEqual([2]);
    expect(countAiDeferred(db)).toBe(1);
  });

  it('lista vazia e remoção vazia são no-op', () => {
    const db = dbOf();
    pushAiDeferred(db, []);
    removeAiDeferred(db, []);
    expect(listAiDeferred(db)).toEqual([]);
    expect(countAiDeferred(db)).toBe(0);
  });
});
