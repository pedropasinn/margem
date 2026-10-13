// Distribuição (J100): o nome do produto mora em distribuicao/produto.env, e os padrões no topo de
// instalar.sh e instalar.ps1 (usados quando o script é baixado sozinho) precisam bater com ele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (nome) => readFileSync(new URL(`../../distribuicao/${nome}`, import.meta.url), 'utf8');

function produto() {
  const valores = {};
  for (const linha of ler('produto.env').split(/\r?\n/u)) {
    const achado = /^([A-Z_]+)=(.*)$/u.exec(linha);
    if (achado) valores[achado[1]] = achado[2];
  }
  return valores;
}

const CHAVES = ['PRODUTO_NOME', 'PRODUTO_PROJETO', 'PRODUTO_IMAGEM', 'PRODUTO_RELEASE'];

test('instalar.sh tem os mesmos padrões de produto.env', () => {
  const env = produto();
  const sh = ler('instalar.sh');
  for (const chave of CHAVES) {
    const achado = new RegExp(`^PADRAO_${chave}='([^']*)'$`, 'mu').exec(sh);
    assert.ok(achado, `instalar.sh sem PADRAO_${chave}`);
    assert.equal(achado[1], env[chave], chave);
  }
});

test('instalar.ps1 tem os mesmos padrões de produto.env', () => {
  const env = produto();
  const ps = ler('instalar.ps1');
  for (const chave of CHAVES) {
    const achado = new RegExp(`^\\$PADRAO_${chave} = '([^']*)'\\r?$`, 'mu').exec(ps);
    assert.ok(achado, `instalar.ps1 sem $PADRAO_${chave}`);
    assert.equal(achado[1], env[chave], chave);
  }
});

test('os dois instaladores têm os mesmos subcomandos, inclusive "iniciar"', () => {
  const comandos = ['iniciar', 'login', 'estado', 'parar', 'atualizar', 'backup', 'restaurar', 'logs', 'desinstalar', 'arte'];
  const sh = ler('instalar.sh');
  const ps = ler('instalar.ps1');
  for (const comando of comandos) {
    assert.match(sh, new RegExp(`^\\s+(\\w+\\|)*${comando}(\\|\\w+)*\\) `, 'mu'), `instalar.sh sem ${comando}`);
    assert.match(ps, new RegExp(`'${comando}'`, 'u'), `instalar.ps1 sem ${comando}`);
  }
});

test('o nome do produto não se espalha pelo compose de distribuição', () => {
  const compose = ler('compose.yml');
  const nome = produto().PRODUTO_PROJETO;
  // As variáveis MARGEM_* são do código (servico/), não da marca; ficam de fora da conferência.
  const linhas = compose.split('\n').filter((linha) => !linha.trim().startsWith('#'))
    .map((linha) => linha.replace(/MARGEM_[A-Z_]+/gu, ''));
  assert.deepEqual(linhas.filter((linha) => linha.toLowerCase().includes(nome)), []);
  assert.match(compose, /127\.0\.0\.1:\$\{PORTA:-8730\}:\$\{PORTA:-8730\}/u, 'porta só no loopback, igual dentro e fora');
});
