import { describe, expect, it } from 'vitest';
import { nullNotifier, NULL_NOTIFY_REASON, type AlertMessage } from '../src/notify-port';

const msg: AlertMessage = {
  title: 'iPhone 15 Pro 256gb',
  body: 'justo R$ 4.000,00',
  tags: ['moneybag'],
  priority: 4,
  clickUrl: 'https://rj.olx.com.br/x',
};

describe('nullNotifier', () => {
  it('falha honestamente em vez de fingir entrega', async () => {
    expect(await nullNotifier().send(msg)).toEqual({ ok: false, error: NULL_NOTIFY_REASON });
  });
});
