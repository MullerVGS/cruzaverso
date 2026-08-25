# Cruzaverso

Jogo web single-player em que palavras formam caminhos num atlas diário.

## Ao começar

- Leia `CONTEXT.md` para o vocabulário.
- Liste os nomes em `docs/adr/`; abra somente ADRs pertinentes à mudança.
- Obedeça ao `AGENTS.md` mais próximo do arquivo alterado.

## Mapa do código

- `src/generation/`: mundo determinístico e recorte jogável.
- `src/game/`: regras e estado puros.
- `src/ui/`: React, SVG e interação.
- `server/`: API, persistência e materialização.
- `content/`: catálogo PT-BR versionado.
- `test/e2e/`: jornadas reais no navegador.

## Invariantes

- Aleatoriedade jogável usa `SeededRandom`; nunca `Math.random()`.
- Geração e regras não dependem de React ou Fastify.
- Edição diária publicada é imutável; mudança incompatível exige migração explícita.
- IDs identificam conteúdo jogável, versões e configuração efetiva.
- Conteúdo runtime é local; geração não consulta internet nem IA.
- Testes exercitam interfaces públicas. Evite testar detalhe privado.

## Comandos

- `npm test`: testes unitários e de integração.
- `npm run test:e2e`: jornadas no navegador.
- `npm run build`: typecheck e build.
- `npm run validate:content`: contrato do catálogo.
- `npm run audit:editorial`: consistência editorial.
- `npm run capture:worldgen`: recria o GIF do README.

## Documentação

Be extremely concise. Sacrifice grammar for the sake of concision.

Registre decisão arquitetural somente se difícil de reverter, surpreendente ou com alternativa real. Nunca inclua runbook ou infraestrutura particular.
