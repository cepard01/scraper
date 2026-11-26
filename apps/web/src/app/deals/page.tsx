import { loadConfig } from '@brique/core/config';
import Link from 'next/link';
import { markBoughtAction, markFavoriteAction, markIgnoredAction } from '../../actions';
import { getDeals } from '../../data';
import { webDb } from '../../db';
import { alertText, breakdownText, money, notice, pct, verdictText } from '../../view';

export const dynamic = 'force-dynamic';

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function DealsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const deals = getDeals(webDb(), 200);
  const msg = notice(await searchParams);

  return (
    <>
      <h1>Fila de deals</h1>
      <p className="muted">Ordenada por score; {deals.length} anúncio(s) com gate aprovado.</p>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}
      {deals.length === 0 ? <p>Nada na fila.</p> : (
        <table>
          <thead><tr>
            <th>Anúncio</th><th>Pedido / justo</th><th>Margem</th><th>Score</th>
            <th>Comparáveis</th><th>Preço</th><th>IA</th><th>Alerta</th><th>Ações</th>
          </tr></thead>
          <tbody>{deals.map((d) => (
            <tr key={d.opportunityId}>
              <td>
                <Link href={`/listing/${d.listingId}`}>{d.title}</Link>
                <br /><small className="muted">{d.city ?? '—'} · {d.source}{d.favorite ? ' · ★' : ''}</small>
              </td>
              <td>{money(d.askingCents)}<br /><small className="muted">justo {money(d.fairGrossCents)}</small></td>
              <td>{money(d.marginCents)}<br /><small className="muted">{pct(d.marginPct)} · ~{money(d.expectedPerDayCents)}/dia</small></td>
              <td>{d.score.toFixed(2)}<br /><small className="muted">{breakdownText(d.breakdown)}</small></td>
              <td>{d.sampleSize} · {d.confidence}</td>
              <td>{d.priceCount} ponto(s)<br /><small className="muted">último {money(d.lastPriceCents)}</small></td>
              <td>{verdictText(d.aiVerdict, d.aiReasons)}</td>
              <td>{alertText(d.alertStatus, d.alertReason)}</td>
              <td>
                <form action={markBoughtAction}>
                  <input type="hidden" name="listingId" value={d.listingId} />
                  <button type="submit">Comprado</button>
                </form>
                <form action={markIgnoredAction}>
                  <input type="hidden" name="listingId" value={d.listingId} />
                  <button type="submit" className="secondary">Ignorar</button>
                </form>
                <form action={markFavoriteAction}>
                  <input type="hidden" name="listingId" value={d.listingId} />
                  <input type="hidden" name="favorite" value={d.favorite ? 'false' : 'true'} />
                  <button type="submit" className="secondary">{d.favorite ? 'Desfavoritar' : 'Favoritar'}</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
