import { loadConfig } from '@brique/core/config';
import { createMonitorAction, deleteMonitorAction, setActiveMonitorAction, updateMonitorAction } from '../../actions';
import { listMonitors } from '@brique/core/db/repo/monitors';
import { webDb } from '../../db';
import { dateTime, notice } from '../../view';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['celular', 'notebook', 'console', 'bicicleta', 'autopeca', 'outro'] as const;
const SOURCES = ['olx', 'meli', 'enjoei', 'facebook'] as const;

type Search = { error?: string | string[]; ok?: string | string[] };

export default async function MonitorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const cfg = loadConfig();
  const monitors = listMonitors(webDb());
  const msg = notice(await searchParams);

  return (
    <>
      <h1>Monitores</h1>
      {msg && <p className={msg.bad ? 'bad' : 'good'}>{msg.text}</p>}
      <p className="muted">Cadência mínima: 15 minutos (proteção contra bloqueio de IP).</p>

      <h2>Novo</h2>
      <form action={createMonitorAction}>
        <label>Rótulo<input name="label" placeholder="iphone 12 usado" required /></label>
        <label>Fonte<select name="source">{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Termo<input name="query" placeholder="iphone 12" required /></label>
        <label>Categoria<select name="category"><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Intervalo (min)<input name="intervalMinutes" type="number" min="15" defaultValue="30" required /></label>
        <label>Params (JSON)<textarea name="params" defaultValue="{}" rows={2} cols={40} /></label>
        <button type="submit">Adicionar</button>
      </form>

      <h2>Ativos e pausados</h2>
      {monitors.length === 0 ? <p className="muted">Nenhum monitor.</p> : (
        <table>
          <thead><tr><th>Monitor</th><th>Fonte / termo</th><th>Intervalo</th><th>Última passada</th><th>Yield</th><th>Ações</th></tr></thead>
          <tbody>{monitors.map((m) => (
            <tr key={m.id}>
              <td>
                <form action={updateMonitorAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="active" value={String(m.active)} />
                  <label>Rótulo<input name="label" defaultValue={m.label} /></label>
                  <label>Fonte<select name="source" defaultValue={m.source}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                  <label>Termo<input name="query" defaultValue={m.query} /></label>
                  <label>Categoria<select name="category" defaultValue={m.category ?? ''}><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                  <label>Intervalo<input name="intervalMinutes" type="number" min="15" defaultValue={m.intervalMinutes} /></label>
                  <label>Params<textarea name="params" defaultValue={JSON.stringify(m.params)} rows={2} cols={30} /></label>
                  <button type="submit">Salvar</button>
                </form>
              </td>
              <td>{m.source} · {m.query}</td>
              <td>{m.intervalMinutes} min</td>
              <td>{dateTime(m.lastRunAt, cfg.tz)}</td>
              <td>{m.lastYield}</td>
              <td>
                <form action={setActiveMonitorAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="active" value={String(!m.active)} />
                  <button type="submit" className="secondary">{m.active ? 'Pausar' : 'Ativar'}</button>
                </form>
                <form action={deleteMonitorAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" className="secondary">Excluir</button>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
