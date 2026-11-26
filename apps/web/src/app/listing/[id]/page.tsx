import { loadConfig } from '@brique/core/config';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { recordPurchaseAction } from '../../../actions';
import { getListingDetail } from '../../../data';
import { webDb } from '../../../db';
import { alertText, breakdownText, dateTime, money, notice, pct, verdictText } from '../../../view';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['celular', 'notebook', 'console', 'bicicleta', 'autopeca', 'outro'] as const;

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function ListingPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId)) notFound();
  const d = getListingDetail(webDb(), listingId);
  if (!d) notFound();
  const msg = notice(await searchParams);

  return (
    <>
      <p><Link href="/deals">← Deals</Link></p>
      <h1>{d.title}</h1>
      <p className="muted">{d.fingerprintLabel ?? 'sem fingerprint'} · {d.city ?? '—'}/{d.uf ?? '—'} · {d.source} · {dateTime(d.lastSeenAt, cfg.tz)}</p>
      <p><a href={d.url} target="_blank" rel="noreferrer">Ver anúncio original ↗</a></p>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}

      <div className="cards">
        <div className="card"><span>Pedido</span>{money(d.askingCents)}</div>
        <div className="card"><span>Justo</span>{money(d.valuation?.fairGrossCents ?? null)}</div>
        <div className="card"><span>Amostra</span>{d.valuation?.sampleSize ?? 0}</div>
        <div className="card"><span>Score</span>{d.opportunity?.score.toFixed(2) ?? 'n/d'}</div>
      </div>

      {d.imageUrls.length > 0 && (
        <h2>Fotos</h2>
      )}
      <div className="cards">{d.imageUrls.map((url) => (
        // eslint-disable-next-line @next/next/no-img-element -- URLs vêm do anúncio, sem loader de imagem configurado
        <img key={url} src={url} alt="" width={160} height={120} style={{ objectFit: 'cover', borderRadius: 4 }} />
      ))}</div>

      <h2>Descrição</h2>
      <p style={{ whiteSpace: 'pre-wrap' }}>{d.description || '—'}</p>

      <h2>Valuação</h2>
      {d.valuation ? (
        <table>
          <tbody>
            <tr><th>Mediana / p25 / p75</th><td>{money(d.valuation.medianCents)} / {money(d.valuation.p25Cents)} / {money(d.valuation.p75Cents)}</td></tr>
            <tr><th>Justo e delta</th><td>{money(d.valuation.fairGrossCents)} · delta {pct(d.valuation.delta)}</td></tr>
            <tr><th>Liquidez</th><td>{d.valuation.liquidityDays} dias ({d.valuation.liquiditySource})</td></tr>
            <tr><th>Confiança</th><td>{d.valuation.confidence} · {dateTime(d.valuation.computedAt, cfg.tz)}</td></tr>
          </tbody>
        </table>
      ) : <p className="muted">Sem valuação calculada.</p>}
      {d.opportunity && <p>Score {d.opportunity.score.toFixed(2)} — {breakdownText(d.opportunity.breakdown)} · gate {d.opportunity.gateReason}</p>}

      <h2>Comparáveis</h2>
      {d.comparables.length === 0 ? <p className="muted">Nenhum comparável gravado.</p> : (
        <table>
          <thead><tr><th>Anúncio</th><th>Preço</th><th>Papel</th></tr></thead>
          <tbody>{d.comparables.map((c) => (
            <tr key={`${c.listingId}-${c.role}`}>
              <td><Link href={`/listing/${c.listingId}`}>{c.title}</Link></td>
              <td>{money(c.askingCents)}</td><td>{c.role}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <h2>Série de preço</h2>
      {d.priceSeries.length === 0 ? <p className="muted">Sem reprecificação registrada.</p> : (
        <table><thead><tr><th>Quando</th><th>Preço</th></tr></thead><tbody>
          {d.priceSeries.map((p, i) => <tr key={`${p.observedAt.getTime()}-${i}`}>
            <td>{dateTime(p.observedAt, cfg.tz)}</td><td>{money(p.askingCents)}</td>
          </tr>)}
        </tbody></table>
      )}

      <h2>Auditoria</h2>
      <p>{verdictText(d.opportunity?.aiVerdict ?? null, d.opportunity?.aiReasons ?? [])}</p>
      <p>{d.alerts.length === 0 ? 'Sem alertas.' : d.alerts.map((a) => (
        <span key={a.id}>{alertText(a.status, a.reason)} · {dateTime(a.createdAt, cfg.tz)}<br /></span>
      ))}</p>

      <h2>Registrar compra</h2>
      {d.purchase ? (
        <p>Já registrada: compra #{d.purchase.id} · {money(d.purchase.paidCents)} · {d.purchase.status}</p>
      ) : (
        <form action={recordPurchaseAction}>
          <input type="hidden" name="listingId" value={d.id} />
          <input type="hidden" name="fingerprintId" value={d.fingerprintId ?? ''} />
          <label>Rótulo<input name="label" defaultValue={d.title} required /></label>
          <label>Categoria<select name="category" defaultValue={CATEGORIES.includes(d.category as typeof CATEGORIES[number]) ? d.category! : 'outro'}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label>Pago (R$)<input name="paid" defaultValue={(d.askingCents / 100).toFixed(2).replace('.', ',')} required /></label>
          <label>Comprado em<input name="boughtAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <button type="submit">Registrar</button>
        </form>
      )}
    </>
  );
}
