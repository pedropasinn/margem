/**
 * Aplica a escolha de modelo e esforço por categoria (V-T10) a cada chamada do Codex.
 *
 * Embrulha o executor do worker por fora da auditoria: o `metadados.json` da tentativa já registra o
 * modelo e o esforço pedidos depois da troca, e a `preferencia` que os trocou. Cada manipulador
 * continua pedindo o seu padrão (o `-m` de `MARGEM_MODELO`, o esforço do tipo); quando a pessoa
 * escolheu algo para a categoria do job em curso, o valor dela substitui o do manipulador. Fora de um
 * job (testes de unidade, ferramentas) ou se a leitura das preferências falhar, nada muda.
 *
 * Modelo recusado pela conta: a falha passa a nomear o modelo e sugerir voltar ao padrão.
 */
import { jobEmCurso } from '../executor/contexto-do-job.js';
import { CAUSA_MODELO_INDISPONIVEL } from '../executor/stderr.js';
import type { Executor, ResultadoExecutor } from '../executor/tipos.js';
import { categoriaDoTipo } from './categorias.js';
import type { EscolhasDeModelo } from './preferencias.js';

export function causaDoModeloIndisponivel(modelo: string): string {
  return `O modelo ${modelo} não está disponível na sua conta. Em Configurações → Modelos, volte ao Padrão do Margem.`;
}

function trocarCausa(resultado: ResultadoExecutor, modelo: string): ResultadoExecutor {
  if (resultado.estado !== 'falhou' || resultado.detalhe?.causa !== CAUSA_MODELO_INDISPONIVEL) return resultado;
  const causa = causaDoModeloIndisponivel(modelo);
  return { ...resultado, mensagem: causa, detalhe: { ...resultado.detalhe, causa } };
}

export function executorComModelos(executor: Executor, lerEscolhas: () => Promise<EscolhasDeModelo>): Executor {
  return async (pedido) => {
    const job = jobEmCurso();
    const categoria = job === undefined ? undefined : categoriaDoTipo(job.tipo);
    if (categoria === undefined) return executor(pedido);
    let escolhas: EscolhasDeModelo;
    try {
      escolhas = await lerEscolhas();
    } catch {
      return executor(pedido);
    }
    const escolha = escolhas[categoria.id];
    if (escolha === undefined || (escolha.modelo === null && escolha.esforco === null)) return executor(pedido);
    const resultado = await executor({
      ...pedido,
      ...(escolha.modelo === null ? {} : { modelo: escolha.modelo }),
      ...(escolha.esforco === null ? {} : { esforco: escolha.esforco }),
      preferencia: { categoria: categoria.id, modelo: escolha.modelo, esforco: escolha.esforco },
    });
    return escolha.modelo === null ? resultado : trocarCausa(resultado, escolha.modelo);
  };
}
