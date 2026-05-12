# Nogle Mestre

Bem-vindo ao **Nogle Mestre**, um ambiente de trabalho visual e infinito (Canvas) para orquestrar múltiplos Agentes de Inteligência Artificial de forma intuitiva, inspirado na arquitetura Maestro.

Em vez de usar scripts invisíveis de terminal para gerenciar seus agentes, aqui você **desenha o fluxo de pensamento** conectando Notas e Agentes com fios!

---

## Primeiros Passos (Instalação do Zero)

Siga este passo a passo na ordem. Você só precisa fazer isso uma vez.

### Passo 1 — Instalar o Node.js

O projeto roda em cima do Node.js. Se você ainda não tem instalado:

1. Acesse **https://nodejs.org**
2. Baixe a versão **LTS** (recomendada)
3. Execute o instalador e avance com as opções padrão
4. Para confirmar a instalação, abra o PowerShell ou Prompt de Comando e digite:
   ```
   node -v
   ```
   Deve aparecer algo como `v20.x.x`.

---

### Passo 2 — Instalar as dependências do projeto

Abra o PowerShell **dentro da pasta do projeto** (clique com o botão direito na pasta > "Abrir no Terminal") e execute os três comandos abaixo, um de cada vez:

```powershell
npm install
```
```powershell
cd backend
npm install
cd ..
```
```powershell
cd frontend
npm install
cd ..
```

Aguarde cada um terminar antes de rodar o próximo.

---

### Passo 3 — Configurar a chave de API da Anthropic

O Alcune Mestre usa o Claude (IA da Anthropic) para processar as tarefas dos Agentes. Para isso você precisa de uma chave de API.

**Como obter a chave:**

1. Acesse **https://console.anthropic.com** e crie uma conta (gratuita)
2. No menu lateral, clique em **API Keys**
3. Clique em **Create Key**, dê um nome qualquer e copie a chave gerada
   - Ela começa com `sk-ant-...`
   - Guarde em lugar seguro, pois só aparece uma vez

**Como configurar no projeto:**

1. Dentro da pasta `backend/`, existe um arquivo chamado `.env`
2. Abra esse arquivo em qualquer editor de texto (Bloco de Notas, VS Code, etc.)
3. Substitua `sua_chave_aqui` pela sua chave:
   ```
   ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui
   ```
4. Salve o arquivo

> **Sobre custos:** A API tem custo por uso (cobrado por tokens). Novos usuários geralmente recebem créditos gratuitos. O modelo mais econômico disponível é o **Haiku 4.5**, selecionável dentro de cada Agente.

---

### Passo 4 — Iniciar o projeto

Com tudo configurado, basta dar dois cliques no arquivo:

```
start.bat
```

Dois terminais vão abrir (um para o backend, outro para o frontend). Quando ambos estiverem rodando, acesse no navegador:

```
http://localhost:5173
```

---

## Arquitetura — Onde cada coisa fica salva

| O que | Onde | Detalhe |
|---|---|---|
| Posição dos nós no canvas | `layout.json` | Salvo automaticamente ao arrastar ou conectar |
| Workspaces adicionais | `layout-nome.json` | Um arquivo por workspace |
| Textos das Notas | `vault/` | Cada nota é um arquivo `.md` |
| Chave de API | `backend/.env` | Nunca compartilhe este arquivo |
| Terminais | Memória volátil | O histórico de texto não é salvo ao reiniciar |

---

## As Ferramentas do Canvas

### Nota
A memória do sistema. Todo texto gerado pela IA ou escrito por você é salvo como um arquivo `.md` dentro da pasta `vault/`.

- O nome exibido no cabeçalho é derivado automaticamente da primeira linha do conteúdo
- Clique no lápis para editar; clique no check para salvar no disco
- Use o botão de recarga para sincronizar caso o conteúdo tenha sido alterado externamente
- Durante a geração de um Agente, o texto aparece em tempo real com um cursor piscando

### Agente IA
O motor do sistema. Conectado a notas, ele envia o conteúdo para o Claude e escreve a resposta de volta.

- **Entrada (lado esquerdo):** conecte uma ou mais Notas com as instruções ou contexto
- **Saída (lado direito):** conecte a Nota onde a resposta será escrita
- **Modelo:** escolha entre Haiku (rápido), Sonnet (equilibrado) ou Opus (mais poderoso)
- **System Prompt:** define o papel do agente (ex: *"Você é um programador Python"*)
- O botão **Parar** interrompe a geração a qualquer momento

### Terminal
Uma janela direta para o PowerShell do seu Windows.

- Duplo-clique no nome para renomear
- Use para testar o código que os Agentes geraram nas Notas
- Os terminais têm acesso real à sua máquina

### Texto
Post-it simples sem persistência no vault. Útil para anotações temporárias, comentários no canvas e labels visuais. Disponível em 4 cores.

### Árvore de Arquivos
Painel de visualização dos arquivos do projeto, sem precisar abrir o Explorador de Arquivos do Windows.

---

## Workspaces

A sidebar esquerda gerencia seus workspaces (projetos). Cada workspace tem seu próprio canvas independente.

- Clique em um workspace para alternar (o layout atual é salvo automaticamente)
- Clique em **Novo Workspace** para criar um projeto separado
- Clique no ícone de lixeira para excluir (o workspace `default` não pode ser excluído)

---

## Atalhos

| Ação | Como |
|---|---|
| Remover nó selecionado | `Delete` ou `Backspace` |
| Renomear terminal | Duplo-clique no nome |
| Redimensionar qualquer nó | Arrastar as bordas ou cantos |
| Panorâmica do canvas | Arrastar o fundo com o mouse |
| Zoom | Scroll do mouse |
| Minimap | Canto inferior direito |

---

## Fluxo de trabalho recomendado

```
[Nota: Ideia/Objetivo]
        |
        v
[Agente: Maestro] --> [Nota: plano.md]
                              |
              ┌───────────────┼───────────────┐
              v               v               v
       [Agente HTML]   [Agente CSS]   [Agente JS]
              |               |               |
              v               v               v
       [Nota: index.html] [Nota: style.css] [Nota: script.js]
                                    |
                                    v
                           [Terminal: testar]
```

1. Crie uma Nota com sua ideia
2. Conecte a um Agente Maestro que gera o plano
3. A partir do plano, crie Agentes especializados em paralelo
4. Cada Agente escreve em sua Nota de saída
5. Use um Terminal para rodar ou testar o resultado

---

> **Aviso de segurança:** Os terminais têm acesso real ao seu computador. Nunca cole comandos de fontes desconhecidas diretamente neles.
