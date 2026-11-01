import { describe, it, expect } from 'vitest';
import { extractProduct } from '../src/product';

describe('extractProduct celular', () => {
  it('captura marca, modelo, capacidade e lock', () => {
    const p = extractProduct('iPhone 12 128GB Desbloqueado 90% bateria', 'usado, pouco uso');
    expect(p).toMatchObject({ category: 'celular', brand: 'apple', model: 'iphone 12', variant: '128gb-desbloqueado', grade: 'B', matched: true });
  });

  it('bloqueado de operadora é variante diferente', () => {
    const p = extractProduct('iPhone 11 64gb só na claro', '');
    expect(p.variant).toBe('64gb-claro');
    const d = extractProduct('iPhone 11 64gb desbloqueado', '');
    expect(d.variant).toBe('64gb-desbloqueado');
    expect(p.variant).not.toBe(d.variant);
  });

  it('sem capacidade declarada vira variante de condição e matched continua true', () => {
    const p = extractProduct('Samsung Galaxy A54 novo lacrado', '');
    expect(p.brand).toBe('samsung');
    expect(p.model).toBe('galaxy a54');
    expect(p.variant).toBe('lacrado');
    expect(p.grade).toBe('A');
  });

  it('palavra elogiosa não vira nome de operadora', () => {
    const p = extractProduct('iPhone 12 128gb otimo estado', '');
    expect(p.variant).toBe('128gb');
    expect(p.variant).not.toContain('tim');
  });

  it('pro e pro max são modelos diferentes', () => {
    const pro = extractProduct('iPhone 12 Pro 256GB', '');
    const max = extractProduct('iPhone 12 Pro Max 256GB', '');
    expect(pro.model).toBe('iphone 12 pro');
    expect(max.model).toBe('iphone 12 pro max');
    expect(pro.model).not.toBe(max.model);
  });

  it('plus escrito com sinal não se confunde com o modelo base', () => {
    const base = extractProduct('Galaxy S24 256GB', '');
    const plus = extractProduct('Galaxy S24+ 256GB', '');
    expect(base.model).toBe('galaxy s24');
    expect(plus.model).toBe('galaxy s24 plus');
    expect(plus.variant).toBe('256gb');
  });

  it('a variante pega o armazenamento, não a memória ram', () => {
    const a = extractProduct('Galaxy S24 12GB 256GB', '');
    const b = extractProduct('Galaxy S24 12GB 512GB', '');
    expect(a.variant).toBe('256gb');
    expect(b.variant).toBe('512gb');
    expect(a.model).toBe(b.model);
  });

  it('família solta sem número não vira modelo', () => {
    const semNumero = extractProduct('iPhone 128GB', '');
    expect(semNumero.model).toBeNull();
    expect(semNumero.matched).toBe(false);
    const somenteMarca = extractProduct('Galaxy', '');
    expect(somenteMarca.model).toBeNull();
    expect(somenteMarca.matched).toBe(false);
  });
});

describe('extractProduct outras categorias', () => {
  it('notebook usa cpu+ram+storage quando não há modelo de linha', () => {
    const p = extractProduct('Notebook Dell Inspiron i5 8GB 256SSD', '');
    expect(p).toMatchObject({ category: 'notebook', brand: 'dell', matched: true });
    expect(p.model).toMatch(/inspiron/);
  });

  it('console pega a geração', () => {
    const p = extractProduct('PlayStation 4 Slim 1TB com 2 controles', '');
    expect(p).toMatchObject({ category: 'console', brand: 'sony', model: 'ps4 slim' });
  });

  it('bicicleta pega aro', () => {
    const p = extractProduct('Bike Caloi Elite 29 aro 29 Shimano Deore', '');
    expect(p).toMatchObject({ category: 'bicicleta', brand: 'caloi' });
    expect(p.variant).toContain('aro29');
  });

  it('outro nunca entra em valoração: matched false', () => {
    const p = extractProduct('Cortador de grama', 'trator');
    expect(p.matched).toBe(false);
    expect(p.category).toBe('outro');
  });

  it('defeito desloca grade para D mesmo com elogio junto', () => {
    const p = extractProduct('iPhone 13 ótimo estado mas não carrega', '');
    expect(p.grade).toBe('D');
  });

  it('ps5 digital não é o ps5 de disco', () => {
    const digital = extractProduct('PlayStation 5 Digital Edition 1TB', '');
    const disco = extractProduct('PlayStation 5 825GB', '');
    expect(digital.model).toBe('ps5 digital');
    expect(disco.model).toBe('ps5');
    expect(digital.variant).toBe('1tb');
  });

  it('elite e elite carbon são modelos diferentes', () => {
    const carbon = extractProduct('Bike Caloi Elite Carbon aro 29', '');
    const aro = extractProduct('Bike Caloi Elite aro 29', '');
    expect(carbon.model).toBe('elite carbon');
    expect(aro.model).toBe('elite');
    expect(carbon.variant).toBe('aro29');
  });

  it('autopeca diferencia peça e geração na variante', () => {
    const g5 = extractProduct('Farol Gol G5 original', '');
    const g6 = extractProduct('Farol Gol G6 original', '');
    const bomba = extractProduct('Bomba gasolina Palio', '');
    expect(g5.variant).toBe('farolg5');
    expect(g6.variant).toBe('farolg6');
    expect(g5.variant).not.toBe(bomba.variant);
    expect(bomba.model).toBe('palio');
  });

  it('notebook separa por série, cpu e ram', () => {
    const a = extractProduct('Notebook Acer Aspire 3 i5 8GB 256SSD', '');
    const b = extractProduct('Notebook Acer Aspire 5 i7 16GB 512SSD', '');
    expect(a.model).toBe('aspire');
    expect(a.variant).toBe('256ssd-n3-i5-ram8gb');
    expect(b.variant).toBe('512ssd-n5-i7-ram16gb');
  });

  it('macbook air m1 e m2 não dividem o mesmo fingerprint', () => {
    const m1 = extractProduct('MacBook Air M1 256GB', '');
    const m2 = extractProduct('MacBook Air M2 256GB', '');
    expect(m1.model).toBe('macbook air');
    expect(m1.variant).toBe('256gb-m1');
    expect(m2.variant).toBe('256gb-m2');
  });

  it('notebook sem variante fica de fora da valoração', () => {
    const semVariante = extractProduct('Notebook Dell Inspiron usado', '');
    expect(semVariante.model).toBe('inspiron');
    expect(semVariante.variant).toBeNull();
    expect(semVariante.matched).toBe(false);
    const comCpu = extractProduct('Notebook Dell Inspiron i5 usado', '');
    expect(comCpu.matched).toBe(true);
  });
});
