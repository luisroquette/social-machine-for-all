# Radar de IA — Fontes Primárias (Twitter/X)

**Objetivo:** Monitoramento onisciente de breaking news em IA (lançamentos, features, papers, benchmarks, rumores) em escopo global (EN + CN + BR), destinado à curadoria editorial para newsletter.

**Escala de peso:** 1 (ruído raro útil) → 10 (fonte primária onde a notícia nasce).

---

## Princípio de scoring

Peso não é popularidade. É **probabilidade de mover o mercado nas próximas 48h**.

```
Peso = (Autoridade da fonte) × (Velocidade histórica de acerto) × (Proximidade do núcleo de decisão) ÷ (Ruído/postagens irrelevantes)
```

Uma conta com 200k seguidores que leaka features antes de todo mundo vale mais que uma conta de 2M que só retuíta.

---

## Camada 1 — Labs de Fronteira (peso 10)

Toda notícia primária nasce aqui. Monitoramento obrigatório em tempo real.

### EUA / Ocidente

| Organização | Contas |
|-------------|--------|
| OpenAI | @OpenAI, @sama, @gdb, @kevinweil, @miramurati, @npew, @willdepue, @polynoamial, @markchen90 |
| Anthropic | @AnthropicAI, @jackclarkSF, @alexalbert__, @sleepinyourhat, @DarioAmodei |
| Google DeepMind | @GoogleDeepMind, @demishassabis, @JeffDean, @OriolVinyalsML, @quocleix, @sundarpichai |
| Meta AI | @AIatMeta, @ylecun, @soumithchintala, @tydsh |
| xAI | @xai, @elonmusk, @grok, @ibab |
| Mistral | @MistralAI, @arthurmensch, @GuillaumeLample |
| Cohere | @cohere, @aidangomez, @nickfrosst |
| NVIDIA | @nvidia, @jensenhuang, @drjimfan |
| AMD | @AMD, @LisaSu |
| Apple | @tim_cook, @Apple |

### China (crítico em 2026)

| Organização | Contas |
|-------------|--------|
| DeepSeek | @deepseek_ai |
| Alibaba Qwen | @Alibaba_Qwen, @JustinLin610 |
| Moonshot / Kimi | @moonshotai, @Kimi_Moonshot |
| Zhipu / GLM | @Zai_org, @thukeg |
| Baichuan | @baichuanAI |
| 01.AI | @01AI_Yi, @kaifulee |
| ByteDance | @BytedanceTalk, @Kling_ai |
| MiniMax | @MiniMax__, @Hailuo_AI |
| Tencent Hunyuan | @TXhunyuan |
| StepFun | @StepFun_ai |

### Brasil

Não há labs de fronteira brasileiros. Camada de aplicação coberta em **Camada 8**.

---

## Camada 2 — Insiders que Vazam Features (peso 9)

É onde o "breaking" realmente acontece. Postam demos, screenshots e comportamentos dias antes do anúncio oficial.

- `@karpathy` — referência absoluta, tutorial + análise
- `@testingcatalog` — reverse-engineering de APIs antes do launch
- `@apples_jimmy` — leaker OpenAI, alta taxa de acerto
- `@btibor91` — leaker confiável, descobre endpoints
- `@legit_rumors`
- `@bedros_p`
- `@minchoi` — agregador rápido com boa curadoria
- `@rowancheung` — TheRundown, síntese quase em tempo real
- `@AndrewCurran_` — scoops frequentes
- `@DimitrisPapail` — análise técnica profunda
- `@_philschmid` — reporta launches rápido (Google/HF)
- `@osanseviero` — idem (HF/Google)
- `@abacaj` — insights de código + leaks

---

## Camada 3 — Pesquisa e Papers (peso 8)

Papers são "breaking news" com 48-72h de antecedência antes de virar produto.

