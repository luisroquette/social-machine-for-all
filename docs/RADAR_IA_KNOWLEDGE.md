# RADAR IA — Knowledge Base

> **Propósito:** Base de conhecimento operacional para o radar de breaking news em IA. Consultar este arquivo ao implementar: ingestão, classificação, scoring, dedup, geração de newsletter.

> **Escopo:** Global (EN + CN + BR). Fonte primária: X/Twitter. Uso final: curadoria editorial para newsletter.

> **Stack alvo:** TypeScript + Supabase + Railway + Vercel + Claude (Haiku classificador / Sonnet redator) + TwitterAPI.io (ingestão).

---

## 1. Princípios de Scoring

### 1.1 Fórmula base

```
peso_fonte = autoridade × velocidade_histórica × proximidade_núcleo ÷ ruído
score_tweet = peso_fonte × multiplicador_keyword × aceleração_viral × recência ÷ similaridade_publicados
```

### 1.2 Regras de decisão

- Peso **não** é popularidade. É probabilidade de mover o mercado em 48h.
- Conta pequena que leaka features antes > conta grande que só retuíta.
- Toda keyword de alto ruído (`GPT`, `Claude`, `AI`) exige operador (`min_faves`, `list:`, ou `from:`).
- Se tweet vem de Camada 1-2 + Camada A (gatilho de lançamento), score mínimo = 85 (quase nunca descartar).

### 1.3 Threshold recomendados

| Ação | Score mínimo |
|---|---|
| Descartar silenciosamente | < 30 |
| Armazenar sem alerta | 30-60 |
| Ir para dashboard de curadoria | 60-84 |
| Alertar P1 (digest do dia) | 85-94 |
| Alertar P0 (push imediato) | ≥ 95 |

---

## 2. Fontes (Contas do X) — 10 Camadas

> **Formato:** cada conta tem `peso_base` (1-10). Pipeline deve armazenar em `accounts` table.

### Camada 1 — Labs de fronteira (peso 10)

**OpenAI:** @OpenAI, @sama, @gdb, @kevinweil, @miramurati, @npew, @willdepue, @polynoamial, @markchen90
**Anthropic:** @AnthropicAI, @jackclarkSF, @alexalbert__, @sleepinyourhat, @DarioAmodei
**Google DeepMind:** @GoogleDeepMind, @demishassabis, @JeffDean, @OriolVinyalsML, @quocleix, @sundarpichai
**Meta AI:** @AIatMeta, @ylecun, @soumithchintala, @tydsh
**xAI:** @xai, @elonmusk, @grok, @ibab
**Mistral:** @MistralAI, @arthurmensch, @GuillaumeLample
**Cohere:** @cohere, @aidangomez, @nickfrosst
**NVIDIA:** @nvidia, @jensenhuang, @drjimfan
**AMD:** @AMD, @LisaSu
**Apple:** @tim_cook, @Apple

**China:** @deepseek_ai, @Alibaba_Qwen, @JustinLin610, @moonshotai, @Kimi_Moonshot, @Zai_org, @thukeg, @baichuanAI, @01AI_Yi, @kaifulee, @BytedanceTalk, @Kling_ai, @MiniMax__, @Hailuo_AI, @TXhunyuan, @StepFun_ai

### Camada 2 — Insiders que vazam features (peso 9)

@karpathy, @testingcatalog, @apples_jimmy, @btibor91, @legit_rumors, @bedros_p, @minchoi, @rowancheung, @AndrewCurran_, @DimitrisPapail, @_philschmid, @osanseviero, @abacaj

### Camada 3 — Pesquisa e papers (peso 8)

@_akhaliq, @arxiv_daily, @arxiv_cs_CL, @arxiv_cs_LG, @huggingface, @ClementDelangue, @Thom_Wolf, @PapersWithCode, @hardmaru, @giffmana, @arankomatsuzaki, @sainingxie, @YiMaTweets, @percyliang, @tatsu_hashimoto, @srush_nlp, @MIT_CSAIL, @StanfordAILab, @berkeley_ai

### Camada 4 — Benchmarks e voz técnica independente (peso 8)

