import { describe, it, expect } from 'vitest';
import { classifyCategory, matchBrand } from '../src/category';

describe('classifyCategory', () => {
  it('celular vence notebook quando ambos batem, por peso', () => {
    expect(classifyCategory('iPhone 12 128GB', 'celular apple')).toBe('celular');
  });

  it('notebook', () => {
    expect(classifyCategory('Notebook Dell Inspiron i5 8GB 256SSD', '')).toBe('notebook');
  });

  it('console', () => {
    expect(classifyCategory('PlayStation 4 Slim 1TB', '')).toBe('console');
  });

  it('bicicleta', () => {
    expect(classifyCategory('Bike Caloi Elite 29 aro 29', '')).toBe('bicicleta');
    expect(classifyCategory('Bicicleta aro 26 aro 26', '')).toBe('bicicleta');
  });

  it('autopeca', () => {
    expect(classifyCategory('Farol Gol G5 original com lentes', '')).toBe('autopeca');
  });

  it('outro quando nada casa', () => {
    expect(classifyCategory('Cortador de grama TRAMONTINA 40cm', 'trator')).toBe('outro');
  });

  it('exclude veta quando o acessório abre o título', () => {
    expect(classifyCategory('Capinha para iPhone 12', 'acessório')).not.toBe('celular');
    expect(classifyCategory('Controle PS4 Slim original', 'novo lacrado')).not.toBe('console');
    expect(classifyCategory('Carregador notebook Dell 65w', 'original')).not.toBe('notebook');
  });

  it('bundle continua sendo o produto: o acessório citado depois não veta', () => {
    expect(classifyCategory('iPhone 12 128GB com capinha e fone', '')).toBe('celular');
    expect(classifyCategory('PlayStation 4 Slim 1TB com 2 controles', 'acompanha headset')).toBe('console');
    expect(classifyCategory('Notebook Dell Inspiron i5 8GB 256SSD', 'vai com mochila')).toBe('notebook');
  });
});

describe('matchBrand', () => {
  it('resolve alias para canonico', () => {
    expect(matchBrand('iphone 12 128gb', 'celular')).toBe('apple');
    expect(matchBrand('moto g32 64gb', 'celular')).toBe('motorola');
    expect(matchBrand('galaxy a54', 'celular')).toBe('samsung');
    expect(matchBrand('caloi elite 29', 'bicicleta')).toBe('caloi');
  });

  it('retorna null sem marca conhecida', () => {
    expect(matchBrand('notebook i5 usado', 'notebook')).toBeNull();
  });

  it('alias terminado em espaco casa mesmo colado em pontuacao', () => {
    expect(matchBrand('smartphone (lg) g8x', 'celular')).toBe('lg');
    expect(matchBrand('bike aro 29 (gt) shimano', 'bicicleta')).toBe('gt');
  });
});
