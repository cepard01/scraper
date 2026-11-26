import { getSettingsView } from '../../data';
import { webDb } from '../../db';
import { setSettingsAction } from '../../actions';
import { notice } from '../../view';

export const dynamic = 'force-dynamic';

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings: s, config } = getSettingsView(webDb());
  const msg = notice(await searchParams);

  return (
    <>
      <h1>Ajustes</h1>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}

      <h2>Floors, metas e pesos</h2>
      <form action={setSettingsAction}>
        <label>Delta (%)<input name="delta" defaultValue={s.delta} /></label>
        <label>Modo do delta<select name="deltaMode" defaultValue={s.deltaMode}>
          <option value="fixed">fixo</option><option value="measured">medido</option>
        </select></label>
        <label>Floor margem (%)<input name="floorMarginPct" defaultValue={s.floorMarginPct} /></label>
        <label>Floor margem (centavos)<input name="floorMarginCents" defaultValue={s.floorMarginCents} /></label>
        <label>Meta/dia (centavos)<input name="metaPerDayCents" defaultValue={s.metaPerDayCents} /></label>
        <label>Prazo da meta (dias)<input name="metaDays" defaultValue={s.metaDays} /></label>
        <label>Encalhado após (dias)<input name="metaStaleDays" defaultValue={s.metaStaleDays} /></label>
        <label>Preço máximo (centavos)<input name="maxPriceCents" defaultValue={s.maxPriceCents} /></label>
        <label>Digest (hora local)<input name="digestHourLocal" type="number" min="0" max="23" defaultValue={s.digestHourLocal} /></label>
        <label>Imposto (%)<input name="taxPct" defaultValue={s.taxPct} /></label>
        <label>Peso lucro<input name="weight_profit" defaultValue={s.weights.profit} /></label>
        <label>Peso liquidez<input name="weight_liquidity" defaultValue={s.weights.liquidity} /></label>
        <label>Peso confiança<input name="weight_confidence" defaultValue={s.weights.confidence} /></label>
        <label>Peso frescor<input name="weight_freshness" defaultValue={s.weights.freshness} /></label>
        <label>Taxi MELI (%)<input name="fee_meli" defaultValue={s.platformFeePct.meli} /></label>
        <label>Taxi OLX (%)<input name="fee_olx" defaultValue={s.platformFeePct.olx} /></label>
        <label>Taxi PagoFio (%)<input name="fee_pagofio" defaultValue={s.platformFeePct.pagofio} /></label>
        <button type="submit">Salvar</button>
      </form>

      <h2>Ambiente (.env)</h2>
      <p className="muted">Segredos ficam no `.env` da raiz, fora do banco e fora desta tela. Valores nunca são devolvidos ao navegador — apenas se estão configurados.</p>
      <table>
        <tbody>
          <tr><th>ntfy</th><td>{config.ntfyConfigured ? 'configurado' : 'não configurado'}</td></tr>
          <tr><th>Mercado Livre</th><td>{config.meliConfigured ? 'token presente' : 'sem token'}</td></tr>
          <tr><th>OmniRoute</th><td>{config.omnirouteConfigured ? 'chave presente' : 'sem chave (Fase D)'}</td></tr>
        </tbody>
      </table>
    </>
  );
}
