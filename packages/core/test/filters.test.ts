import { describe, expect, it } from 'vitest';
import { normalizeTitle, passesRequireWords, requireWordsVerdict } from '../src/filters';

describe('passesRequireWords', () => {
  it('sem termos exigidos não filtra nada', () => {
    expect(passesRequireWords('Qualquer coisa', undefined)).toBe(true);
    expect(passesRequireWords('Qualquer coisa', [])).toBe(true);
  });

  it('aceita pelo menos um termo, como no watch ps5 do Scrapelytics', () => {
    const words = ['ps5', 'playstation 5', 'play 5'];
    expect(passesRequireWords('PS5 Slim lacrado', words)).toBe(true);
    expect(passesRequireWords('PlayStation 5 com caixa', words)).toBe(true);
    expect(passesRequireWords('PS4 Slim 1TB', words)).toBe(false);
    expect(passesRequireWords('iPhone 15 Pro', words)).toBe(false);
  });

  it('normaliza caixa, acentos e espaços repetidos', () => {
    expect(passesRequireWords('  POS    VENDA  iPhone ', ['pós venda'])).toBe(true);
    expect(passesRequireWords('Iphone 15', ['iphone 15'])).toBe(true);
    expect(normalizeTitle('  SÃO   Paulo ')).toBe('sao paulo');
  });

  it('termo vazio não autoriza tudo', () => {
    expect(passesRequireWords('PS4 Slim', ['', '   '])).toBe(false);
  });

  it('o veredito nomeia o motivo quando o título é fuzzy', () => {
    expect(requireWordsVerdict('iPhone 14', ['iphone 15'])).toEqual({ ok: false, reason: 'require-words' });
    expect(requireWordsVerdict('iPhone 15', ['iphone 15'])).toEqual({ ok: true });
  });
});