@lmsysorg, @ArtificialAnlys, @scaling01, @teortaxesTex, @natolambert, @Francis_YAO_, @Tim_Dettmers, @nrehiew_, @EpochAIResearch

### Camada 5 — Mídia e jornalismo (peso 7-8)

@TheInformation, @steph_palazzolo, @amir, @TechCrunch, @kylelwiggers, @theverge, @alexeheath, @WIRED, @WillKnight, @ashleevance, @shirindghaffary, @cademetz, @kevinroose, @Reuters, @FT, @SemiAnalysis_ (boost para 9 em posts), @deedydas

### Camada 6 — Builders e ecossistema dev (peso 6-7)

@swyx, @simonw, @levelsio, @mckaywrigley, @skirano, @Teknium1, @theo, @shaoruu, @pashmerepat, @cursor_ai, @windsurf_ai, @Replit, @amasad, @LangChainAI, @LlamaIndex, @vercel, @rauchg, @Supabase, @kiwicopple

### Camada 7 — Capital e M&A (peso 6)

@a16z, @martin_casado, @bgurley, @pmarca, @sarahtavel, @elad_gil, @natfriedman, @danielgross, @semaphore, @garrytan, @Sequoia, @sonyatweetybird, @pkedrosky

### Camada 8 — Brasil / LatAm (peso 5-7)

**Vozes:** @filipe_deschamps, @diolinux, @akitando, @sandeco, @jonnysfreitas, @brainercomputes, @diariodoestadoai, @leticia_gasparini
**Aplicação corporativa BR:** @Magalu, @Nubank, @StoneCo, @iFood
**Regulação:** @ANPDgovbr

### Camada 9 — Vídeo e agentes (peso 7)

@runwayml, @c_valenzuelab, @pika_labs, @luma_ai, @heygen_official, @synthesiaIO, @SakanaAILabs, @browser_use, @adept_ai

### Camada 10 — Contrarians e ângulo único (peso 5)

@GaryMarcus, @fchollet, @EMostaque, @emilymbender, @tszzl, @ESYudkowsky, @robbensinger, @davidad

---

## 3. Polling Strategy por Camada

| Camada | Intervalo |
|---|---|
| 1, 2 | 60 segundos |
| 3, 4, 5 | 5 minutos |
| 6, 7, 8, 9, 10 | 15 minutos |

---

## 4. Keywords — 5 Tipos Funcionais

### 4.1 Estrutura no DB

```sql
CREATE TABLE keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  lang text NOT NULL,              -- 'en', 'pt', 'zh', 'multi'
  category text NOT NULL,          -- 'launch_trigger', 'product_name', 'technical', 'magnitude', 'speed', 'paper', 'business', 'regional'
  weight numeric NOT NULL,         -- 1-10
  requires_operator boolean DEFAULT false,
  noise_level text NOT NULL,       -- 'low', 'medium', 'high'
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

### 4.2 Camada A — Gatilhos de Lançamento (category: `launch_trigger`)

#### Inglês

| Term | Weight | Noise | Notes |
|---|---|---|---|
| `introducing` | 10 | low | Padrão OpenAI/Anthropic |
| `announcing` | 10 | low | Padrão Google/Meta |
| `we're releasing` | 10 | low | |
| `we are releasing` | 10 | low | |
| `available today` | 10 | low | GA, não preview |
| `launching today` | 10 | low | |
| `shipping` | 9 | medium | Cultura OpenAI |
| `shipped` | 9 | medium | |
| `rolling out` | 8 | medium | Feature gradual |
| `now live` | 8 | medium | |
| `in preview` | 8 | low | |
| `early access` | 8 | low | |
| `general availability` | 9 | low | |
| `GA` | 9 | high | Requires operator |
| `open sourcing` | 9 | low | |
| `open-sourced` | 9 | low | |
| `releasing weights` | 10 | low | |
| `model weights` | 10 | low | |
| `new model` | 8 | high | Requires `min_faves:200` |
| `world's first` | 6 | high | Marketing |
| `state of the art` | 9 | medium | |
| `SOTA` | 9 | medium | |
| `outperforms` | 8 | low | |
| `beats GPT` | 9 | low | |
| `beats Claude` | 9 | low | |
| `beats Gemini` | 9 | low | |
| `breakthrough` | 6 | high | Hype |

