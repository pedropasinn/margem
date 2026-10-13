import { describe, expect, test } from 'vitest';
// O índice dos contratos arrasta o ajv e os schemas JSON, que o empacotador do web não serve;
// `regras` é o mesmo invariante textual que `conferirProgresso` aplica no serviço.
import { conferirTextoAncora, regrasAncora } from '@margem/contratos/regras';
import { ancoraDoPonto, pontoDaAncora, TAMANHO_DA_CITACAO } from './ancora';
import { capituloExemplo } from './fixtures/capitulo-exemplo';

const { blocos, versao_id: versao } = capituloExemplo;

describe('âncora de retomada', () => {
  test('todo deslocamento de todo bloco gera âncora que o serviço aceita', () => {
    for (const bloco of blocos) {
      for (let offset = 0; offset <= bloco.texto.length; offset++) {
        const ancora = ancoraDoPonto(blocos, versao, { bloco_id: bloco.id, offset_utf16: offset });
        expect(ancora).not.toBeNull();
        if (ancora === null) continue;
        expect(regrasAncora(ancora)).toBe(true);
        expect(conferirTextoAncora(bloco, ancora)).toBe(true);
        expect(ancora.versao_id).toBe(versao);
      }
    }
  });

  test('nenhum corte cai no meio de um par substituto', () => {
    const emoji = blocos.find((bloco) => bloco.texto.includes('🧭'));
    expect(emoji).toBeDefined();
    if (emoji === undefined) return;
    const baixo = /[\uDC00-\uDFFF]/u;
    for (let offset = 0; offset <= emoji.texto.length; offset++) {
      const ancora = ancoraDoPonto(blocos, versao, { bloco_id: emoji.id, offset_utf16: offset });
      if (ancora === null) continue;
      for (const pedaco of [ancora.citacao, ancora.prefixo, ancora.sufixo]) {
        expect(baixo.test(pedaco[0] ?? '')).toBe(false);
      }
    }
  });

  test('a citação tem o tamanho pedido e a volta devolve o mesmo ponto', () => {
    const bloco = blocos.find((candidato) => candidato.texto.length > TAMANHO_DA_CITACAO + 8);
    expect(bloco).toBeDefined();
    if (bloco === undefined) return;
    const ancora = ancoraDoPonto(blocos, versao, { bloco_id: bloco.id, offset_utf16: 4 });
    expect(ancora?.citacao).toHaveLength(TAMANHO_DA_CITACAO);
    expect(ancora === null ? null : pontoDaAncora(ancora)).toEqual({ bloco_id: bloco.id, offset_utf16: 4 });
  });

  test('bloco desconhecido não vira âncora', () => {
    expect(ancoraDoPonto(blocos, versao, { bloco_id: '0'.repeat(26), offset_utf16: 0 })).toBeNull();
  });
});
