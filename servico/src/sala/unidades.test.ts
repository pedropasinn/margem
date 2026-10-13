/** Peças da sala de teste sem banco: senha (scrypt), limite de tentativas, cookie assinado, CSV e trecho. */
import { describe, expect, test } from 'vitest';
import { celula } from './csv.js';
import { lerEntrada, resolverTrecho } from './entrada.js';
import { LimiteDeTentativas } from './limite.js';
import { conferirSenha, gerarSenha, gerarSlug, hashDaSenha, SLUG_VALIDO } from './senha.js';
import { cabecalhoDoCookie, lerCookie, novoCookie } from './sessao.js';

describe('senha', () => {
  test('guarda só o hash scrypt e confere em tempo constante', async () => {
    const hash = await hashDaSenha('cafe-com-leite');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain('cafe');
    expect(await conferirSenha('cafe-com-leite', hash)).toBe(true);
    expect(await conferirSenha('cafe-com-leitE', hash)).toBe(false);
    expect(await conferirSenha('', hash)).toBe(false);
    // Mesma senha, sal diferente.
    expect(await hashDaSenha('cafe-com-leite')).not.toBe(hash);
  });
  test('NFC: a mesma senha digitada com acento composto ou decomposto confere', async () => {
    const hash = await hashDaSenha('cafe\u0301-quente');
    expect(await conferirSenha('café-quente', hash)).toBe(true);
  });
  test('hash malformado ou com parâmetros absurdos é recusado sem lançar', async () => {
    for (const ruim of ['', 'bcrypt$x', 'scrypt$32768$8$1$$', 'scrypt$99999999$8$1$YWJj$YWJj', 'scrypt$32768$8$1$YWJj$']) {
      expect(await conferirSenha('qualquer-uma', ruim)).toBe(false);
    }
  });
  test('recusa senha curta demais para guardar', async () => {
    await expect(hashDaSenha('curta')).rejects.toThrow();
  });
  test('senha gerada é legível e slug é aleatório e válido', () => {
    const senhas = new Set(Array.from({ length: 50 }, gerarSenha));
    expect(senhas.size).toBe(50);
    for (const senha of senhas) expect(senha).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    const slug = gerarSlug();
    expect(slug).toMatch(SLUG_VALIDO);
    expect(slug).toHaveLength(12);
  });
});

describe('limite de tentativas', () => {
  test('dez falhas na janela bloqueiam; a janela anda; limpar zera a chave', () => {
    let agora = 0;
    const limite = new LimiteDeTentativas({ maximo: 10, janelaMs: 15 * 60_000, agora: () => agora });
    for (let i = 0; i < 9; i++) limite.registrarFalha(['ip:1', 'sala:x']);
    expect(limite.bloqueado(['ip:1'])).toBe(false);
    limite.registrarFalha(['ip:1', 'sala:x']);
    expect(limite.bloqueado(['ip:1'])).toBe(true);
    expect(limite.bloqueado(['ip:2', 'sala:x'])).toBe(true);
    expect(limite.bloqueado(['ip:2', 'sala:y'])).toBe(false);
    agora += 15 * 60_000 + 1;
    expect(limite.bloqueado(['ip:1', 'sala:x'])).toBe(false);
    limite.registrarFalha(['ip:3']);
    limite.limpar('ip:3');
    expect(limite.bloqueado(['ip:3'])).toBe(false);
  });
});

describe('reserva de tentativa', () => {
  test('a reserva conta na hora e, devolvida, sai da conta sem apagar as outras', () => {
    const limite = new LimiteDeTentativas({ maximo: 2, janelaMs: 60_000, agora: () => 5 });
    const primeira = limite.reservar(['sala:x']);
    limite.reservar(['sala:x']);
    expect(limite.bloqueado(['sala:x'])).toBe(true);
    primeira();
    primeira();
    expect(limite.bloqueado(['sala:x'])).toBe(false);
    limite.registrarFalha(['sala:x']);
    expect(limite.bloqueado(['sala:x'])).toBe(true);
  });
});