#### Chinês (simplificado)

| Term | Translation | Weight | Noise |
|---|---|---|---|
| `发布` | lançar/publicar | 10 | medium |
| `推出` | lançar/introduzir | 10 | medium |
| `上线` | ir ao ar | 9 | medium |
| `开源` | open source | 10 | low |
| `正式发布` | lançamento oficial | 10 | low |
| `首发` | estreia | 9 | low |
| `震撼发布` | lançamento impactante | 7 | high |
| `超越` | superar | 8 | medium |
| `最强` | o mais forte | 7 | high |
| `开放权重` | pesos abertos | 10 | low |

#### Português (BR)

| Term | Weight | Noise |
|---|---|---|
| `lançamos` | 9 | medium |
| `lançando` | 9 | medium |
| `acabou de lançar` | 10 | low |
| `disponível hoje` | 9 | low |
| `disponível agora` | 9 | low |
| `chegou o` | 7 | high |
| `nova versão` | 6 | high |
| `código aberto` | 8 | low |
| `open source` | 8 | low |
| `bate o GPT` | 8 | low |
| `supera o Claude` | 8 | low |

### 4.3 Camada B — Nomes Próprios (category: `product_name`)

> **Regra:** toda entrada aqui tem `requires_operator = true` salvo exceções raras. Combinar com `min_faves`, `list:`, ou `from:`.

#### OpenAI

`GPT-5`, `GPT-5.5`, `GPT-6`, `o3`, `o4`, `o5`, `o3-pro`, `o3-mini`, `Sora 2`, `Sora 3`, `DALL-E 4`, `ChatGPT Pro`, `ChatGPT Enterprise`, `ChatGPT Agent`, `Codex`, `Operator`, `Canvas`

#### Anthropic

`Claude 4`, `Claude 4.5`, `Claude 4.6`, `Claude 4.7`, `Claude 5`, `Claude Opus 5`, `Claude Sonnet`, `Claude Haiku`, `Claude Opus`, `Claude Code`, `Computer Use`, `Projects`, `Artifacts`, `Claude Skills`, `Model Context Protocol`, `MCP`

#### Google DeepMind

`Gemini 3`, `Gemini 3.5`, `Gemini 4`, `Gemini Ultra`, `Gemini Pro`, `Gemini Nano`, `Gemini Live`, `Project Astra`, `Project Mariner`, `Imagen`, `Veo`, `Veo 3`, `Veo 4`, `Lumiere`, `AlphaFold`, `AlphaCode`, `AlphaProof`, `Gemma`, `Gemma 3`, `NotebookLM`

#### Meta

`Llama 4`, `Llama 5`, `Llama 4.1`, `Meta AI`, `Ray-Ban Meta`, `Orion`, `SAM`, `SAM 3`

#### xAI

`Grok 3`, `Grok 4`, `Grok 5`, `Grok Heavy`, `Grok Code`, `Colossus`, `Aurora`

#### China

`DeepSeek`, `DeepSeek V3`, `DeepSeek V4`, `DeepSeek R1`, `DeepSeek R2`, `Qwen`, `Qwen 3`, `Qwen 4`, `Qwen-VL`, `Qwen-Coder`, `QwQ`, `Kimi`, `Kimi K2`, `Kimi K3`, `Moonshot`, `GLM`, `GLM-4`, `GLM-5`, `ChatGLM`, `Yi`, `Yi-Large`, `Yi-Lightning`, `Doubao`, `Doubao 1.5`, `Hunyuan`, `Hunyuan T1`, `MiniMax`, `Hailuo`, `Kling`, `Kling 2`, `Kling AI`, `Ernie`, `Wenxin`, `百度文心`, `Step`, `StepFun`

#### Outros labs

