import { loadConfig } from '@brique/core/config';
import { getPnl } from '../../data';
import { webDb } from '../../db';
import { dateOnly, money, notice, pct } from '../../view';

export const dynamic = 'force-dynamic';

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function PnlPage({ searchParams }: { searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const data = getPnl(webDb(), cfg.tz);
  const msg = notice(await searchParams);

  return (
    <>
      <h1>P&amp;L</h1>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}
      <div className="cards">
        <div className="card"><span>Receita</span>{money(data.summary.revenueCents)}</div>
        <div className="card"><span>Custo</span>{money(data.summary.costCents)}</div>
        <div className="card"><span>Realizado</span>{money(data.summary.realizedCents)}</div>
        <div className="card"><span>ROI</span>{pct(data.summary.roiPct)}</div>
        <div className="card"><span>Dias médios</span>{data.summary.avgDaysInStock?.toFixed(1) ?? 'n/d'}</div>
      </div>

      <h2>Por mês</h2>
      {data.summary.byMonth.length === 0 ? <p className="muted">Sem vendas registradas.</p> : (
        <table><thead><tr><th>Mês</th><th>Vendas</th><th>Receita</th><th>Custo</th><th>Realizado</th></tr></thead><tbody>
          {data.summary.byMonth.map((m) => <tr key={m.month}>
            <td>{m.month}</td><td>{m.soldCount}</td><td>{money(m.revenueCents)}</td>
            <td>{money(m.costCents)}</td><td>{money(m.realizedCents)}</td>
          </tr>)}
        </tbody></table>
      )}

      <h2>Por categoria</h2>
      {data.categories.length === 0 ? <p className="muted">Sem categorias realizadas.</p> : (
        <table><thead><tr><th>Categoria</th><th>Vendas</th><th>Receita</th><th>Custo</th><th>Realizado</th><th>ROI</th></tr></thead><tbody>
          {data.categories.map((c) => <tr key={c.category}>
            <td>{c.category}</td><td>{c.soldCount}</td><td>{money(c.revenueCents)}</td>
            <td>{money(c.costCents)}</td><td>{money(c.realizedCents)}</td><td>{pct(c.roiPct)}</td>
          </tr>)}
        </tbody></table>
      )}

      <h2>Itens realizados</h2>
      {data.items.length === 0 ? <p className="muted">Nenhum item encerrado.</p> : (
        <table><thead><tr><th>Item</th><th>Compra</th><th>Venda</th><th>Dias</th><th>Margem</th><th>ROI</th></tr></thead><tbody>
          {data.items.map((i) => <tr key={i.purchaseId}>
            <td>{i.label}</td><td>{money(i.totalCostCents)}</td><td>{money(i.netProceedsCents)}</td>
            <td>{i.daysInStock}</td><td>{money(i.marginCents)}</td><td>{pct(i.roiPct)}</td>
          </tr>)}
        </tbody></table>
      )}

      <h2>Encalhados</h2>
      {data.stale.length === 0 ? <p className="muted">Nenhum item acima da meta.</p> : (
        <table><thead><tr><th>Item</th><th>Custo</th><th>Dias</th><th>Comprado</th></tr></thead><tbody>
          {data.stale.map((s) => <tr key={s.purchase.id}>
            <td>{s.purchase.label}</td><td>{money(s.totalCostCents)}</td>
            <td>{s.daysHeld}</td><td>{dateOnly(s.purchase.boughtAt, cfg.tz)}</td>
          </tr>)}
        </tbody></table>
      )}
    </>
  );
}
