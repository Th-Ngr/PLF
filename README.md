# Plantão Fácil — v0.1.0

Aplicação web local-first para registrar plantões, gerar escalas e acompanhar valores previstos e recebimentos.

## Recursos nesta primeira versão

- Cadastro manual, edição e exclusão de plantões.
- Geração por dias da semana.
- Geração por ciclo 12x36, 12x48 ou personalizado.
- Pré-visualização antes de salvar a escala.
- Aviso e exclusão da geração de plantões que conflitam com registros existentes.
- Resumo de plantões, horas e ganhos previstos.
- Controle de situação (programado, realizado, cancelado).
- Pagamentos parciais por plantão realizado.
- Resumo financeiro por mês.
- Persistência local usando IndexedDB.
- Exportação e restauração de backup JSON.
- Base de PWA e cache offline.

## Como executar no Windows com VS Code

O app usa JavaScript modules, IndexedDB e Service Worker. **Não abra o `index.html` com duplo clique (`file://`)**. Rode por um servidor local.

### Opção 1 — extensão Live Server
1. Abra a pasta `plantao-facil` no VS Code.
2. Instale a extensão **Live Server**, se ainda não tiver.
3. Clique com o botão direito em `index.html`.
4. Escolha **Open with Live Server**.

### Opção 2 — Python
Abra o terminal dentro da pasta do projeto e execute:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## Teste rápido

1. Em **Minha escala**, selecione segunda, quarta e sexta.
2. Escolha horário `07:00`, duração `12 horas`, valor `300`.
3. Defina o período e clique em **Pré-visualizar escala**.
4. Revise os conflitos e confirme.
5. Em **Plantões**, edite um registro e marque-o como **Realizado**.
6. Em **Financeiro**, registre um pagamento parcial e confira o saldo pendente.
7. Em **Backup**, exporte um JSON. Teste a restauração apenas depois de exportar uma cópia dos dados atuais.

## Limitações conhecidas da versão inicial

- Login Google e sincronização em nuvem ainda não foram implementados.
- O resumo financeiro é intencionalmente básico; regras trabalhistas, descontos, adicionais e impostos não são calculados.
- Pagamentos são vinculados a um plantão por vez.
- A contagem principal de “dias” equivale à quantidade de plantões, conforme decisão inicial do projeto.
- O modo semanal e o modo de ciclo são configurações separadas.
- A restauração substitui todos os registros atuais.
- O manifesto não inclui ícones próprios ainda; a instalação pode variar conforme o navegador.
- O armazenamento local não substitui backup. Limpar os dados do site pode apagar os registros.

## Estrutura

```text
plantao-facil/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── README.md
└── src/
    ├── app.js
    ├── core/
    │   ├── date-time.js
    │   ├── money.js
    │   └── schedule.js
    ├── infrastructure/
    │   └── storage/
    │       └── database.js
    └── styles/
        └── main.css
```

## Próximos passos recomendados

1. Validar regras financeiras e situações de cancelamento.
2. Criar testes automatizados para os cálculos de escala.
3. Adicionar ícones PWA.
4. Refinar o modelo de pagamentos para permitir um pagamento cobrir vários plantões.
5. Planejar a sincronização em nuvem sem acoplar a regra de negócio ao provedor.
