import { loadConfig } from '@brique/core/config';
import Link from 'next/link';
import { getConfigStatus, getHome } from '../data';
import { webDb } from '../db';
import { aiKpiText, healthText, money, notice, pct, verdictText } from '../view';

export const dynamic = 'force-dynamic';

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const data = getHome(webDb(), cfg.tz, 10, getConfigStatus());
  const msg = notice(await searchParams);
  const degraded = data.health.filter((h) => h.degraded).length;

  return (
    <>
      <h1>Brique</h1>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}
      <div className="cards">
        <div className="card"><span>Lucro realizado</span>{money(data.summary.realizedCents)}</div>
        <div className="card"><span>Capital em estoque</span>{money(data.summary.inventoryValueCents)}</div>
        <div className="card"><span>ROI médio</span>{pct(data.summary.roiPct)}</div>
        <div className="card"><span>Dias médios de giro</span>{data.summary.avgDaysInStock?.toFixed(1) ?? 'n/d'}</div>
        <div className="card"><span>Cache de IA</span>{aiKpiText(data.ai)} <small>{data.ai.configured ? `${data.ai.calls} chamada(s) em 24h` : 'sem chave'}</small></div>
        <div className="card"><span>Fontes</span>{degraded > 0 ? `${degraded} degradada(s)` : 'ok'}</div>
      </div>

      <h2>Saúde das fontes</h2>
      {data.health.length === 0 ? <p className="muted">Sem monitores cadastrados.</p> : (
        <ul>{data.health.map((h) => <li key={h.source} className={h.degraded ? 'bad' : ''}>{healthText(h)}</li>)}</ul>
      )}

      <h2>Top 10 deals recentes</h2>
      {data.top.length === 0 ? <p className="muted">Nenhum deal ranqueado.</p> : (
        <table>
          <thead><tr><th>Anúncio</th><th>Pedido</th><th>Justo</th><th>Margem</th><th>Score</th><th>IA</th></tr></thead>
          <tbody>{data.top.map((d) => (
            <tr key={d.opportunityId}>
              <td><Link href={`/listing/${d.listingId}`}>{d.title}</Link><br /><small className="muted">{d.city ?? '—'} · {d.source}</small></td>
              <td>{money(d.askingCents)}</td>
              <td>{money(d.fairGrossCents)}</td>
              <td>{money(d.marginCents)}</td>
              <td>{d.score.toFixed(2)}</td>
              <td>{verdictText(d.aiVerdict, d.aiReasons)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
