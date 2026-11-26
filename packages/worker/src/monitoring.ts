import { checkSourceHealth } from '@brique/core/source-health';
import { healthNoticeDue, markHealthNotice } from '@brique/core/source-health-notifier';
import type { NotifyPort } from '@brique/core/notify-port';
import type { Db } from '@brique/core/db/client';
import type { SourceId } from '@brique/core/types';
import { sourceDegradedMessage } from './notify-ntfy';

// Chamado depois de cada passada, inclusive quando ela não gerou novos itens:
// justamente aí mora o sinal de "três passadas sem anúncio novo". Uma fonte
// com aviso falho não marca dedupe e tenta de novo no tick seguinte.
export async function notifyDegradedSources(opts: {
  db: Db;
  notify: NotifyPort;
  sources: SourceId[];
  now: () => Date;
}): Promise<SourceId[]> {
  const sent: SourceId[] = [];
  for (const source of opts.sources) {
    try {
      const health = checkSourceHealth(opts.db, source);
      if (!healthNoticeDue(opts.db, source, health).shouldNotify) continue;
      const result = await opts.notify.send(sourceDegradedMessage(source, health));
      if (result.ok) {
        markHealthNotice(opts.db, source, health, opts.now());
        sent.push(source);
      }
    } catch {
      // Saúde de uma fonte não pode derrubar a passada das outras.
    }
  }
  return sent;
}
