import { extractProduct } from './product';
import { getOrCreateFingerprint, listFingerprintIdsByCategory } from './db/repo/fingerprints';
import { upsertFromSource, setStatus, markGone, attachDupe, findRecentCrossSource } from './db/repo/listings';
import { startRun, finishRun, type RunSummary } from './db/repo/runs';
import { touchRun } from './db/repo/monitors';
import { insertValuation } from './db/repo/valuations';
import { insertOpportunity } from './db/repo/opportunities';
import { valueFingerprint } from './valuation/valuation';
import { scoreOpportunity } from './score/score';
import { gate } from './score/gate';
import { findDupe } from './dedupe';
import type { ComparablesProvider } from './valuation/comparables';
import type { AiTriagePort } from './ai-port';
import type { NotifyPort } from './notify-port';
import type { Db } from './db/client';
import type { AlertChannel, SearchMonitor, Settings } from './types';
import { isRejected, type SourceAdapter } from './adapter-contract';
import { requireWordsVerdict } from './filters';
import { decideAlert, type AlertDecision } from './alerts';
import { evaluateDealSignal } from './deal-signal';
import { deliverDealAlert } from './alert-delivery';
import { latestDealAlertCents } from './db/repo/alerts';

export interface PipelineDeps {
  db: Db;
  settings: Settings;
  adapter: SourceAdapter;
  ai: AiTriagePort;
  comparables: ComparablesProvider;
  /** Transporte obrigatório: na máquina sem webhook, quem compõe deps passa nullNotifier(). */
  notify: NotifyPort;
  alertChannel?: AlertChannel;
  now: () => Date;
  deadlineMs?: number;
  outPlatform?: string;
}

export async function runMonitor(deps: PipelineDeps, monitor: SearchMonitor): Promise<RunSummary> {
  const { db, settings } = deps;
  const startedAt = deps.now();
  const runId = startRun(db, monitor.id, startedAt);
  const deadline = deps.deadlineMs ?? 600_000;

  const summary: RunSummary = { outcome: 'ok', fetched: 0, created: 0, repriced: 0, unchanged: 0, rejected: {}, unmatched: 0, aiCalls: 0, alerts: 0 };
  let timedOut = false;

  try {
    const raws = await deps.adapter.search(monitor, monitor.lastRunAt ?? new Date(startedAt.getTime() - 86_400_000));
    summary.fetched = raws.length;
    const seenIds: string[] = [];

    for (const raw of raws) {
      if (deps.now().getTime() - startedAt.getTime() > deadline) { summary.outcome = 'partial'; timedOut = true; break; }
      seenIds.push(raw.externalId);

      const parsed = deps.adapter.toListingInput(raw);
      if (isRejected(parsed)) {
        summary.rejected[parsed.reason] = (summary.rejected[parsed.reason] ?? 0) + 1;
        continue;
      }
      const input = parsed;

      // Filtro fuzzy antes de qualquer escrita: item fora do watch não entra na
      // amostra de preço, não vira oportunidade e nunca gera alerta.
      const words = requireWordsVerdict(input.title, monitor.params.requireWords);
      if (!words.ok) {
        summary.rejected[words.reason] = (summary.rejected[words.reason] ?? 0) + 1;
        continue;
      }

      const product = extractProduct(input.title, input.description);
      if (!product.matched) summary.unmatched++;

      const fp = product.matched ? getOrCreateFingerprint(db, product) : null;
      const upsert = upsertFromSource(db, input, {
        parserVersion: deps.adapter.parserVersion,
        monitorId: monitor.id,
        fingerprintId: fp?.id ?? null,
        grade: product.matched ? product.grade : null,
        seenAt: deps.now(),
      });

      if (upsert.transition === 'new') summary.created++;
      else if (upsert.transition === 'repriced') summary.repriced++;
      else { summary.unchanged++; continue; }

      const dupeCands = findRecentCrossSource(db, input.source, new Date(deps.now().getTime() - 72 * 3_600_000), listFingerprintIdsByCategory(db, product.category));
      const dupeId = product.matched ? findDupe(dupeCands, { title: input.title, askingCents: input.askingCents }) : null;
      if (dupeId && dupeId !== upsert.id) {
        attachDupe(db, upsert.id, dupeId);
        setStatus(db, upsert.id, 'ignored');
        continue;
      }

      if (!fp) continue;

      const value = valueFingerprint(db, fp.id, {
        settings, now: deps.now(), provider: deps.comparables, category: product.category,
        excludeListingId: upsert.id,
      });
      const { id: valuationId } = insertValuation(db, fp.id, value.valuation, value.comparables);

      const math = scoreOpportunity({
        askingCents: input.askingCents, valuation: value.valuation, category: product.category,
        grade: product.grade, outPlatform: deps.outPlatform ?? 'meli', seenAt: deps.now(), now: deps.now(), settings,
      });

      const g = gate({ math, sampleGate: value.sampleGate, hasFingerprint: true, settings, confidence: value.valuation.confidence });
      const opportunityId = insertOpportunity(db, upsert.id, math, { valuationId, gatePassed: g.passed, gateReason: g.reason, createdAt: deps.now() });
      // Alerta depende da decisão de alerta (gate + confiança + cruzada), não
      // apenas do preço baixo. O sinal abaixo dá a base exibida no embed.
      await maybeAlert();
      if (!g.passed) continue;

      setStatus(db, upsert.id, 'shortlisted');

      function maybeAlert(): Promise<void> {
        const signal = evaluateDealSignal({
          priceCents: input.askingCents,
          medianCents: value.valuation.medianCents,
          samples: value.valuation.sampleSize,
          params: monitor.params,
        });
        if (!signal.deal) return Promise.resolve();

        const lastCents = latestDealAlertCents(db, upsert.id);
        // Exceção explícita portada do Scrapelytics: no cold start não existe
        // margem para passar no gate, mas o teto manual do watch autoriza o push.
        const coldStart = !g.passed && g.reason === 'amostra-insuficiente' && signal.basis === 'manual';
        const decision: AlertDecision = coldStart
          ? { shouldAlert: true, kind: 'novo', dropPct: null, reason: null }
          : decideAlert({
            listingId: upsert.id, askingCents: input.askingCents,
            gatePassed: g.passed, gateReason: g.reason,
            confidence: value.valuation.confidence, marginPct: math.marginPct,
            floorMarginPct: settings.floorMarginPct, lastAlertCents: lastCents,
          });

        return deliverDealAlert({
          db, notify: deps.notify, now: deps.now, monitor,
          listing: {
            id: upsert.id, title: input.title, url: input.url,
            city: input.city, imageUrls: input.imageUrls,
          },
          opportunityId, signal, decision,
          channel: deps.alertChannel ?? 'discord',
        }).then((outcome) => { if (outcome.delivered) summary.alerts++; });
      }
    }

    if (raws.length > 0 && !timedOut) markGone(db, deps.adapter.id, seenIds, deps.now(), monitor.id);
    touchRun(db, monitor.id, deps.now(), summary.created + summary.repriced);
  } catch (err) {
    summary.outcome = 'failed';
    summary.error = (err as Error).message;
  }

  finishRun(db, runId, deps.now(), summary);
  return summary;
}
