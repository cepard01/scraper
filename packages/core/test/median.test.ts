import { describe, it, expect } from 'vitest';
import { medianCents, quantile, trimOutliers, keepFlags } from '../src/valuation/median';

describe('medianCents', () => {
  it('media de par usa os dois do meio', () => {
    expect(medianCents([100, 200, 300, 400])).toBe(250);
    expect(medianCents([300, 100, 400, 200])).toBe(250);
    // [100,200,300,400] da mediana exata: com esse par o Math.round do ramo par e
    // indistinguivel de nenhum round. A amostra de soma impar e o que prova que
    // medianCents nunca devolve centavo fracionario para as colunas integer.
    expect(medianCents([100, 201])).toBe(151);
  });
  it('vazio devolve null', () => {
    expect(medianCents([])).toBeNull();
  });
  it('n=1 devolve o proprio valor', () => {
    expect(medianCents([98_000])).toBe(98_000);
  });
});

describe('quantile', () => {
  it('p25/p75 por interpolacao linear, arredondado para centavo', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // p25 cai em 32.5 e p75 em 77.5: quantile devolve centavo inteiro porque o resultado
    // vai para as colunas p25Cents/p75Cents, e dinheiro neste projeto nunca tem fração.
    expect(quantile(v, 0.25)).toBe(33);
    expect(quantile(v, 0.75)).toBe(78);
  });
  it('amostra vazia devolve null, sem NaN', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('trimOutliers', () => {
  it('apara 10% das duas caudas com n>=7', () => {
    const values = [1_000, 10_000, 10_500, 11_000, 11_500, 12_000, 12_500, 13_000, 13_500, 90_000];
    const { kept, trimmed } = trimOutliers(values, 0.1);
    expect(trimmed).toContain(1_000);
    expect(trimmed).toContain(90_000);
    expect(kept.length).toBe(8);
    expect(kept.every((k) => k >= 10_000 && k <= 13_500)).toBe(true);
  });

  it('com n<7 nao apara por percentil, mas corta o >3x da mediana', () => {
    const { trimmed } = trimOutliers([500, 1_000, 1_100, 1_200, 30_000]);
    expect(trimmed).toEqual([30_000]);
  });

  it('com n<7 a guarda corta os dois lados: 1/3 abaixo da mediana tambem sai', () => {
    // o teste de cima so exercita a cauda alta: 500 >= 1100/3. Aqui a mediana e 3.100 e
    // o 300 esta abaixo de 3.100/3, entao trocar a guarda por apenas `v <= med * 3`
    // (o mutante que a revisao mediu como VIVEU) faz este it() gritar.
    const { kept, trimmed } = trimOutliers([3_000, 3_100, 3_200, 3_300, 300]);
    expect(trimmed).toEqual([300]);
    expect(kept).toEqual([3_000, 3_100, 3_200, 3_300]);
  });

  it('amostra identica nao se autodevora', () => {
    const { kept, trimmed } = trimOutliers([10_000, 10_000, 10_000]);
    expect(kept).toHaveLength(3);
    expect(trimmed).toHaveLength(0);
  });
});

describe('keepFlags', () => {
  it('marca por posicao, nao por valor', () => {
    // 12.000 aparece duas vezes; uma delas esta no meio da amostra e a outra e a cauda alta
    const values = [1_000, 12_000, 10_000, 11_000, 12_000, 13_000, 12_000, 12_500, 13_500, 90_000];
    const flags = keepFlags(values, 0.1);
    expect(flags.filter(Boolean)).toHaveLength(8);
    expect(flags[0]).toBe(false);   // o menor
    expect(flags[9]).toBe(false);   // o maior
    expect(flags[1]).toBe(true);    // 12.000 do meio sobrevive
    expect(flags.filter((f, i) => !f && values[i] === 12_000)).toHaveLength(0);
  });

  it('devolve um booleano por entrada, na ordem recebida', () => {
    expect(keepFlags([])).toEqual([]);
    expect(keepFlags([5_000])).toEqual([true]);
    expect(keepFlags([500, 1_000, 1_100, 1_200, 30_000])).toEqual([true, true, true, true, false]);
  });

  it('com n=7 o percentil de 10% e floor(0,7) = 0: nenhum indice e aparado', () => {
    // n = 7, 8 e 9 sao as unicas amostras em que floor e ceil de ratio 0.1 discordam
    // (floor 0 x ceil 1). Sem este it(), `Math.floor` -> `Math.ceil` no fonte passava
    // verde e um conjunto de sete comparaveis perdia as duas pontas por uma edicao.
    const sete = [1_000, 10_000, 10_500, 11_000, 11_500, 12_000, 90_000];
    expect(keepFlags(sete, 0.1)).toEqual([true, true, true, true, true, true, true]);
    expect(keepFlags([...sete, 13_000], 0.1)).toHaveLength(8);
    expect(keepFlags([...sete, 13_000], 0.1).every(Boolean)).toBe(true);
    expect(keepFlags([...sete, 13_000, 14_000], 0.1).some((f) => !f)).toBe(false);
    // e o outro lado da mesma fronteira, ja medido acima: em n = 10 o cut vira 1.
    expect(keepFlags([...sete, 13_000, 14_000, 15_000], 0.1).filter((f) => !f)).toHaveLength(2);
    // registrado: com n >= 7 o ramo ativo e o de percentil, entao a guarda absoluta de
    // 3x nao se aplica — o 90.000 do sete sobrevive por projeto, nao por descuido.
    expect(keepFlags(sete, 0.1)[6]).toBe(true);
  });

  it('trimOutliers e keepFlags sao a mesma regra vista por angulos diferentes', () => {
    const values = [1_000, 10_000, 10_500, 11_000, 11_500, 12_000, 12_500, 13_000, 13_500, 90_000];
    const flags = keepFlags(values, 0.1);
    const keptByFlag = values.filter((_, i) => flags[i]);
    expect(trimOutliers(values, 0.1).kept).toEqual([...keptByFlag].sort((a, b) => a - b));
  });
});
