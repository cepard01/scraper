import type { Grade } from './types';
import { normalizeCase } from './text';

const D = ['não liga', 'não funciona', 'defeituoso', 'com defeito', 'defeito em', 'quebrado',
  'tela quebrada', 'tela trincada', 'não aciona', 'para peça', 'pra peça', 'serve para peça',
  'apenas peça', 'somente peça', 'não liga mais', 'sem tela', 'não carrega'];

const A = ['lacrado', 'lacrada', 'nunca usado', 'nunca usou', 'novo em folha', 'com nf',
  'acompanha nf', 'lacre', 'selado', 'na caixa lacrado'];

const C = ['marcas de uso', 'marcas na carcaça', 'marcas', 'arranhão', 'arranhões', 'arranhado', 'detalhe',
  'descascado', 'amassado', 'bem usado', 'pouco conservado'];

const B = ['usado', 'usados', 'usada', 'seminovo', 'semi novo', 'pouco uso', 'poucos usos',
  'conservado', 'impecável', 'excelente estado', 'ótimo estado', 'bom estado', 'como novo'];

const hits = (text: string, keys: string[]): boolean => {
  const t = normalizeCase(text);
  return keys.some((k) => t.includes(normalizeCase(k)));
};

export function detectGrade(text: string): Grade {
  if (hits(text, D)) return 'D';
  if (hits(text, A)) return 'A';
  if (hits(text, C)) return 'C';
  if (hits(text, B)) return 'B';
  return 'B';
}
