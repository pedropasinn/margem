/** Uso offline: comparar-canonicos.ts antes/canonico.json depois/canonico.json */
import { validarCanonico } from '@margem/contratos';
import { compararCanonicos } from '@margem/core';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json';
const [a, b] = process.argv.slice(2);
try {
  if (!a || !b) throw new Error('Informe os dois arquivos canônicos.');
  const antes = await lerJsonLimitado(a, ORCAMENTOS.canonico), depois = await lerJsonLimitado(b, ORCAMENTOS.canonico);
  if (!validarCanonico(antes) || !validarCanonico(depois)) throw new Error('Canônico inválido.');
  console.log(JSON.stringify(compararCanonicos(antes, depois), null, 2));
} catch (erro) { console.error(erro instanceof Error ? erro.message : 'Falha na comparação.'); process.exitCode = 1; }