describe('cookie da sessão', () => {
  const chave = Buffer.alloc(32, 1);
  test('assinado com HMAC: confere com a chave certa, recusa adulteração e outra chave', () => {
    const cookie = novoCookie(chave, '01KAAAAAAAAAAAAAAAAAAAAAAA');
    const lido = lerCookie(chave, cookie.valor);
    expect(lido).toEqual({ sessaoId: '01KAAAAAAAAAAAAAAAAAAAAAAA', segredoSha256: cookie.segredoSha256 });
    expect(lerCookie(Buffer.alloc(32, 2), cookie.valor)).toBeNull();
    const [id, segredo, assinatura] = cookie.valor.split('.');
    expect(lerCookie(chave, `01KBBBBBBBBBBBBBBBBBBBBBBB.${segredo ?? ''}.${assinatura ?? ''}`)).toBeNull();
    // Troca o último caractere por outro: se ele já fosse 'A', trocar por 'A' não adulteraria nada (1 em 64).
    const ultimo = (assinatura ?? '').slice(-1) === 'A' ? 'B' : 'A';
    expect(lerCookie(chave, `${id ?? ''}.${segredo ?? ''}.${(assinatura ?? '').slice(0, -1)}${ultimo}`)).toBeNull();
    for (const ruim of [undefined, '', 'a.b', 'a.b.c.d', 'x'.repeat(500)]) expect(lerCookie(chave, ruim)).toBeNull();
  });
  test('atributos: HttpOnly, Secure, SameSite=Lax, Path=/ e Max-Age', () => {
    expect(cabecalhoDoCookie('v', 90.7)).toBe('margem_sala=v; Path=/; Max-Age=90; HttpOnly; Secure; SameSite=Lax');
  });
});

describe('entrada e trecho', () => {
  test('nome obrigatório, e-mail opcional e conferido, campos estranhos recusados', () => {
    expect(lerEntrada({ nome: '  Ana   Maria ', senha: 'x' })).toEqual({ nome: 'Ana Maria', email: null, senha: 'x' });
    expect(lerEntrada({ nome: 'Ana', email: 'ana@exemplo.com', senha: 'x' }).email).toBe('ana@exemplo.com');
    expect(() => lerEntrada({ nome: '', senha: 'x' })).toThrow();
    expect(() => lerEntrada({ nome: 'Ana', email: 'nao-e-email', senha: 'x' })).toThrow();
    expect(() => lerEntrada({ nome: 'Ana', senha: 'x', admin: true })).toThrow();
    expect(() => lerEntrada({ nome: 'Ana' })).toThrow();
  });
  test('o serviço resolve o trecho: fatia certa, ocorrência única, ou 422', () => {
    const bloco = { texto: 'um dois um três' };
    expect(resolverTrecho(bloco, { inicio_utf16: 3, fim_utf16: 7, citacao: 'dois' })).toEqual({ inicio_utf16: 3, fim_utf16: 7 });
    expect(resolverTrecho(bloco, { inicio_utf16: 0, fim_utf16: 4, citacao: 'três' })).toEqual({ inicio_utf16: 11, fim_utf16: 15 });
    expect(() => resolverTrecho(bloco, { inicio_utf16: 7, fim_utf16: 9, citacao: 'um' })).toThrow('citacao_ambigua');
    expect(() => resolverTrecho(bloco, { inicio_utf16: 0, fim_utf16: 4, citacao: 'cinco' })).toThrow();
    // Fim além do bloco não passa pela fatia cortada: vale a ocorrência única (auditoria 02/10).
    expect(resolverTrecho(bloco, { inicio_utf16: 11, fim_utf16: 100, citacao: 'três' })).toEqual({ inicio_utf16: 11, fim_utf16: 15 });
  });
});

describe('CSV', () => {
  test('aspas, quebras e proteção contra fórmula', () => {
    expect(celula('simples')).toBe('simples');
    expect(celula('com, vírgula')).toBe('"com, vírgula"');
    expect(celula('com "aspas"')).toBe('"com ""aspas"""');
    expect(celula('linha\nnova')).toBe('"linha\nnova"');
    expect(celula('=1+1')).toBe("'=1+1");
    expect(celula('-2')).toBe("'-2");
    expect(celula('@x')).toBe("'@x");
    expect(celula(-2)).toBe('-2');
    expect(celula(null)).toBe('');
  });
});
