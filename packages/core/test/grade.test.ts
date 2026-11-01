import { describe, it, expect } from 'vitest';
import { detectGrade } from '../src/grade';

describe('detectGrade', () => {
  it('D vence tudo quando ha indicio de defeito ou peça', () => {
    expect(detectGrade('iPhone 12 bom estado, ótimo, mas a tela não liga')).toBe('D');
    expect(detectGrade('serve para peças')).toBe('D');
    expect(detectGrade('notebook com defeito na placa')).toBe('D');
  });

  it('A exige lacrado/novo sem uso', () => {
    expect(detectGrade('iPhone 12 lacrado na caixa com NF')).toBe('A');
    expect(detectGrade('notebook novo em folha, nunca usado')).toBe('A');
  });

  it('C são marcas e detalhes; B é usado em bom estado', () => {
    expect(detectGrade('usado com marcas de uso')).toBe('C');
    expect(detectGrade('detalhes na carcaça')).toBe('C');
    expect(detectGrade('usado, pouco uso, conservado')).toBe('B');
    expect(detectGrade('seminovo impecável')).toBe('B');
  });

  it('default B quando nada casa', () => {
    expect(detectGrade('iPhone 12 128gb')).toBe('B');
  });

  it('casa palavra-chave acentuada mesmo com texto normalizado sem acento', () => {
    expect(detectGrade('aparelho com defeito na tela')).toBe('D');
    expect(detectGrade('ótimo estado')).toBe('B');
    expect(detectGrade('carcaça com arranhões')).toBe('C');
  });

  it('negação de defeito não vira defeito', () => {
    expect(detectGrade('iphone 12 não lacrado, mas funcionando')).toBe('B');
    expect(detectGrade('notebook bom estado, sem detalhes')).toBe('B');
    expect(detectGrade('bike aro 29 sem marcas de uso')).toBe('B');
    expect(detectGrade('geladeira sem defeito, gelando normal')).toBe('B');
  });

  it('defeito e dano sem frase feita caem na grade certa', () => {
    expect(detectGrade('aparelho apresenta defeito')).toBe('D');
    expect(detectGrade('notebook com dano causado por queda')).toBe('C');
    expect(detectGrade('carcaça amassada e descascada')).toBe('C');
    expect(detectGrade('celular com riscos e tela rachada')).toBe('C');
  });

  it('radical cobre flexão de gênero e número', () => {
    expect(detectGrade('capa bem conservada')).toBe('B');
    expect(detectGrade('mesa de cabeceira quebrada')).toBe('D');
    expect(detectGrade('iphone 12 sem uso, na caixa lacrado')).toBe('A');
  });
});
