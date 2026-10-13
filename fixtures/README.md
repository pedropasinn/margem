# Dados compartilhados de teste

Estas amostras são entradas dos testes atuais, não saídas geradas nem uma cópia
antiga da aplicação. Ficam na raiz porque são usadas por mais de um componente.

| Material | Uso |
| --- | --- |
| `unicode-dificil.md` e `colado.txt` | Canonização, contratos, API e testes de ponta a ponta. |
| `poesia/` | Extração de estrofes, preservação de versos e leitura de poemas. |
| `codex/` | Roteiros determinísticos de sucesso e falha do executor falso. |
| `manifest.json` | Caminhos, tamanhos e hashes do corpus local e de materiais externos. |

Casos específicos de um componente ficam junto dele, como os casos JSON em
`contratos/casos/` e os dados de interface em `web/tests/fixtures/`. Novas amostras
só devem entrar aqui quando forem compartilhadas ou integrarem o corpus comum.

Para conferir os materiais registrados no manifesto, a partir da raiz:

```sh
motor/.venv/bin/python tools/conferir-fixtures.py
```

O preflight executa a mesma conferência. Materiais externos ausentes geram avisos;
amostras locais ausentes ou hashes divergentes são falhas. Alterações intencionais
em amostras registradas exigem atualizar o manifesto e revisar os testes afetados.
Não guardar credenciais, documentos pessoais nem resultados de execução nesta pasta.