`Mistral`, `Mistral Large`, `Mistral Medium`, `Codestral`, `Mixtral`, `Command R`, `Command A`, `Cohere`, `Stable Diffusion 4`, `SD4`, `SDXL`, `Flux`, `FLUX.1`, `FLUX.2`, `Runway`, `Runway Gen-4`, `Gen-5`, `Pika`, `Pika 2`, `Luma`, `Dream Machine`, `HeyGen`, `Synthesia`, `Suno v5`, `Udio`, `ElevenLabs`, `Perplexity`, `Perplexity Pro`, `Comet`, `SearchGPT`, `Midjourney`, `MJ v7`, `MJ v8`

#### Hardware e infra

`H100`, `H200`, `B100`, `B200`, `GB200`, `GB300`, `Blackwell`, `Rubin`, `TPU v5`, `TPU v6`, `TPU v7`, `Trillium`, `Ironwood`, `MI300`, `MI350`, `MI400`, `Cerebras`, `Groq`, `SambaNova`, `Etched`, `Tenstorrent`

#### Ferramentas dev

`Cursor`, `Windsurf`, `Codeium`, `GitHub Copilot`, `Copilot Workspace`, `Replit`, `Replit Agent`, `Lovable`, `Bolt`, `v0`, `Devin`, `Cognition`, `Claude Code`, `Aider`

### 4.4 Camada C — Temas Técnicos (category: `technical`, peso 7-9)

| Tema | Keywords | Weight |
|---|---|---|
| Reasoning | `reasoning model`, `chain of thought`, `test-time compute`, `inference-time scaling`, `thinking model`, `o-series` | 8 |
| Agents | `AI agent`, `agentic`, `autonomous agent`, `multi-agent`, `browser agent`, `computer use`, `tool use` | 8 |
| Multimodal | `vision language model`, `VLM`, `multimodal`, `video generation`, `image generation`, `text-to-video`, `text-to-3D`, `world model` | 8 |
| Long context | `context window`, `1M tokens`, `10M tokens`, `long context`, `infinite context` | 7 |
| Efficiency | `quantization`, `distillation`, `mixture of experts`, `MoE`, `sparse model`, `pruning` | 7 |
| RLHF / Post-training | `RLHF`, `DPO`, `constitutional AI`, `RLAIF`, `reward model`, `preference tuning` | 7 |
| Safety | `AI safety`, `alignment`, `jailbreak`, `red teaming`, `model card`, `system card`, `responsible scaling` | 7 |
| Benchmarks | `MMLU`, `GPQA`, `SWE-bench`, `HumanEval`, `MATH`, `ARC-AGI`, `LiveBench`, `Arena`, `Chatbot Arena` | 9 |
| Embeddings/RAG | `retrieval augmented`, `RAG`, `vector database`, `embeddings`, `reranking` | 7 |
| Hardware/Scaling | `training run`, `FLOPs`, `compute`, `10^26`, `scaling laws`, `data wall` | 8 |
| Robotics | `humanoid robot`, `Figure`, `Optimus`, `1X`, `physical AI`, `embodied AI` | 7 |
| Science | `AlphaFold`, `protein folding`, `drug discovery`, `materials discovery`, `AI for science` | 7 |

### 4.5 Camada D — Magnitude (category: `magnitude`, peso 6-10)

#### Inglês

`biggest AI` (8), `largest model` (8), `most capable` (8), `first time` (7), `never before` (7), `world's first` (6), `trillion parameter` (9), `record` (7), `breaks record` (9), `leaked` (10), `leak` (10), `exclusive` (9), `scoop` (9), `confirmed` (8), `official` (7), `just announced` (10), `breaking` (10), `🚨` (9), `huge` (4, high noise), `massive` (4, high noise), `insane` (3, high noise), `this changes everything` (3, high noise), `game changer` (3, high noise)

#### Chinês

`重磅` (bombástico, 8), `突破` (breakthrough, 8), `首次` (primeira vez, 8), `独家` (exclusivo, 9), `泄露` (vazamento, 10)

### 4.6 Camada E — Gatilhos de Velocidade (category: `speed`)

> **Não são keywords isoladas — são combinações `from:conta + trigger`.** Pipeline precisa tratar como query templates, não como linha na tabela.

Ver seção 5: **Query Templates**.

