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

  it('pro max no fim do nome não é cortado pelo budget', () => {
    const pro = extractProduct('Xiaomi Redmi Note 13 Pro 256GB', '');
    const max = extractProduct('Xiaomi Redmi Note 13 Pro Max 256GB', '');
    expect(max.model).toBe('xiaomi redmi note 13 pro max');
    expect(pro.model).not.toBe(max.model);

    const pro5g = extractProduct('Redmi Note 13 Pro 5G 256GB', '');
    const max5g = extractProduct('Redmi Note 13 Pro Max 5G 256GB', '');
    expect(max5g.model).not.toBe(pro5g.model);
    expect(max5g.variant).toBe('256gb-5g');
  });

  it('pro+ com sinal é outro modelo, não o pro', () => {
    const plus = extractProduct('Redmi Note 13 Pro+ 5G 256GB', '');
    const pro = extractProduct('Redmi Note 13 Pro 5G 256GB', '');
    expect(plus.model).toBe('redmi note 13 pro plus');
    expect(plus.model).not.toBe(pro.model);
    expect(plus.variant).toBe('256gb-5g');
    // o sinal adjacente a dígito continua virando plus (S24+)
    expect(extractProduct('Galaxy S24+ 256GB', '').model).toBe('galaxy s24 plus');
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

describe('correções de fingerprint (round 1)', () => {
  it('R52: + separado por espaço não vira sufixo plus', () => {
    const espacado = extractProduct('iPhone 14 + 128GB', '');
    const plus = extractProduct('iPhone 14 Plus 128GB', '');
    expect(espacado.model).toBe('iphone 14');
    expect(espacado.variant).toBe('128gb');
    expect(espacado.model).not.toBe(plus.model);
  });

  it('R53: rede declarada entra na variante do celular', () => {
    const net4 = extractProduct('Redmi Note 12 4G 128GB', '');
    const net5 = extractProduct('Redmi Note 12 5G 128GB', '');
    expect(net4.model).toBe(net5.model);
    expect(net4.variant).toBe('128gb-4g');
    expect(net5.variant).toBe('128gb-5g');
  });

  it('R53: rede não declarada não é inferida', () => {
    const p = extractProduct('Galaxy S24 256GB', '');
    expect(p.variant).toBe('256gb');
  });

  it('R54: cabeça de lista no meio da corrida não consome orçamento', () => {
    const pro = extractProduct('Xiaomi Redmi Note 13 Pro 5G 256GB', '');
    const base = extractProduct('Xiaomi Redmi Note 13 5G 256GB', '');
    expect(pro.model).toBe('xiaomi redmi note 13 pro');
    expect(pro.model).not.toBe(base.model);
  });

  it('R55: nome de peça casa na fronteira da palavra', () => {
    const p = extractProduct('Importado Gol Radiador', '');
    expect(p.variant).toBe('radiador');
    expect(p.matched).toBe(true);
  });

  it('R55: porta na fronteira válida mantém a geração na variante', () => {
    const p = extractProduct('Porta Gol G5', '');
    expect(p.variant).toBe('portag5');
    expect(p.matched).toBe(true);
  });

  it('R56: autopeça sem peça nomeada fica fora da valoração', () => {
    const p = extractProduct('Peça Gol G5', '');
    expect(p.variant).toBeNull();
    expect(p.matched).toBe(false);
  });

  it('R57: identidade vem do título, atributos vêm do título mais descrição', () => {
    const p = extractProduct('iPhone 12 128GB', 'desbloqueado, aceito troca por 13 pro max 512gb');
    expect(p.model).toBe('iphone 12');
    expect(p.variant).toBe('128gb-desbloqueado');
  });

  it('R58: x5 de celular não é chip de notebook', () => {
    const p = extractProduct('Poco X5 Pro 256GB', '');
    expect(p.model).toBe('poco x5 pro');
    expect(p.variant).toBe('256gb');
    expect(p.matched).toBe(true);
  });

  it('R59: lacrados no plural não vaza para o modelo e canonicaliza o slug', () => {
    const p = extractProduct('Samsung Galaxy A54 lacrados', '');
    expect(p.model).toBe('galaxy a54');
    expect(p.variant).toBe('lacrado');
    expect(p.matched).toBe(true);
  });

  it('R59: lacrada no feminino vira o slug lacrado', () => {
    const p = extractProduct('iPhone 11 nova lacrada', '');
    expect(p.variant).toBe('lacrado');
  });
});
