import type { AlertDecision } from './alerts';
import { formatDealMessage, type DealSignal } from './deal-signal';
import type { Db } from './db/client';
import { insertDealAlert, updateDealAlert } from './db/repo/alerts';
import type { NotifyPort } from './notify-port';
import type { AlertChannel, SearchMonitor } from './types';

export interface DeliveryOutcome {
  attempted: boolean;
  delivered: boolean;
  reason?: string;
}

// A decisão (gate, confiança, última cruzada, queda mínima) vem de core/alerts.
// Aqui só existe o efeito: gravar a intenção, entregar pelo porto e fechar o
// registro. Falha de transporte é registrada como failed e NÃO propaga: a
// passada já gravou valuation/opportunity e não pode cair por causa do webhook.
export async function deliverDealAlert(opts: {
  db: Db;
  notify: NotifyPort;
  now: () => Date;
  monitor: SearchMonitor;
  listing: {
    id: number;
    title: string;
    url: string;
    city: string | null;
    imageUrls: string[];
  };
  opportunityId: number;
  signal: DealSignal;
  decision: AlertDecision;
  channel?: AlertChannel;
}): Promise<DeliveryOutcome> {
  // Sem cruzão de preço contra a base do watch não existe oferta para entregar.
  if (!opts.signal.deal) return { attempted: false, delivered: false };

  const channel = opts.channel ?? 'ntfy';
  const at = opts.now();
  if (!opts.decision.shouldAlert) {
    const reason = opts.decision.reason ?? 'sem-decisao';
    insertDealAlert(opts.db, {
      opportunityId: opts.opportunityId, listingId: opts.listing.id, channel,
      alertedAtCents: opts.signal.priceCents, status: 'suppressed',
      reason, createdAt: at,
    });
    return { attempted: false, delivered: false, reason };
  }

  const id = insertDealAlert(opts.db, {
    opportunityId: opts.opportunityId, listingId: opts.listing.id, channel,
    alertedAtCents: opts.signal.priceCents, status: 'pending', createdAt: at,
  });

  try {
    const message = formatDealMessage({ monitor: opts.monitor, listing: opts.listing, signal: opts.signal });
    const result = await opts.notify.send(message);
    if (result.ok) {
      updateDealAlert(opts.db, id, { status: 'sent', deliveredAt: opts.now() });
      return { attempted: true, delivered: true };
    }
    const reason = (result.error ?? 'entrega-recusada').slice(0, 200);
    updateDealAlert(opts.db, id, { status: 'failed', reason });
    return { attempted: true, delivered: false, reason };
  } catch (err) {
    const reason = ((err as Error).message ?? 'erro-na-entrega').split('\n')[0]!.slice(0, 200);
    updateDealAlert(opts.db, id, { status: 'failed', reason });
    return { attempted: true, delivered: false, reason };
  }
}
