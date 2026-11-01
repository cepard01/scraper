import type { Grade } from './types';
import { normalizeCase, stripSymbols } from './text';

// Chave casa no começo de uma palavra e por prefixo: 'usad' pega usado/usada/usados e não 'causado'.
const D = ['não liga', 'não funciona', 'não carrega', 'não aciona', 'defeito', 'defeituoso',
  'quebrad', 'tela trincada', 'sem tela', 'para peça', 'pra peça', 'apenas peça', 'somente peça', 'só peça'];

const A = ['lacrado', 'lacrada', 'selado', 'lacre', 'nunca usado', 'nunca usou', 'nunca utilizada',
  'novo em folha', 'sem uso', 'com nf', 'acompanha nf', 'na caixa lacrado'];

const C = ['marcas', 'marca de', 'arranh', 'risco', 'detalhe', 'descasc', 'amassad', 'trincad',
  'rachad', 'mordid', 'dano', 'danificad', 'avelhud', 'bem usado', 'pouco conserv', 'pouco cuidado'];

const B = ['usad', 'seminov', 'semi novo', 'pouco uso', 'poucos usos', 'conserv', 'impec',
  'excelente estado', 'ótimo estado', 'bom estado', 'como novo'];

// 'sem defeito' e 'não lacrado' afirmam AUSÊNCIA; se não saírem antes, 'defeito' (D) e 'lacre' (A) casam dentro delas.
const NEGATED = ['sem defeito', 'sem detalhe', 'sem marca', 'sem risco', 'sem avaria', 'sem dano',
  'sem lacre', 'sem sinais', 'não lacrado', 'não lacrada'];

const key = (k: string): string => ' ' + normalizeCase(k);

const KEYS = { D: D.map(key), A: A.map(key), C: C.map(key), B: B.map(key) };
const NEG = NEGATED.map(key);

const hits = (t: string, keys: string[]): boolean => keys.some((k) => t.includes(k));

export function detectGrade(text: string): Grade {
  let t = ' ' + stripSymbols(normalizeCase(text)).replace(/\s+/g, ' ');
  for (const n of NEG) t = t.split(n).join(' ');
  if (hits(t, KEYS.D)) return 'D';
  if (hits(t, KEYS.A)) return 'A';
  if (hits(t, KEYS.C)) return 'C';
  if (hits(t, KEYS.B)) return 'B';
  return 'B';
}