### 4.7 Camada F — Papers (category: `paper`, peso 7)

`arxiv.org` (9), `new paper` (7), `our paper` (7), `we introduce` (7), `we propose` (7), `accepted to NeurIPS` (8), `accepted to ICLR` (8), `accepted to ICML` (8), `CVPR` (7), `ACL` (7), `dataset release` (7), `open dataset` (7)

### 4.8 Camada G — Business / Regulação (category: `business`, peso 6-8)

`raised $` (7), `Series A` (6), `Series B` (7), `Series C` (8), `funding round` (7), `valuation` (7), `$1B` (7), `$10B` (8), `$100B` (9), `acquisition` (8), `acquired` (8), `merger` (8), `IPO` (8), `going public` (8), `CEO steps down` (9), `resigns` (7), `joins` (6), `leaves` (6), `executive order` (8), `AI Act` (8), `EU AI Act` (8), `SB 1047` (8), `AISI` (7), `export controls` (9), `chip ban` (9), `Taiwan` (6), `TSMC` (7)

**Brasil:** `PL 2338` (8), `Marco Legal da IA` (8), `ANPD` (7), `regulação IA` (7), `investimento IA Brasil` (6)

### 4.9 Camada H — Brasil / PT (category: `regional`, peso 5-7)

`inteligência artificial` (5, high noise), `IA` (4, high noise — require operator), `modelo de linguagem` (7), `agente de IA` (7), `IA generativa` (6), `GPT em português` (7), `Claude em português` (7), `startup brasileira IA` (7), `IA no Brasil` (6), `Nubank IA` (7), `iFood IA` (7), `Magalu IA` (7), `Stone IA` (7), `Maritaca` (8), `Sabiá` (7), `Amazônia IA` (7)

---

## 5. Query Templates (X Search API)

> **Uso:** executar via TwitterAPI.io. Rodar em schedule conforme `polling` da Camada.

### 5.1 Breaking absoluto — labs principais (a cada 60s)

```
(from:OpenAI OR from:sama OR from:AnthropicAI OR from:GoogleDeepMind OR from:deepseek_ai OR from:xai OR from:AIatMeta OR from:MistralAI)
("introducing" OR "announcing" OR "available today" OR "releasing" OR "发布" OR "推出" OR "open sourcing")
-filter:replies
```

### 5.2 Leaks e rumores (a cada 60s)

```
(from:testingcatalog OR from:apples_jimmy OR from:btibor91 OR from:minchoi OR from:rowancheung OR from:AndrewCurran_)
-filter:replies -filter:retweets
```

### 5.3 Novo modelo com magnitude (a cada 5min)

```
("new model" OR "model release" OR "open sourcing")
("state of the art" OR "SOTA" OR "outperforms" OR "beats GPT" OR "beats Claude" OR "beats Gemini")
min_faves:200 -filter:replies lang:en
```

### 5.4 China breaking (a cada 5min)

```
(发布 OR 推出 OR 开源 OR 正式发布 OR 重磅)
(DeepSeek OR Qwen OR Kimi OR GLM OR Hunyuan OR MiniMax OR Doubao)
min_faves:50
```

### 5.5 Papers de alto impacto (a cada 15min)

```
(arxiv.org)
(from:_akhaliq OR from:arankomatsuzaki OR from:giffmana OR from:hardmaru OR from:huggingface)
min_faves:100
```

### 5.6 Benchmark moves (a cada 5min)

```
("Chatbot Arena" OR "SWE-bench" OR "ARC-AGI" OR "LiveBench" OR "GPQA" OR "MMLU")
("#1" OR "top" OR "new SOTA" OR "beats" OR "surpasses" OR "record")
min_faves:100 -filter:replies
```

### 5.7 Brasil AI launches (a cada 15min)

```
("lançamos" OR "acabou de lançar" OR "disponível hoje" OR "nova versão")
("IA" OR "inteligência artificial" OR GPT OR Claude OR Gemini)
lang:pt min_faves:20
```

### 5.8 Funding / M&A (a cada 15min)

```
(raised OR "Series B" OR "Series C" OR acquired OR acquisition OR valuation)
(AI OR "artificial intelligence")
min_faves:100 -filter:replies lang:en
```

