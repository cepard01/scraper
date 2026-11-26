import { loadConfig } from '@brique/core/config';
import { loadSettings } from '@brique/core/db/client-helpers';
import { recordSaleAction } from '../../actions';
import { getInventory } from '../../data';
import { webDb } from '../../db';
import { dateOnly, money, notice, pct } from '../../view';

export const dynamic = 'force-dynamic';

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const db = webDb();
  const settings = loadSettings(db);
  const rows = getInventory(db, new Date(), settings);
  const msg = notice(await searchParams);

  return (
    <>
      <h1>Estoque</h1>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}
      <p className="muted">Meta: {money(settings.metaPerDayCents)}/dia em {settings.metaDays} dias; encalhado acima de {settings.metaStaleDays} dias.</p>
      {rows.length === 0 ? <p className="muted">Estoque vazio.</p> : (
        <table>
          <thead><tr><th>Item</th><th>Custo</th><th>Referência</th><th>Status</th><th>Dias</th><th>Vender</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.purchase.id}>
              <td>{r.purchase.label}<br /><small className="muted">{dateOnly(r.purchase.boughtAt, cfg.tz)}</small></td>
              <td>{money(r.totalCostCents)}</td>
              <td>{money(r.referenceCents)}<br /><small className="muted">delta {pct(settings.delta)}</small></td>
              <td>{r.purchase.status}{r.stale ? <span className="bad"> · encalhado</span> : null}</td>
              <td>{r.daysHeld}</td>
              <td>
                <form action={recordSaleAction}>
                  <input type="hidden" name="purchaseId" value={r.purchase.id} />
                  <label>Vendido (R$)<input name="sold" placeholder="0,00" required /></label>
                  <label>Plataforma<select name="platform"><option value="meli">meli</option><option value="olx">olx</option><option value="pagofio">pagofio</option></select></label>
                  <label>Data<input name="soldAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
                  <button type="submit">Registrar venda</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