- `@_akhaliq` — **fundamental**, cura HF Daily Papers, ~10 papers relevantes/dia
- `@arxiv_daily`, `@arxiv_cs_CL`, `@arxiv_cs_LG`
- `@huggingface`, `@ClementDelangue`, `@Thom_Wolf`
- `@PapersWithCode`
- `@hardmaru` — curadoria + opinião
- `@giffmana` — ex-DeepMind, análise rigorosa
- `@arankomatsuzaki` — curador de papers consistente
- `@sainingxie`, `@YiMaTweets`, `@percyliang`, `@tatsu_hashimoto` (Stanford)
- `@srush_nlp` — Sasha Rush
- `@MIT_CSAIL`, `@StanfordAILab`, `@berkeley_ai`

---

## Camada 4 — Benchmarks, Evals e Voz Técnica Independente (peso 8)

Eles decidem o que é "state of the art" na prática.

- `@lmsysorg` — **crítico**, Chatbot Arena define rankings
- `@ArtificialAnlys` — benchmarks de velocidade/custo
- `@scaling01` — análise de scaling laws
- `@teortaxesTex` — análise China/arquiteturas, peso alto em 2026
- `@natolambert` — AI2/Interconnects, análise RL/pós-treino
- `@Francis_YAO_` — benchmarks e long context
- `@Tim_Dettmers` — quantização, eficiência
- `@nrehiew_` — arquiteturas
- `@EpochAIResearch` — tendências de compute/scaling

---

## Camada 5 — Mídia e Jornalismo Especializado (peso 7-8)

- `@TheInformation`, `@steph_palazzolo` (breaks OpenAI), `@amir`
- `@TechCrunch`, `@kylelwiggers`
- `@theverge`, `@alexeheath`
- `@WIRED`, `@WillKnight`
- Bloomberg: `@ashleevance`, `@shirindghaffary`
- NYT tech: `@cademetz`, `@kevinroose`
- `@Reuters`, `@FT`
- `@SemiAnalysis_` — **peso 9** quando posta (Dylan Patel, análise compute/cadeia)
- `@deedydas` — análise de mercado

---

## Camada 6 — Builders e Ecossistema Dev (peso 6-7)

Traduzem "lançamento" em "uso real" — essencial para newsletter.

- `@swyx` — Latent Space, referência de síntese dev
- `@simonw` — análise prática e confiável, blog-referência
- `@levelsio` — indie builder, uso real
- `@mckaywrigley` — prototipagem rápida
- `@skirano`, `@Teknium1` (Nous Research)
- `@theo` (t3.gg) — opinião dev
- `@shaoruu`, `@pashmerepat`
- Ferramentas: `@cursor_ai`, `@windsurf_ai`, `@Replit`, `@amasad`
- Frameworks: `@LangChainAI`, `@LlamaIndex`, `@llama_index`
- Infra: `@vercel`, `@rauchg`, `@Supabase`, `@kiwicopple`

---

## Camada 7 — Capital, M&A e Sinal de Mercado (peso 6)

Movimentação de capital antecipa produto em 3-6 meses.

- `@a16z`, `@martin_casado`, `@bgurley`, `@pmarca`
- `@sarahtavel`, `@elad_gil`, `@natfriedman`, `@danielgross`
- `@semaphore`, `@garrytan` (Y Combinator)
- `@Sequoia`, `@sonyatweetybird`, `@pkedrosky`
- Lightspeed, Greylock, Benchmark (contas oficiais)

---

## Camada 8 — Brasil / LatAm (peso 5-7)

Baixo sinal primário, alto valor para traduzir contexto para a newsletter.

### Vozes técnicas e criadores

- `@filipe_deschamps` — referência mainstream BR
- `@diolinux`, `@akitando`
- `@sandeco` — Sandeco Macedo, prático aplicado
- `@jonnysfreitas`, `@brainercomputes`
- `@diariodoestadoai`
- `@leticia_gasparini`

### Aplicação corporativa BR

- `@Magalu`, `@Nubank`, `@StoneCo`, `@iFood` — anúncios de IA

### Regulação

- `@ANPDgovbr`
- Contas da Câmara sobre PL 2338 (Marco Legal da IA)

---

## Camada 9 — Vídeo e Agentes (peso 7)

Segmento em ebulição — merece camada própria.