### 5.9 Hardware / infra (a cada 15min)

```
(Blackwell OR "GB200" OR "GB300" OR Rubin OR "TPU v7" OR "MI350" OR Cerebras OR Groq)
(from:nvidia OR from:AMD OR from:jensenhuang OR from:SemiAnalysis_ OR min_faves:150)
-filter:replies lang:en
```

### 5.10 Agentes / computer use (a cada 15min)

```
("AI agent" OR "agentic" OR "computer use" OR "browser agent" OR "autonomous agent")
("new" OR "release" OR "introducing" OR "launching")
min_faves:100 -filter:replies lang:en
```

---

## 6. Schema Supabase (referência rápida)

```sql
-- Contas monitoradas
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text UNIQUE NOT NULL,
  layer smallint NOT NULL,              -- 1-10
  weight numeric NOT NULL,               -- 1-10
  polling_seconds int NOT NULL,
  lang text,
  active boolean DEFAULT true,
  last_polled_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Keywords (ver schema em 4.1)

-- Query templates
CREATE TABLE query_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  query text NOT NULL,
  polling_seconds int NOT NULL,
  active boolean DEFAULT true,
  last_run_at timestamptz
);

-- Tweets ingeridos
CREATE TABLE tweets (
  id text PRIMARY KEY,                   -- tweet ID do X
  account_id uuid REFERENCES accounts(id),
  handle text NOT NULL,
  text text NOT NULL,
  lang text,
  created_at timestamptz NOT NULL,
  likes int,
  retweets int,
  replies int,
  quotes int,
  views int,
  url text,
  has_media boolean,
  is_reply boolean,
  is_retweet boolean,
  ingested_at timestamptz DEFAULT now(),
  raw_json jsonb
);

-- Classificação
CREATE TABLE classifications (
  tweet_id text PRIMARY KEY REFERENCES tweets(id),
  category text,                         -- 'launch', 'leak', 'paper', 'benchmark', 'business', 'rumor', 'noise'
  is_breaking boolean,
  score int NOT NULL,                    -- 0-100
  matched_keywords jsonb,
  reasoning text,
  model text,                            -- 'haiku-4-5' etc
  classified_at timestamptz DEFAULT now()
);

-- Embedding para dedup
CREATE TABLE embeddings (
  tweet_id text PRIMARY KEY REFERENCES tweets(id),
  embedding vector(1536),
  cluster_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Clusters (mesma história)
CREATE TABLE clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_tweet_id text REFERENCES tweets(id),
  topic text,
  first_seen_at timestamptz NOT NULL,
  tweet_count int DEFAULT 1,
  total_engagement int DEFAULT 0,
  max_score int,
  status text DEFAULT 'open'             -- 'open', 'published', 'ignored'
);

-- Itens de newsletter
CREATE TABLE newsletter_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid REFERENCES clusters(id),
  title text,
  summary text,
  br_context text,                       -- Seção "O que isso significa para o Brasil"
  sources jsonb,                         -- tweet URLs + paper URLs
  edition_date date,
  status text DEFAULT 'draft',           -- 'draft', 'approved', 'published'
  created_at timestamptz DEFAULT now()
);
```

---

## 7. Prompt de Classificação (Haiku)

