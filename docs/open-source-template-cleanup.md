# Social Machine — plano de publicação open source

O projeto será publicado como um template auto-hospedado sob licença MIT.
Quem instalar usa sua própria infraestrutura, contas, chaves, dados e responde
por custos, conteúdo e automações ativadas.

## Regra de segurança

O repositório público será criado com histórico Git novo. Remover um segredo ou
dado do estado atual não o remove de commits antigos.

Antes da publicação, o template não pode conter:

- credenciais, tokens, chaves, dumps ou arquivos temporários de infraestrutura;
- IDs, URLs, domínios, aliases, handles ou dados da operação de origem;
- conteúdo, prompts, fatos comerciais, calendários, métricas ou assets de uma
  marca real;
- rotas, crons, scripts e seeds dedicados a uma marca ou workspace;
- configuração que publique conteúdo ou faça chamadas pagas automaticamente.

## O que será preservado

- schema, RLS, índices e mecanismos genéricos do banco;
- agentes, pipeline editorial, qualidade, deduplicação, vídeo e integrações;
- integrações opcionais, inicialmente inativas;
- testes de comportamento genérico e proteção contra regressões.

## Critérios de aceite da limpeza

1. Não há identificadores, marca, domínio, conteúdo ou dados da operação de
   origem no repositório público.
2. Não há arquivos de ambiente, chaves, dumps, dados temporários ou histórico
   Git da origem.
3. Não existe workspace padrão embutido no código, migrations, cron ou script.
4. Cron jobs e publicação externa ficam desativados por padrão.
5. Cada integração falha de modo seguro e explica a configuração ausente.
6. Uma instalação em banco e projeto de deploy novos passa build e testes sem
   acessar infraestrutura externa da origem.

## Sequência de entrega

1. Limpeza e generalização do template.
2. Auditoria de segredos, dados e comportamento de publicação.
3. Documentação pública: instalação, segurança, custos, integrações e licença.
4. Onboarding para criação do primeiro workspace e configuração de módulos.