- `@runwayml`, `@c_valenzuelab`
- `@pika_labs`, `@luma_ai`
- `@heygen_official`, `@synthesiaIO`
- `@SakanaAILabs` — agentes científicos
- `@browser_use`, `@adept_ai`

---

## Camada 10 — Contrarians e Ângulo Único (peso 5)

Newsletter sem ângulo morre. Essas vozes trazem diversidade editorial.

- `@GaryMarcus` — cético de LLMs
- `@fchollet` — ARC/raciocínio
- `@EMostaque` — Emad Mostaque
- `@emilymbender` — crítica linguística
- `@tszzl` (roon) — cultura/sátira OpenAI-adjacente
- `@ESYudkowsky`, `@robbensinger` — segurança/alinhamento
- `@davidad` — alinhamento técnico

---

## Fórmula de Scoring Refinada

Para newsletter, a métrica que importa é: **"isso merece virar item da edição de amanhã?"**

```
score_final = peso_base_fonte
            × multiplicador_keyword
            × aceleração_viral
            × recência
            ÷ similaridade_com_itens_já_publicados
```

### Multiplicadores de Keyword (aplicar em PT/EN/CN)

| Multiplicador | Keywords |
|---------------|----------|
| **3.0x** | `launching`, `introducing`, `announcing`, `available today`, `we're releasing`, `发布`, `推出`, `lançamos` |
| **2.0x** | `benchmark`, `SOTA`, `outperforms`, `open source`, `weights` |
| **1.5x** | `preview`, `alpha`, `early access`, `rollout` |
| **0.3x** | `thread`, `opinion`, `imo`, `hot take` |

### Aceleração Viral (primeiros 15 minutos)

- RTs / seguidores > 0.5% → **2.0x**
- Engajamento cruzado de 3+ contas Camada 1-2 → **3.0x** (sinal forte de "aconteceu algo")

---

## Arquitetura Técnica Recomendada

Stack casado a: TS + Supabase + Railway + Vercel + Claude + Evolution API.

### Ingestão

Twitter API v2 tier Basic ($200/mês, 10k tweets/mês) é insuficiente para 200+ contas. Três opções reais:

1. **X API Pro** ($5k/mês) — inviável para MVP
2. **TwitterAPI.io ou apidojo/twitter-scraper no Apify** — $50-200/mês, cobre demanda ✅
3. **Playwright + contas descartáveis em VPS** — $20/mês mas alto risco de ban

**Recomendação:** TwitterAPI.io.

### Pipeline

1. **Worker de ingestão (Railway)** pollando listas por tier:
   - Camada 1-2: a cada 60s
   - Camada 3-5: a cada 5 min
   - Restante: a cada 15 min
2. **Claude Haiku** classifica em `{categoria, é_breaking, é_ruído, score_preliminar}` — ~$0.001/tweet
3. **Embeddings** (text-embedding-3-small) para dedup, cluster de tópico, detecção de "mesma história"
4. **Claude Sonnet** processa apenas clusters acima do threshold — gera draft de item da newsletter
5. **Supabase** armazena tudo com RLS; dashboard Next.js para curadoria final
6. **Export** para Beehiiv / Substack / ConvertKit na publicação

### Diferencial Editorial Sugerido

Seção fixa: **"O que isso significa para quem constrói IA no Brasil"** — 2-3 parágrafos traduzindo implicação prática (custo, regulação, oportunidade) para o leitor LatAm.

Nenhuma newsletter gringa entrega isso, e nenhuma newsletter BR tem o radar global para fazê-lo.

---

## Checklist de Próximos Passos

- [ ] Validar/editar a lista de contas acima
- [ ] Criar listas privadas no X por Camada (1 a 10)
- [ ] Definir provedor de ingestão (TwitterAPI.io recomendado)
- [ ] Schema Supabase: `tweets`, `accounts`, `clusters`, `newsletter_items`
- [ ] Prompt do classificador Haiku
- [ ] Worker de ingestão no Railway
- [ ] Dashboard de curadoria (Next.js)
- [ ] Pipeline de dedup por embeddings
- [ ] Integração de publicação (Beehiiv / Substack)