```
Você é um classificador de tweets sobre IA para uma newsletter de breaking news.

INPUT:
- Tweet: {text}
- Autor: @{handle} (Camada {layer}, peso {weight})
- Engajamento: {likes} likes, {retweets} RTs
- Idioma: {lang}

TAREFA: Retornar JSON estrito com os seguintes campos:
{
  "category": "launch" | "leak" | "paper" | "benchmark" | "business" | "rumor" | "opinion" | "noise",
  "is_breaking": boolean,
  "score": number (0-100),
  "matched_keywords": [string],
  "reasoning": string (máx 200 chars)
}

REGRAS:
1. "launch" = anúncio oficial de modelo/produto/feature com termos como "introducing", "announcing", "available today".
2. "leak" = vazamento, reverse-engineering, screenshot de API antes do anúncio oficial.
3. "paper" = paper científico, arxiv, resultado de pesquisa.
4. "benchmark" = resultado em MMLU, Arena, SWE-bench, etc.
5. "business" = funding, M&A, IPO, executivos, regulação.
6. "rumor" = especulação não confirmada, "hearing that", "sources say".
7. "opinion" = take, thread analítica, hot take.
8. "noise" = marketing vazio, autopromoção, curso, afiliado, irrelevante.

SCORING (0-100):
- Tweet de Camada 1-2 + gatilho de lançamento (Camada A): 90-100
- Tweet de Camada 1-2 + sem gatilho, mas conteúdo técnico: 70-85
- Tweet de Camada 3-5 + paper ou benchmark relevante: 70-85
- Tweet com leak confirmável e alta taxa de engajamento: 85-95
- Tweet opinativo sem fato novo: 30-50
- Tweet de marketing ou curso: 0-20

IDIOMA CHINÊS: aplicar as mesmas regras usando keywords 发布, 推出, 开源, 正式发布, 重磅, 突破, 泄露.

Retorne APENAS o JSON, sem preâmbulo.
```

---

## 8. Dedup e Clustering

1. Gerar embedding (text-embedding-3-small) no momento da classificação, apenas para tweets com `score >= 60`.
2. Buscar similaridade cosseno contra tweets das últimas 24h.
3. Se `cosine_similarity >= 0.85`, juntar ao cluster existente (incrementa `tweet_count`, atualiza `total_engagement`, mantém `canonical_tweet_id` como o de maior score).
4. Se não, criar novo cluster.
5. Pipeline de newsletter consome `clusters` com `status = 'open'` e `max_score >= 85`, não `tweets` diretamente.

---

## 9. Diferencial Editorial

Seção fixa da newsletter: **"O que isso significa para quem constrói IA no Brasil"** — 2-3 parágrafos traduzindo implicação prática (custo, regulação, oportunidade) para o leitor LatAm.

Campo `br_context` em `newsletter_items` é populado pelo Sonnet com prompt dedicado, recebendo o cluster + contexto macro (taxa de câmbio, regulação local vigente, comparação com o mercado BR).

---

## 10. Operadores X/Twitter — Cheatsheet

```
"exact phrase"       → match literal
from:@conta          → só dessa conta
list:id              → só dessa lista
min_faves:N          → likes mínimos
min_retweets:N       → RTs mínimos
-filter:replies      → exclui replies
-filter:retweets     → exclui RTs
filter:links         → só com link
filter:media         → só com mídia
lang:en              → idioma (en, pt, zh, es, fr, ja, ko)
since:YYYY-MM-DD     → desde data
until:YYYY-MM-DD     → até data
(A OR B) (C OR D)    → booleano
-"palavra"           → exclusão
url:openai.com       → link específico
```

---

## 11. Checklist de Implementação

- [ ] Seed table `accounts` com as 10 camadas
- [ ] Seed table `keywords` com todas as entradas das seções 4.2-4.9
- [ ] Seed table `query_templates` com as 10 queries da seção 5
- [ ] Worker de ingestão (Railway, TS) consumindo TwitterAPI.io
- [ ] Classificador Haiku (função Supabase Edge ou worker dedicado)
- [ ] Pipeline de embeddings (text-embedding-3-small) com pgvector
- [ ] Clusterização por similaridade cosseno
- [ ] Dashboard Next.js (Vercel) para curadoria
- [ ] Integração de publicação (Beehiiv ou Substack)
- [ ] Alertas P0 (score ≥ 95) via Telegram ou WhatsApp (Evolution API)

---

## 12. Notas de Manutenção

- **Revisar keywords trimestralmente.** Nomes de modelos envelhecem rápido (GPT-5 vira GPT-6).
- **Ajustar pesos de contas após 30 dias de dados.** Medir precisão real (breaking confirmado / total alertas).
- **Monitorar novos labs emergentes** (China especialmente — ciclo de 3-4 meses para novos entrantes relevantes).
- **Regex de pré-filtro no ingestor** deve ser gerado dinamicamente da tabela `keywords` com cache de 5min.
