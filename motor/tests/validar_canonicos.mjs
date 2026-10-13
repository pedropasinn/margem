// O validador do contrato é a autoridade, inclusive para invariantes semânticas.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validarCanonico, validarGeometria, conferirGeometria } from '../../contratos/src/index.ts';
for (const caminho of process.argv.slice(2)) {
  const canonico = JSON.parse(readFileSync(caminho, 'utf8'));
  if (!validarCanonico(canonico)) {
    console.error(caminho, validarCanonico.errors);
    process.exitCode = 1;
  } else {
    const arquivo = join(dirname(caminho), 'geometria.json');
    if (existsSync(arquivo)) {
      const geometria = JSON.parse(readFileSync(arquivo, 'utf8'));
      if (!validarGeometria(geometria) || !conferirGeometria(geometria, canonico)) {
        console.error(arquivo, validarGeometria.errors ?? 'Invariante contextual da geometria');
        process.exitCode = 1;
      }
    }
    console.log(`${caminho}: true`);
  }
}
