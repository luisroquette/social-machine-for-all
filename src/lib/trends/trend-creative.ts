import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import {
  applyEditorialStyleRotation,
  buildEditorialCoverCandidates,
  buildEditorialHookCandidates,
  pickTrendEditorialTemplate,
} from './trend-editorial-templates'

export interface TrendVideoShot {
  shotId: string
  label: string
  styleRole: string
  visualStyle: string
  styleDirection: string
  visualIntent: string
  subjectAction: string
  environmentAction: string
  cameraMove: string
  lens: string
  framing: string
  lightShift: string
  transition: string
  payoff: string
  rhythm: string
  motionPrompt: string
  durationSec: number
}

// Geração editorial (hook, capa, legenda) — independente da geração de vídeo.
// O imagePrompt aqui é dedicado à capa/thumbnail, não deriva de nenhum shot.
export interface TrendEditorialPack {
  editorialTemplateId: string
  editorialTemplateLabel: string
  angle: string
  hookTitle: string
  coverTitle: string
  hookCandidates: string[]
  coverCandidates: string[]
  caption: string
  ctaText: string
  imagePrompt: string
}

// Geração de vídeo (shots cinematográficos) — independente da geração de imagem/capa.
export interface TrendVideoMotionPack {
  style: string
  shots: TrendVideoShot[]
}

export interface TrendCreativeLearningInput {
  preferredStyle?: string | null
  preferredHookPattern?: string | null
  preferredEditorialTemplateId?: string | null
  preferredVideoProvider?: string | null
  preferredVideoModel?: string | null
  preferredGenerationMode?: string | null
  reasons?: string[]
  topVideoReasons?: string[]
}

function getTopicSeed(topic: string): number {
  return topic.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function clampShotsPerVideo(value: number): number {
  return Math.max(4, Math.min(5, value || 5))
}

// Higgsfield seedance_2_0 aceita duration de 4 a 15s (min 4, max 15, default 5).
// O clamp antigo [2,4] gerava clipes de 2s — ABAIXO do mínimo da API — e curtos demais
// para qualquer movimento de câmera cinematográfico se desenrolar. Faixa agora [4,10]:
// prioriza qualidade sem ir ao teto de 15s (que multiplicaria custo/tempo de render).
const SHOT_DURATION_MIN = 4
const SHOT_DURATION_MAX = 10

function clampShotDuration(value: number): number {
  return Math.max(SHOT_DURATION_MIN, Math.min(SHOT_DURATION_MAX, value || 6))
}

function getCategoryVibe(category: string, editorialBoost?: string): string {
  const base = category === 'sports'
    ? 'energia explosiva, tensao competitiva, impacto fisico, torcida reagindo e adrenalina'
    : category === 'entertainment'
      ? 'glamour pop, flash, caos controlado, surpresa imediata e presenca de palco'
      : category === 'technology'
        ? 'futuro proximo, energia eletrica, descoberta radical, escala high-tech e transformacao visual'
        : 'curiosidade instantanea, escala cinematica, atmosfera premium e progressao dramatica'

  return editorialBoost ? `${base}, ${editorialBoost}` : base
}

function getCategoryWorld(category: string, editorialBoost?: string): string {
  const base = category === 'sports'
    ? 'arena lotada, luzes de estadio, fumaca, bandeiras, suor, impacto e reacao coletiva'
    : category === 'entertainment'
      ? 'palco, backstage, flashes, neon, publico em choque e estetica pop premium'
      : category === 'technology'
        ? 'laboratorio futurista, cidade high-tech, interfaces volumetricas, particulas e energia pulsando'
        : 'ambiente de grande escala, atmosfera cinematografica, particulas, vento, luz recortada e profundidade'

  return editorialBoost ? `${base}, ${editorialBoost}` : base
}

function buildHookCandidates(topic: string, category: string, editorialCandidates: string[]): string[] {
  const upper = topic.toUpperCase()
  const base = [
    ...editorialCandidates,
    `NINGUEM ESPERAVA ISSO DE ${upper}`,
    `O QUE ESTA POR TRAS DE ${upper}`,
    `${upper}: A VIRADA QUE PEGOU O BRASIL`,
    `POR QUE ${upper} VIROU OBSESSAO AGORA`,
    `O DETALHE QUE EXPLICA ${upper}`,
    `${upper}: O BASTIDOR QUE MUDOU TUDO`,
  ]

  if (category === 'sports') {
    base.push(`${upper}: A JOGADA QUE MUDOU O CLIMA`, `${upper}: O CHOQUE QUE ACENDEU A TORCIDA`)
  } else if (category === 'technology') {
    base.push(`${upper}: A REVELACAO QUE ACELEROU A IA`, `${upper}: O SALTO QUE MEXEU COM TODO MUNDO`)
  } else if (category === 'entertainment') {
    base.push(`${upper}: O MOMENTO QUE PAROU A INTERNET`, `${upper}: A CENA QUE TODO MUNDO REVIU`)
  }

  return uniqueStrings(base).slice(0, 10)
}

function buildCoverCandidates(topic: string, category: string, editorialCandidates: string[]): string[] {
  const upper = topic.toUpperCase()
  const base = [
    ...editorialCandidates,
    `${upper}: A VIRADA`,
    `${upper}: O CHOQUE`,
    `${upper}: O BASTIDOR`,
    `${upper}: A REVELACAO`,
    `${upper}: O DETALHE`,
  ]

  if (category === 'sports') {
    base.push(`${upper}: A REVOLUCAO TATICA`)
  } else if (category === 'technology') {
    base.push(`${upper}: O SALTO DE IA`)
  } else if (category === 'entertainment') {
    base.push(`${upper}: A CENA VIRAL`)
  }

  return uniqueStrings(base).map((value) => truncate(value, 56)).slice(0, 8)
}

function scoreHeadlineCandidate(text: string, max: number): number {
  const cleaned = text.trim()
  let score = 0

  if (cleaned.length >= 24 && cleaned.length <= max) score += 3
  else if (cleaned.length >= 16) score += 1

  if (/[:!?]/.test(cleaned)) score += 2
  if (/\b(virada|choque|bastidor|revela|revelacao|revelação|detalhe|mudou|explodiu|parou|obsessao|obsessão)\b/i.test(cleaned)) score += 3
  if (/\b(ninguem esperava|ninguém esperava|o que esta por tras|o bastidor|por que)\b/i.test(cleaned)) score += 2
  if (/^por que .+ esta bombando$/i.test(cleaned)) score -= 3
  if (/^[A-Z0-9\s]+$/.test(cleaned) && cleaned.split(/\s+/).length < 4) score -= 2

  return score
}

function pickBestHeadline(candidates: string[], max: number, fallback: string): string {
  const normalized = uniqueStrings(candidates).map((candidate) => truncate(candidate, max))
  if (!normalized.length) return truncate(fallback, max)

  return normalized
    .map((candidate) => ({ candidate, score: scoreHeadlineCandidate(candidate, max) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate)[0] ?? truncate(fallback, max)
}

interface ShotBlueprint {
  label: string
  styleRole: string
  visualIntent: string
  subjectAction: string
  environmentAction: string
  cameraMove: string
  lens: string
  framing: string
  lightShift: string
  transition: string
  payoff: string
  rhythm: string
}

type StyleBucket = 'realism' | 'stylized' | 'abstract' | 'cinematic' | 'premium'

interface ShotStyleSpec {
  styleRole: string
  visualStyle: string
  styleDirection: string
}

// Candidatos de estilo por BUCKET (nao mais duplicados entre as tabelas de 4 e 5 shots —
// os buckets 'realism'/'stylized'/'abstract'/'cinematic'/'premium' sao os mesmos nos dois
// tamanhos de video, so a combinacao de slots muda). 6 candidatos por bucket (antes 4) para
// reduzir ainda mais a chance de repeticao entre topicos vizinhos no seed.
const STYLE_CANDIDATES_BY_BUCKET: Record<StyleBucket, Array<{ visualStyle: string; styleDirection: string }>> = {
  realism: [
    { visualStyle: 'ultrarealista', styleDirection: 'fisica real, textura fotografica, cinema de impacto e credibilidade total' },
    { visualStyle: 'documentario-handheld', styleDirection: 'camera de mao, grain sutil, luz pratica e sensacao de flagrante ao vivo' },
    { visualStyle: 'cinema-real-35mm', styleDirection: 'textura de filme 35mm, profundidade de campo rasa, contraste de cinema classico' },
    { visualStyle: 'reportagem-imersiva', styleDirection: 'estetica de reportagem em campo, luz natural dura, urgencia jornalistica' },
    { visualStyle: 'foto-jornalismo-cru', styleDirection: 'flagrante nao-posado, ruido de sensor visivel, honestidade quase brutal da imagem' },
    { visualStyle: 'realismo-industrial', styleDirection: 'superficies foscas, luz dura de fabrica ou estudio, textura material palpavel' },
  ],
  stylized: [
    { visualStyle: 'anime-cinematic', styleDirection: 'energia stylized, contraste alto, exagero controlado e silhueta marcante' },
    { visualStyle: 'anime-shonen-impacto', styleDirection: 'linhas de velocidade, cel-shading, poses exageradas de batalha' },
    { visualStyle: 'graphic-novel-noir', styleDirection: 'tinta pesada, sombras duras, paleta reduzida e painel dramatico' },
    { visualStyle: 'stop-motion-tatico', styleDirection: 'textura tatil de stop-motion, imperfeicao proposital, charme artesanal' },
    { visualStyle: 'pixel-maximalista', styleDirection: 'blocos de cor saturada, contorno grosso, ritmo de videoclipe eletrico' },
    { visualStyle: 'ilustracao-editorial-ousada', styleDirection: 'traco expressivo, paleta limitada de duas cores, composicao de cartaz' },
  ],
  abstract: [
    { visualStyle: 'abstrato-graphic', styleDirection: 'graphic abstraction, formas, particulas, data shards e leitura visual ousada' },
    { visualStyle: 'motion-graphics-3d', styleDirection: 'formas 3D flutuantes, gradientes neon, composicao geometrica cinetica' },
    { visualStyle: 'glitch-data-surreal', styleDirection: 'artefatos de glitch, distorcao digital, camadas de dados sobrepostas' },
    { visualStyle: 'particulas-volumetricas', styleDirection: 'nuvens de particulas volumetricas, luz caustica, escala microscopica' },
    { visualStyle: 'macro-fluido-abstrato', styleDirection: 'fluidos coloridos em macro, tensao superficial quebrando em camera lenta' },
    { visualStyle: 'wireframe-holografico', styleDirection: 'malhas wireframe translucidas, luz de scanner, sensacao de dado em construcao' },
  ],
  cinematic: [
    { visualStyle: 'cinematic-cinemascope', styleDirection: 'blockbuster premium, volumetria, escala heroica e payoff de filme' },
    { visualStyle: 'epico-anamorfico', styleDirection: 'lente anamorfica, flare horizontal, composicao ultra-wide de epico' },
    { visualStyle: 'noir-contraste', styleDirection: 'alto contraste preto e branco quebrado por uma cor de destaque' },
    { visualStyle: 'drama-luz-dourada', styleDirection: 'golden hour dramatico, silhuetas longas, atmosfera de climax' },
    { visualStyle: 'thriller-neon-molhado', styleDirection: 'asfalto molhado, neon refletido, tensao de perseguicao noturna' },
    { visualStyle: 'epico-deserto-tempestade', styleDirection: 'poeira em suspensao, luz raspante, escala geologica ao redor do sujeito' },
  ],
  premium: [
    { visualStyle: 'editorial-premium', styleDirection: 'acabamento premium, frame iconico, assinatura editorial e memoria visual forte' },
    { visualStyle: 'capa-de-revista', styleDirection: 'iluminacao de estudio de moda, pose de poster, acabamento glossy' },
    { visualStyle: 'luxo-minimalista', styleDirection: 'paleta reduzida, espaco negativo generoso, elegancia contida' },
    { visualStyle: 'hero-shot-cult', styleDirection: 'composicao de culto pop, saturacao controlada, presenca de icone' },
    { visualStyle: 'still-de-campanha', styleDirection: 'luz de campanha publicitaria, retoque impecavel, silencio visual controlado' },
    { visualStyle: 'arquivo-premiado', styleDirection: 'enquadramento de foto premiada, profundidade contida, gravidade tranquila' },
  ],
}

// Slots por quantidade de shots — apenas o papel (styleRole) e o bucket que rege a variedade,
// nao mais um bloco de candidatos duplicado por tamanho de video.
const STYLE_ROLE_BLUEPRINTS: Record<4 | 5, Array<{ styleRole: string; bucket: StyleBucket }>> = {
  4: [
    { styleRole: 'anchor_realism', bucket: 'realism' },
    { styleRole: 'stylized_burst', bucket: 'stylized' },
    { styleRole: 'abstract_acceleration', bucket: 'abstract' },
    { styleRole: 'cinematic_payoff', bucket: 'cinematic' },
  ],
  5: [
    { styleRole: 'anchor_realism', bucket: 'realism' },
    { styleRole: 'stylized_burst', bucket: 'stylized' },
    { styleRole: 'abstract_acceleration', bucket: 'abstract' },
    { styleRole: 'cinematic_reveal', bucket: 'cinematic' },
    { styleRole: 'premium_payoff', bucket: 'premium' },
  ],
}

function pickStyleCandidate(
  candidates: Array<{ visualStyle: string; styleDirection: string }>,
  seed: number,
  offset: number,
): { visualStyle: string; styleDirection: string } {
  return candidates[(seed + offset * 7) % candidates.length]
}

// Candidatos de camera/lente por styleRole (papel narrativo do shot), nao por categoria.
// O texto narrativo (visualIntent, lightShift, transition, payoff, rhythm) continua vindo de
// buildShotBlueprints (especifico por categoria); apenas o parametro tecnico de camera/lente
// rotaciona por seed do topico, para o fallback determinístico nao repetir sempre o mesmo
// movimento/lente no mesmo slot. 6 candidatos por papel (antes 4). cinematic_reveal e
// cinematic_payoff compartilham o mesmo pool — sao o mesmo papel cinematografico, so o nome
// do slot muda entre o video de 4 e o de 5 shots.
const CAMERA_LENS_POOL_BY_ROLE: Record<string, Array<{ cameraMove: string; lens: string }>> = {
  anchor_realism: [
    { cameraMove: 'push-in agressivo com leve camera shake cinematografico', lens: '24mm angular agressiva com profundidade dramatica' },
    { cameraMove: 'tracking lateral raso acompanhando o sujeito na altura do olho', lens: '35mm documental com grain sutil' },
    { cameraMove: 'steadicam avancando em linha reta, sem cortes de eixo', lens: '28mm handheld com leve distorcao nas bordas' },
    { cameraMove: 'dolly-in lento que aperta o quadro no instante certo', lens: '50mm compressao naturalista com fundo desfocado' },
    { cameraMove: 'camera no ombro seguindo o sujeito num unico take continuo', lens: '32mm reportagem com foco puxado manualmente' },
    { cameraMove: 'low angle fixo que deixa o sujeito crescer no quadro conforme avanca', lens: '21mm grandangular com linhas de fuga acentuadas' },
  ],
  stylized_burst: [
    { cameraMove: 'orbital rapido com tracking lateral heroico', lens: '35mm cinematica com compressao moderada' },
    { cameraMove: 'whip pan sincronizado com o pico do movimento', lens: '24mm grandangular com distorcao estilizada' },
    { cameraMove: 'handheld caotico que segue o gesto sem estabilizar', lens: '28mm com vinheta acentuada' },
    { cameraMove: 'crash zoom curto seguido de travamento no sujeito', lens: '50mm com flare lateral' },
    { cameraMove: 'dutch angle inclinado que gira ate se estabilizar no clímax', lens: '18mm ultra-wide com distorcao de bordas propositalmente exagerada' },
    { cameraMove: 'speed ramp que acelera bruscamente no meio do gesto', lens: '40mm com motion blur direcional controlado' },
  ],
  abstract_acceleration: [
    { cameraMove: 'whip pan controlado que encontra o apice em foco', lens: '28mm brutalista com distorcao controlada' },
    { cameraMove: 'zoom vertiginoso atraves de camadas de particulas', lens: '14mm ultra-wide com profundidade extrema' },
    { cameraMove: 'orbital acelerado em torno do centro de energia', lens: '35mm com desfoque de movimento controlado' },
    { cameraMove: 'jump-cuts rapidos sincronizados com o beat', lens: '24mm com aberracao cromatica sutil' },
    { cameraMove: 'camera atravessando o proprio efeito visual em linha reta', lens: '16mm macro-wide com profundidade de campo quase zero' },
    { cameraMove: 'stutter/strobe cut que fragmenta o movimento em flashes', lens: '30mm com nitidez alta e contraste duro' },
  ],
  cinematic_reveal: [
    { cameraMove: 'crane reveal curto com dolly-in elegante', lens: '50mm heroica com recorte limpo do sujeito' },
    { cameraMove: 'crane up com reveal amplo de escala', lens: '35mm com profundidade crescente' },
    { cameraMove: 'dolly-out revelando o ambiente ao redor do sujeito', lens: '24mm wide heroico' },
    { cameraMove: 'tilt ascendente que descobre a escala do momento', lens: '40mm com perspectiva expansiva' },
    { cameraMove: 'travelling lateral lento que descortina o cenario por inteiro', lens: '28mm anamorfica com flare horizontal sutil' },
    { cameraMove: 'pull-back vertical que sai do detalhe para o panorama', lens: '45mm com transicao de foco macro para wide' },
  ],
  premium_payoff: [
    { cameraMove: 'hero hold com micro movimento cinematografico para finalizar', lens: '85mm premium com profundidade curta e assinatura de cinema' },
    { cameraMove: 'leve dolly-in final de assinatura', lens: '85mm premium com acabamento escultural' },
    { cameraMove: 'push-in silencioso e contido no gesto final', lens: '100mm com bokeh cremoso' },
    { cameraMove: 'camera estatica com micro respiracao no frame final', lens: '85mm retrato com separacao de fundo total' },
    { cameraMove: 'orbital minimo e lento que sela a composicao final', lens: '105mm macro-retrato com bokeh circular' },
    { cameraMove: 'crash-in final rapido que trava exatamente no frame-icone', lens: '135mm compressao extrema com fundo totalmente dissolvido' },
  ],
}

const CAMERA_LENS_CANDIDATES: Record<string, Array<{ cameraMove: string; lens: string }>> = {
  ...CAMERA_LENS_POOL_BY_ROLE,
  cinematic_payoff: CAMERA_LENS_POOL_BY_ROLE.cinematic_reveal,
}

function pickCameraLens(styleRole: string, seed: number, offset: number): { cameraMove: string; lens: string } | null {
  const candidates = CAMERA_LENS_CANDIDATES[styleRole]
  if (!candidates?.length) return null
  return candidates[(seed + offset * 11) % candidates.length]
}

// Nota: a variedade de estilo vem dos candidatos ricos por slot em STYLE_ROLE_BLUEPRINTS,
// rotacionados por seed do tópico — não depende mais de `styles` (rotação configurada pelo
// usuário) bater com keywords de bucket. Essa rotação ainda é enviada ao LLM como contexto
// textual separado ("Estilos permitidos") em generateTrendVideoMotion.
function buildShotStyleArc(shotsPerVideo: number, topic: string): ShotStyleSpec[] {
  const seed = getTopicSeed(topic)
  const blueprint = STYLE_ROLE_BLUEPRINTS[shotsPerVideo as 4 | 5] ?? STYLE_ROLE_BLUEPRINTS[5]

  return blueprint.map((slot, index) => {
    const picked = pickStyleCandidate(STYLE_CANDIDATES_BY_BUCKET[slot.bucket], seed, index)
    return {
      styleRole: slot.styleRole,
      visualStyle: picked.visualStyle,
      styleDirection: picked.styleDirection,
    }
  })
}

function buildShotBlueprints(category: string): ShotBlueprint[] {
  if (category === 'sports') {
    return [
      {
        label: 'Incidente',
        styleRole: 'anchor_realism',
        visualIntent: 'instante antes do choque, corpo inclinado para ataque, tensao muscular maxima',
        subjectAction: 'o protagonista invade o quadro com arranque violento e decisivo',
        environmentAction: 'a torcida explode, bandeiras batem, fumaca sobe e particulas cortam o ar',
        cameraMove: 'push-in agressivo com leve camera shake cinematografico',
        lens: '24mm angular agressiva com profundidade dramatica',
        framing: 'close wide diagonal, sujeito entrando no quadro por uma lateral',
        lightShift: 'luzes de estadio atravessam fumaca e ficam mais duras ao longo do shot',
        transition: 'abre com ruptura imediata, sem establishing lento',
        payoff: 'termina na beira do impacto, sem congelar',
        rhythm: 'abertura punchy e curta',
      },
      {
        label: 'Escalada',
        styleRole: 'stylized_burst',
        visualIntent: 'mid-action total, contato fisico, roupas e cabelo sendo puxados pelo movimento',
        subjectAction: 'o corpo completa uma acao clara e irreversivel',
        environmentAction: 'grama, suor, poeira e tecido reagem ao gesto',
        cameraMove: 'orbital rapido com tracking lateral heroico',
        lens: '35mm cinematica com compressao moderada',
        framing: 'medium full body com deslocamento lateral intenso',
        lightShift: 'reflexos recortam o corpo e intensificam o contraste',
        transition: 'entra ja em aceleracao, como continuacao do choque anterior',
        payoff: 'fecha com o movimento ainda crescendo',
        rhythm: 'escalada rapida com respiracao curtissima',
      },
      {
        label: 'Colisao',
        styleRole: 'abstract_acceleration',
        visualIntent: 'apice do evento, colapso visual de energia, impacto no quadro inteiro',
        subjectAction: 'a acao principal atinge o momento de maxima forca',
        environmentAction: 'objetos, publico e atmosfera respondem em cadeia',
        cameraMove: 'whip pan controlado que encontra o apice em foco',
        lens: '28mm brutalista com distorcao controlada',
        framing: 'frame quebrado por vetores de impacto e debris no foreground',
        lightShift: 'um estouro de luz marca a colisao',
        transition: 'corta no auge da energia para amplificar o impacto',
        payoff: 'encerra no milissegundo do impacto maximo',
        rhythm: 'choque brusco e explosivo',
      },
      {
        label: 'Revelacao',
        styleRole: 'cinematic_reveal',
        visualIntent: 'novo equilibrio apos o choque, superioridade visual evidente',
        subjectAction: 'o protagonista emerge dominante do caos',
        environmentAction: 'a massa ao redor muda de estado e reage ao resultado',
        cameraMove: 'crane reveal curto com dolly-in elegante',
        lens: '50mm heroica com recorte limpo do sujeito',
        framing: 'hero medium shot abrindo escala do ambiente',
        lightShift: 'o quadro sai do caos e entra numa luz heroica',
        transition: 'troca o caos por leitura clara do novo estado da cena',
        payoff: 'fecha com imagem transformada, nao com loop',
        rhythm: 'reveal mais amplo para reorganizar a narrativa',
      },
      {
        label: 'Payoff',
        styleRole: 'premium_payoff',
        visualIntent: 'icone final, status, presenca, memoria visual forte',
        subjectAction: 'o protagonista sustenta o desfecho com gesto final marcante',
        environmentAction: 'o mundo ao redor reforca a escala do momento',
        cameraMove: 'hero hold com micro movimento cinematografico para finalizar',
        lens: '85mm premium com profundidade curta e assinatura de cinema',
        framing: 'hero close final com leitura iconica imediata',
        lightShift: 'glow final premium e assinatura visual forte',
        transition: 'entra ja consagrado, sem desperdiçar tempo',
        payoff: 'termina com resolucao e impacto',
        rhythm: 'payoff mais longo e memoravel',
      },
    ]
  }

  if (category === 'technology') {
    return [
      {
        label: 'Incidente',
        styleRole: 'anchor_realism',
        visualIntent: 'ativacao inicial, sistema acordando no meio de uma descarga visual',
        subjectAction: 'o elemento central desperta e inicia uma transformacao irreversivel',
        environmentAction: 'interfaces, energia, particulas e reflexos entram em cascata',
        cameraMove: 'push-in tecnico e preciso atravessando camadas de profundidade',
        lens: '24mm high-tech com perspectiva profunda',
        framing: 'wide vertical com camadas de interface em foreground e background',
        lightShift: 'brilho frio vira energia intensa ao longo do shot',
        transition: 'abre com ativacao instantanea, sem explicacao lenta',
        payoff: 'termina quando o sistema cruza o ponto sem retorno',
        rhythm: 'abertura tecnica e incisiva',
      },
      {
        label: 'Escalada',
        styleRole: 'stylized_burst',
        visualIntent: 'circuitos, superficies e volumes reagindo em cadeia',
        subjectAction: 'a transformacao acelera e se torna visivelmente poderosa',
        environmentAction: 'o ambiente high-tech vibra, refrata e reconfigura o espaco',
        cameraMove: 'orbital curto com foco trocando entre camadas tecnologicas',
        lens: '35mm limpa com troca de foco perceptivel',
        framing: 'medium wide com deslocamento entre planos de dados',
        lightShift: 'pulsos luminosos escalam para alto contraste',
        transition: 'entra como continuidade da ativacao e acelera a complexidade',
        payoff: 'fecha com a energia subindo',
        rhythm: 'crescimento progressivo e tecnico',
      },
      {
        label: 'Colisao',
        styleRole: 'abstract_acceleration',
        visualIntent: 'surto visual, energia concentrada, ruptura de forma e escala',
        subjectAction: 'o sistema libera seu momento de maior potencia',
        environmentAction: 'ondas, fragmentos e dados visuais explodem ao redor',
        cameraMove: 'whip move limpo seguido de lock preciso no apice',
        lens: '28mm de impacto com perspectiva agressiva',
        framing: 'frame denso com energia atravessando o centro do quadro',
        lightShift: 'estouro controlado de luz e reflexo',
        transition: 'corta para o surto no auge da carga acumulada',
        payoff: 'encerra no auge da ruptura',
        rhythm: 'ruptura abrupta e brilhante',
      },
      {
        label: 'Revelacao',
        styleRole: 'cinematic_reveal',
        visualIntent: 'nova forma ou novo estado do mundo finalmente revelado',
        subjectAction: 'o elemento central assume sua forma final',
        environmentAction: 'o ambiente reorganiza sua geometria ao redor do novo centro',
        cameraMove: 'crane up com reveal amplo de escala',
        lens: '50mm heroica com escala crescente',
        framing: 'hero wide revelando arquitetura e simetria ao redor',
        lightShift: 'a cena sai do caos e entra em glow heroico',
        transition: 'troca caos por clareza e escala do novo estado',
        payoff: 'termina com metamorfose consumada',
        rhythm: 'reveal mais aberto para ampliar leitura',
      },
      {
        label: 'Payoff',
        styleRole: 'premium_payoff',
        visualIntent: 'hero frame com sensacao de futuro inevitavel',
        subjectAction: 'o sujeito sustenta o novo estado com autoridade visual',
        environmentAction: 'particulas e arquitetura reforcam a grandiosidade final',
        cameraMove: 'leve dolly-in final de assinatura',
        lens: '85mm premium com acabamento escultural',
        framing: 'close heroico com mundo futurista recortado atras',
        lightShift: 'acabamento premium com brilho escultural',
        transition: 'entra como assinatura final do novo mundo',
        payoff: 'fecha como poster de filme de sci-fi',
        rhythm: 'encerramento mais sustentado e memoravel',
      },
    ]
  }

  if (category === 'entertainment') {
    return [
      {
        label: 'Incidente',
        styleRole: 'anchor_realism',
        visualIntent: 'entrada explosiva em cena, surpresa visual imediata',
        subjectAction: 'o protagonista rompe o quadro com presenca e atitude',
        environmentAction: 'flashes, cabelo, tecido, fumaca e publico reagem ao impacto',
        cameraMove: 'push-in rapido com energia de abertura de trailer',
        lens: '24mm glam wide com foreground vivo',
        framing: 'entrada diagonal com figura invadindo o eixo principal',
        lightShift: 'os flashes acendem e cortam o ambiente',
        transition: 'abre como se a cena ja estivesse acontecendo',
        payoff: 'fecha na virada da entrada',
        rhythm: 'abertura curta e estourada',
      },
      {
        label: 'Escalada',
        styleRole: 'stylized_burst',
        visualIntent: 'gesto maior, movimento de corpo, glamour em acao',
        subjectAction: 'o protagonista executa um movimento impossivel de ignorar',
        environmentAction: 'o palco e o publico entram na mesma onda de energia',
        cameraMove: 'orbital glam com tracking lateral elegante',
        lens: '35mm fashion-cinematic com glide lateral',
        framing: 'full body mobile com tecidos e luz reagindo ao gesto',
        lightShift: 'neon e flashes aumentam a pressao visual',
        transition: 'continua a entrada e amplifica o magnetismo',
        payoff: 'termina com o momento crescendo',
        rhythm: 'crescimento pop rapido',
      },
      {
        label: 'Colisao',
        styleRole: 'abstract_acceleration',
        visualIntent: 'climax pop, explosao visual, frame maximalista',
        subjectAction: 'a performace ou reveal atinge o apice',
        environmentAction: 'tudo ao redor responde como um evento coletivo',
        cameraMove: 'whip reveal que encontra o auge em foco limpo',
        lens: '28mm de show com energia espalhada no quadro inteiro',
        framing: 'frame maximalista cheio de luz, publico e textura',
        lightShift: 'clarões marcam o ponto de maior histeria',
        transition: 'corta no momento de histeria visual máxima',
        payoff: 'encerra no auge do caos elegante',
        rhythm: 'climax brusco e barulhento',
      },
      {
        label: 'Revelacao',
        styleRole: 'cinematic_reveal',
        visualIntent: 'close heroico ou silhueta icônica apos o apice',
        subjectAction: 'o protagonista assume o controle do quadro',
        environmentAction: 'o ambiente baixa um degrau e destaca a figura central',
        cameraMove: 'crane reveal curto para consagrar a imagem',
        lens: '50mm iconica com sujeito dominante no eixo',
        framing: 'hero medium com silhueta ou close dominante',
        lightShift: 'a luz organiza o caos e vira assinatura visual',
        transition: 'converte caos em icone reconhecivel',
        payoff: 'fecha com nova imagem dominante',
        rhythm: 'reveal elegante depois do estouro',
      },
      {
        label: 'Payoff',
        styleRole: 'premium_payoff',
        visualIntent: 'imagem final inesquecivel, status e culto pop',
        subjectAction: 'um gesto curto sela a cena',
        environmentAction: 'flashes e atmosfera servem o personagem final',
        cameraMove: 'micro dolly-in de encerramento',
        lens: '85mm editorial com acabamento de capa',
        framing: 'close final com gesto curto e leitura imediata',
        lightShift: 'glow final de capa de revista',
        transition: 'entra em pose-resolucao sem parecer retrato parado',
        payoff: 'termina com imagem icônica e resolvida',
        rhythm: 'encerramento um pouco mais sustentado',
      },
    ]
  }

  return [
    {
      label: 'Incidente',
      styleRole: 'anchor_realism',
      visualIntent: 'um evento visual rompe a estabilidade do quadro',
      subjectAction: 'o elemento central entra em acao de forma clara',
      environmentAction: 'vento, particulas, fumaca e escala do ambiente respondem',
      cameraMove: 'push-in cinematografico com profundidade agressiva',
      lens: '24mm dramatica com espacamento forte dos planos',
      framing: 'wide vertical com diagonais agressivas',
      lightShift: 'a luz sai do neutro e ganha tensao',
      transition: 'abre ja no momento de ruptura',
      payoff: 'termina com ruptura evidente',
      rhythm: 'inicio rapido e cortante',
    },
    {
      label: 'Escalada',
      styleRole: 'stylized_burst',
      visualIntent: 'a tensao aumenta com corpo, materia e espaco em movimento',
      subjectAction: 'a acao continua e fica mais intensa',
      environmentAction: 'o mundo em volta acompanha e amplifica o gesto',
      cameraMove: 'orbital curto com tracking lateral',
      lens: '35mm cinematica com parallax real entre planos',
      framing: 'medium wide com materia atravessando foreground',
      lightShift: 'o contraste sobe junto com a tensao',
      transition: 'entra como continuidade sem reset visual',
      payoff: 'fecha em crescimento',
      rhythm: 'crescimento progressivo',
    },
    {
      label: 'Colisao',
      styleRole: 'abstract_acceleration',
      visualIntent: 'apice visual com linhas de forca, choque e densidade',
      subjectAction: 'a acao principal alcança o auge',
      environmentAction: 'o ambiente responde em cadeia ao impacto',
      cameraMove: 'whip pan controlado para encontrar o apice',
      lens: '28mm de impacto com energia lateral',
      framing: 'frame comprimido por vetores e debris',
      lightShift: 'estouro curto de luz no ponto maximo',
      transition: 'corta para o apice sem preambulo',
      payoff: 'encerra no milissegundo mais forte',
      rhythm: 'choque brusco',
    },
    {
      label: 'Revelacao',
      styleRole: 'cinematic_reveal',
      visualIntent: 'o quadro assume novo estado depois do choque',
      subjectAction: 'o sujeito emerge com nova leitura visual',
      environmentAction: 'o ambiente reorganiza o caos e revela escala',
      cameraMove: 'crane reveal curto e elegante',
      lens: '50mm heroica com escala ficando clara',
      framing: 'hero medium abrindo para revelar o ambiente',
      lightShift: 'a luz troca caos por heroismo',
      transition: 'transforma o choque em leitura clara do novo estado',
      payoff: 'termina com transformacao consumada',
      rhythm: 'reveal controlado',
    },
    {
      label: 'Payoff',
      styleRole: 'premium_payoff',
      visualIntent: 'imagem final memoravel, forte e resolvida',
      subjectAction: 'um gesto final fecha a narrativa',
      environmentAction: 'o mundo ao redor serve o simbolo final',
      cameraMove: 'hero hold com micro movimento premium',
      lens: '85mm premium com profundidade curta',
      framing: 'close final com leitura de poster',
      lightShift: 'acabamento final escultorico',
      transition: 'entra no estado final sem parecer estatico',
      payoff: 'termina como poster de filme',
      rhythm: 'encerramento mais longo e memoravel',
    },
  ]
}

// Variante alternativa de subjectAction/environmentAction por categoria+papel, escolhida por
// seed do topico. buildShotBlueprints() e a "variante 0" (fixa, sempre a mesma para a
// categoria); esta tabela e a "variante 1". Sem isso, dois topicos diferentes na mesma
// categoria (ex: "GPT 5.6" e "Claude Opus", ambos technology) geravam o mesmo texto narrativo
// shot a shot no fallback — so visualStyle/cameraMove/lens variavam. visualIntent, framing,
// transition, payoff e rhythm continuam ancorados na categoria (estrutura da mini-narrativa).
const NARRATIVE_ALT_BY_CATEGORY_ROLE: Record<string, Record<string, { subjectAction: string; environmentAction: string }>> = {
  sports: {
    anchor_realism: {
      subjectAction: 'o atleta quebra a postura defensiva num rompante calculado',
      environmentAction: 'a arquibancada vibra, apitos cortam o ar e cameras piscam em sequencia',
    },
    stylized_burst: {
      subjectAction: 'o gesto tecnico se completa com um salto que desafia a fisica',
      environmentAction: 'confete, suor e grama voam junto com o impulso do corpo',
    },
    abstract_acceleration: {
      subjectAction: 'a jogada decisiva atinge seu ponto de nao-retorno',
      environmentAction: 'a energia da torcida se funde num unico rugido visual',
    },
    cinematic_reveal: {
      subjectAction: 'o marcador muda e o protagonista assume o controle do jogo',
      environmentAction: 'o estadio inteiro reconhece o momento e reage em unissono',
    },
    premium_payoff: {
      subjectAction: 'o atleta sustenta o gesto de vitoria com serenidade total',
      environmentAction: 'os holofotes se fecham sobre ele como um quadro definitivo',
    },
  },
  technology: {
    anchor_realism: {
      subjectAction: 'o hardware acende pela primeira vez e comeca a processar em tempo real',
      environmentAction: 'monitores, cabos e telas piscam em sincronia com o boot',
    },
    stylized_burst: {
      subjectAction: 'o algoritmo acelera visivelmente, ultrapassando seu proprio benchmark',
      environmentAction: 'grids de dados se reorganizam em ondas cada vez mais rapidas',
    },
    abstract_acceleration: {
      subjectAction: 'o modelo atinge um pico de processamento que satura o sistema',
      environmentAction: 'nos de rede piscam em cascata ate um unico ponto de fusao',
    },
    cinematic_reveal: {
      subjectAction: 'a interface se estabiliza revelando uma capacidade nunca vista',
      environmentAction: 'o datacenter ao fundo ganha uma escala quase arquitetonica',
    },
    premium_payoff: {
      subjectAction: 'o produto final aparece como um objeto de desejo tecnologico',
      environmentAction: 'luzes frias dao lugar a um acabamento quente e prestigiado',
    },
  },
  entertainment: {
    anchor_realism: {
      subjectAction: 'a estrela cruza o tapete com um gesto calculado de impacto',
      environmentAction: 'flashes disparam em rajada e o publico grita o nome',
    },
    stylized_burst: {
      subjectAction: 'o performer executa uma coreografia que quebra o compasso esperado',
      environmentAction: 'luzes de palco mudam de cor no mesmo instante do movimento',
    },
    abstract_acceleration: {
      subjectAction: 'o momento viral acontece exatamente no pico da cena',
      environmentAction: 'a plateia vira um unico bloco de luz e som',
    },
    cinematic_reveal: {
      subjectAction: 'a camera encontra o rosto certo no timing certo',
      environmentAction: 'o resto do ambiente perde nitidez para dar lugar ao close',
    },
    premium_payoff: {
      subjectAction: 'a pose final vira a imagem que todo mundo vai repostar',
      environmentAction: 'o fundo se resume a textura e luz, sem distrair do sujeito',
    },
  },
  default: {
    anchor_realism: {
      subjectAction: 'o elemento central rompe a inercia com um movimento decisivo',
      environmentAction: 'particulas, luz e sombra reagem em cadeia ao redor',
    },
    stylized_burst: {
      subjectAction: 'a acao ganha uma segunda camada de intensidade visual',
      environmentAction: 'o espaco ao redor se deforma levemente para acompanhar o gesto',
    },
    abstract_acceleration: {
      subjectAction: 'a tensao acumulada se resolve num unico pico visual',
      environmentAction: 'linhas de forca convergem para o centro exato do quadro',
    },
    cinematic_reveal: {
      subjectAction: 'o sujeito emerge com uma leitura visual completamente nova',
      environmentAction: 'o cenario se reorganiza para servir a nova composicao',
    },
    premium_payoff: {
      subjectAction: 'um ultimo gesto fecha a cena com peso simbolico',
      environmentAction: 'a luz se concentra inteiramente sobre o desfecho final',
    },
  },
}

function getNarrativeCategoryKey(category: string): string {
  return category === 'sports' || category === 'technology' || category === 'entertainment' ? category : 'default'
}

// premium_payoff so existe no slot 5 do video de 5 shots; o video de 4 shots usa
// cinematic_payoff no ultimo slot, que reaproveita a variante narrativa de cinematic_reveal
// (mesmo papel de fechamento cinematografico, so muda o nome do slot).
function pickNarrativeAlt(category: string, styleRole: string, seed: number, offset: number): { subjectAction: string; environmentAction: string } | null {
  const categoryKey = getNarrativeCategoryKey(category)
  const roleKey = styleRole === 'cinematic_payoff' ? 'cinematic_reveal' : styleRole
  const alt = NARRATIVE_ALT_BY_CATEGORY_ROLE[categoryKey]?.[roleKey]
  if (!alt) return null
  // Metade das vezes usa o texto fixo da categoria (buildShotBlueprints), metade usa a
  // variante alternativa acima — variedade real sem perder a ancora narrativa da categoria.
  return (seed + offset * 13) % 2 === 1 ? alt : null
}

// Antes havia UM UNICO padrao de ritmo por quantidade de shots — todo video do fallback tinha
// a mesma "forma" de pacing (mesma proporcao entre shots), so a duracao base mudava. Agora ha
// 3 curvas de ritmo por quantidade de shots, escolhidas por seed do topico — variedade real na
// cadencia do video, nao so no visual.
const RHYTHM_PATTERNS: Record<number, number[][]> = {
  4: [
    [0.84, 0.92, 1.02, 1.18],
    [0.72, 1.0, 0.86, 1.32],
    [0.95, 0.78, 1.05, 1.22],
  ],
  5: [
    [0.8, 0.9, 0.82, 1.02, 1.18],
    [0.7, 1.05, 0.85, 0.95, 1.35],
    [0.9, 0.75, 1.1, 0.95, 1.2],
  ],
}

function buildRhythmDurations(shotsPerVideo: number, baseDurationSec: number, topic: string): number[] {
  const candidates = RHYTHM_PATTERNS[shotsPerVideo] ?? RHYTHM_PATTERNS[5]
  const multipliers = candidates[getTopicSeed(topic) % candidates.length]

  return multipliers
    .slice(0, shotsPerVideo)
    .map((multiplier) => Number(clampShotDuration(baseDurationSec * multiplier).toFixed(2)))
}

// Templates de caption por categoria, escolhidos por seed do topico. Antes havia uma unica
// frase fixa ("{topic} esta dominando as buscas no Brasil agora"), repetida identica em todo
// fallback de qualquer categoria — agora cada categoria tem 4 estruturas de frase diferentes.
const CAPTION_TEMPLATES_BY_CATEGORY: Record<string, string[]> = {
  sports: [
    '{topic} virou assunto obrigatorio no esporte agora.',
    'Ninguem esperava esse capitulo de {topic}.',
    '{topic} esta dominando as conversas no esporte brasileiro.',
    'O lance de {topic} ja esta em todo lugar.',
  ],
  technology: [
    '{topic} esta redefinindo o que esperamos da IA agora.',
    'O salto de {topic} pegou todo mundo de surpresa.',
    '{topic} esta dominando as buscas em tech no Brasil agora.',
    'Ninguem imaginava que {topic} chegaria tao rapido.',
  ],
  entertainment: [
    '{topic} parou a internet nas ultimas horas.',
    'Todo mundo esta comentando {topic} agora.',
    '{topic} esta dominando os trends no Brasil agora.',
    'A cena de {topic} ja virou repost obrigatorio.',
  ],
  default: [
    '{topic} esta dominando as buscas no Brasil agora.',
    'Ninguem esperava esse desenrolar de {topic}.',
    '{topic} virou o assunto do momento.',
    'O detalhe por tras de {topic} esta bombando agora.',
  ],
}

function buildCaptionFallback(topic: string, category: string, defaultCta: string): string {
  const templates = CAPTION_TEMPLATES_BY_CATEGORY[getNarrativeCategoryKey(category)] ?? CAPTION_TEMPLATES_BY_CATEGORY.default
  const seed = getTopicSeed(topic)
  const template = templates[seed % templates.length]
  return `${template.replace('{topic}', topic)} ${defaultCta}`
}

function buildStandaloneCoverImagePrompt(input: {
  topic: string
  editorialLabel: string
  vibe: string
  world: string
}): string {
  return [
    `Frame vertical 9:16 sobre "${input.topic}", pensado como imagem de capa/thumbnail — nao e um frame de video.`,
    `Linha editorial: ${input.editorialLabel}.`,
    `Mundo visual: ${input.world}.`,
    `Tom: ${input.vibe}.`,
    'Composicao hero, sujeito ou simbolo central bem legivel mesmo em miniatura, alto contraste, textura cinematografica.',
    'Precisa funcionar como capa isolada, sem depender de nenhum video ou sequencia.',
    'Sem pose de retrato de estudio olhando para a camera, sem texto, sem watermark.',
  ].join(' ')
}

function buildMotionPrompt(input: {
  topic: string
  editorialLabel: string
  blueprint: ShotBlueprint
  shotStyle: ShotStyleSpec
}): string {
  return [
    `Sem looping, sem idle animation, sem efeito de foto respirando, sem pulsar.`,
    `Este shot precisa ter comeco, meio e fim claros sobre "${input.topic}".`,
    `Linha editorial: ${input.editorialLabel}.`,
    `Papel de estilo: ${input.shotStyle.styleRole}.`,
    `Estilo principal do shot: ${input.shotStyle.visualStyle}.`,
    `Direcao de estilo: ${input.shotStyle.styleDirection}.`,
    `Intencao visual: ${input.blueprint.visualIntent}.`,
    `Acao principal: ${input.blueprint.subjectAction}.`,
    `Reacao do ambiente: ${input.blueprint.environmentAction}.`,
    `Camera: ${input.blueprint.cameraMove}.`,
    `Lente: ${input.blueprint.lens}.`,
    `Enquadramento: ${input.blueprint.framing}.`,
    `Luz: ${input.blueprint.lightShift}.`,
    `Transicao do beat: ${input.blueprint.transition}.`,
    `Payoff final: ${input.blueprint.payoff}.`,
    `Ritmo: ${input.blueprint.rhythm}.`,
    'O quadro final precisa ser diferente do quadro inicial e parecer trecho de filme, nao parallax de imagem.',
  ].join(' ')
}

function buildFallbackShots(input: {
  topic: string
  category: string
  styleRotation: string[]
  editorialLabel: string
  shotsPerVideo: number
  shotDurationSec: number
}): TrendVideoShot[] {
  const shotDurationSec = clampShotDuration(input.shotDurationSec)
  const shotsPerVideo = clampShotsPerVideo(input.shotsPerVideo)
  const blueprints = buildShotBlueprints(input.category).slice(0, shotsPerVideo)
  const styleArc = buildShotStyleArc(shotsPerVideo, input.topic)
  const rhythmDurations = buildRhythmDurations(shotsPerVideo, shotDurationSec, input.topic)

  const seed = getTopicSeed(input.topic)

  return blueprints.map((blueprint, index) => {
    const shotStyle = styleArc[index] ?? styleArc[styleArc.length - 1]
    const cameraLens = pickCameraLens(blueprint.styleRole, seed, index)
    const narrativeAlt = pickNarrativeAlt(input.category, blueprint.styleRole, seed, index)
    const resolvedBlueprint: ShotBlueprint = {
      ...blueprint,
      ...(cameraLens ? { cameraMove: cameraLens.cameraMove, lens: cameraLens.lens } : {}),
      ...(narrativeAlt ? { subjectAction: narrativeAlt.subjectAction, environmentAction: narrativeAlt.environmentAction } : {}),
    }

    return {
      shotId: `shot_${index + 1}`,
      label: resolvedBlueprint.label,
      styleRole: shotStyle.styleRole || resolvedBlueprint.styleRole,
      visualStyle: shotStyle.visualStyle,
      styleDirection: shotStyle.styleDirection,
      visualIntent: resolvedBlueprint.visualIntent,
      subjectAction: resolvedBlueprint.subjectAction,
      environmentAction: resolvedBlueprint.environmentAction,
      cameraMove: resolvedBlueprint.cameraMove,
      lens: resolvedBlueprint.lens,
      framing: resolvedBlueprint.framing,
      lightShift: resolvedBlueprint.lightShift,
      transition: resolvedBlueprint.transition,
      payoff: resolvedBlueprint.payoff,
      rhythm: resolvedBlueprint.rhythm,
      motionPrompt: buildMotionPrompt({
        topic: input.topic,
        editorialLabel: input.editorialLabel,
        blueprint: resolvedBlueprint,
        shotStyle,
      }),
      durationSec: rhythmDurations[index] ?? shotDurationSec,
    }
  })
}

export function buildTrendEditorialFallback(input: {
  topic: string
  category: string
  defaultCta: string
  learning?: TrendCreativeLearningInput
}): TrendEditorialPack {
  const editorialTemplate = pickTrendEditorialTemplate({
    topic: input.topic,
    category: input.category,
    preferredTemplateId: input.learning?.preferredEditorialTemplateId,
  })
  const angle = editorialTemplate.creativeAngle
  const hookCandidates = buildHookCandidates(
    input.topic,
    input.category,
    buildEditorialHookCandidates(editorialTemplate, input.topic),
  )
  const coverCandidates = buildCoverCandidates(
    input.topic,
    input.category,
    buildEditorialCoverCandidates(editorialTemplate, input.topic),
  )
  const coverTitle = pickBestHeadline(coverCandidates, 56, input.topic.toUpperCase())
  const hookTitle = pickBestHeadline(hookCandidates, 72, `POR QUE ${input.topic.toUpperCase()} ESTA BOMBANDO`)
  const vibe = getCategoryVibe(input.category, editorialTemplate.vibeBoost)
  const world = getCategoryWorld(input.category, editorialTemplate.worldBoost)

  return {
    editorialTemplateId: editorialTemplate.id,
    editorialTemplateLabel: editorialTemplate.label,
    angle,
    hookTitle,
    coverTitle,
    hookCandidates,
    coverCandidates,
    caption: buildCaptionFallback(input.topic, input.category, input.defaultCta),
    ctaText: input.defaultCta,
    imagePrompt: buildStandaloneCoverImagePrompt({
      topic: input.topic,
      editorialLabel: editorialTemplate.label,
      vibe,
      world,
    }),
  }
}

export function buildTrendVideoMotionFallback(input: {
  topic: string
  category: string
  styleRotation: string[]
  shotsPerVideo?: number
  shotDurationSec?: number
  learning?: TrendCreativeLearningInput
}): TrendVideoMotionPack {
  const editorialTemplate = pickTrendEditorialTemplate({
    topic: input.topic,
    category: input.category,
    preferredTemplateId: input.learning?.preferredEditorialTemplateId,
  })
  const styleRotation = applyEditorialStyleRotation(input.styleRotation, editorialTemplate)
  const shots = buildFallbackShots({
    topic: input.topic,
    category: input.category,
    styleRotation,
    editorialLabel: editorialTemplate.label,
    shotsPerVideo: input.shotsPerVideo ?? 5,
    shotDurationSec: input.shotDurationSec ?? 3,
  })

  return {
    style: shots[0]?.visualStyle ?? 'ultrarealista',
    shots,
  }
}

function normalizeShot(raw: Partial<TrendVideoShot>, index: number, fallback: TrendVideoShot): TrendVideoShot {
  return {
    shotId: raw.shotId?.trim() || `shot_${index + 1}`,
    label: raw.label?.trim() || fallback.label,
    styleRole: raw.styleRole?.trim() || fallback.styleRole,
    visualStyle: raw.visualStyle?.trim() || fallback.visualStyle,
    styleDirection: raw.styleDirection?.trim() || fallback.styleDirection,
    visualIntent: raw.visualIntent?.trim() || fallback.visualIntent,
    subjectAction: raw.subjectAction?.trim() || fallback.subjectAction,
    environmentAction: raw.environmentAction?.trim() || fallback.environmentAction,
    cameraMove: raw.cameraMove?.trim() || fallback.cameraMove,
    lens: raw.lens?.trim() || fallback.lens,
    framing: raw.framing?.trim() || fallback.framing,
    lightShift: raw.lightShift?.trim() || fallback.lightShift,
    transition: raw.transition?.trim() || fallback.transition,
    payoff: raw.payoff?.trim() || fallback.payoff,
    rhythm: raw.rhythm?.trim() || fallback.rhythm,
    motionPrompt: raw.motionPrompt?.trim() || fallback.motionPrompt,
    durationSec: clampShotDuration(raw.durationSec ?? fallback.durationSec),
  }
}

// Geração 1/2 — editorial + capa. Independente da geração de vídeo (generateTrendVideoMotion).
export async function generateTrendEditorial(input: {
  topic: string
  category: string
  relatedNews: Array<{ title: string; source: string }>
  defaultCta: string
  model: string
  learning?: TrendCreativeLearningInput
}): Promise<TrendEditorialPack> {
  const fallback = buildTrendEditorialFallback(input)
  const editorialTemplate = pickTrendEditorialTemplate({
    topic: input.topic,
    category: input.category,
    preferredTemplateId: input.learning?.preferredEditorialTemplateId,
  })
  const context = input.relatedNews.slice(0, 3).map((news) => `- ${news.title} (${news.source})`).join('\n')
  const learningContext = [
    input.learning?.preferredHookPattern ? `Hook historicamente mais forte nesta categoria: ${input.learning.preferredHookPattern}` : '',
    input.learning?.preferredEditorialTemplateId ? `Template editorial historicamente mais forte: ${input.learning.preferredEditorialTemplateId}` : '',
    input.learning?.reasons?.length ? `Motivos historicos: ${input.learning.reasons.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  try {
    const result = await generateSimpleText({
      model: input.model,
      systemPrompt:
        'Voce cria o conceito editorial (hook, capa, legenda) de videos curtos virais para Instagram. Responda SOMENTE JSON valido. Evite politica, tragedia, violencia e temas sensiveis. O imagePrompt que voce cria e para uma imagem de CAPA/THUMBNAIL isolada — nao descreve um frame de video nem depende de nenhum shot.',
      userMessage: [
        `Tema: ${input.topic}`,
        `Categoria: ${input.category}`,
        `Template editorial obrigatoria: ${editorialTemplate.label} (${editorialTemplate.id})`,
        `Angulo editorial obrigatorio: ${editorialTemplate.creativeAngle}`,
        `CTA obrigatoria base: ${input.defaultCta}`,
        learningContext ? `Aprendizado historico:\n${learningContext}` : '',
        context ? `Contexto:\n${context}` : '',
        'Retorne JSON com: hookTitle, coverTitle, hookCandidates, coverCandidates, caption, ctaText, imagePrompt.',
        'hookCandidates deve ter de 5 a 10 hooks agressivos e diferentes entre si — varie a estrutura da frase (pergunta, afirmacao, contraste, revelacao), nao repita o mesmo molde ("X e a virada que...") em todos.',
        'coverCandidates deve ter de 4 a 6 titulos curtos de capa.',
        'coverTitle deve ter no maximo 56 caracteres.',
        'caption deve ser PT-BR, curta, com CTA no final. Evite sempre abrir com "X esta dominando as buscas" — varie a abertura (pergunta retorica, contraste, dado concreto, provocacao direta).',
        'imagePrompt deve ser em PT-BR, descrever uma imagem de capa/thumbnail unica (nao um shot de video), com composicao hero legivel em miniatura.',
        'Evite cliches genericos sem especificidade concreta, como "tudo mudou", "o mundo nao sera mais o mesmo", "ninguem estava preparado" isolados sem um detalhe real do tema.',
      ].filter(Boolean).join('\n\n'),
      maxTokens: 700,
      temperature: 0.85,
    })

    const parsed = parseAIJson<Partial<TrendEditorialPack>>(result.text, 'trend editorial')
    const hookCandidates = uniqueStrings([
      ...(Array.isArray((parsed as { hookCandidates?: string[] }).hookCandidates) ? (parsed as { hookCandidates?: string[] }).hookCandidates ?? [] : []),
      parsed.hookTitle?.trim(),
      ...fallback.hookCandidates,
    ]).slice(0, 10)
    const coverCandidates = uniqueStrings([
      ...(Array.isArray((parsed as { coverCandidates?: string[] }).coverCandidates) ? (parsed as { coverCandidates?: string[] }).coverCandidates ?? [] : []),
      parsed.coverTitle?.trim(),
      ...fallback.coverCandidates,
    ]).slice(0, 8)

    return {
      editorialTemplateId: fallback.editorialTemplateId,
      editorialTemplateLabel: fallback.editorialTemplateLabel,
      angle: fallback.angle,
      hookTitle: pickBestHeadline(hookCandidates, 72, fallback.hookTitle),
      coverTitle: pickBestHeadline(coverCandidates, 56, fallback.coverTitle),
      hookCandidates,
      coverCandidates,
      caption: parsed.caption?.trim() || fallback.caption,
      ctaText: parsed.ctaText?.trim() || input.defaultCta,
      imagePrompt: parsed.imagePrompt?.trim() || fallback.imagePrompt,
    }
  } catch {
    return fallback
  }
}

// Geração 2/2 — shots cinematográficos de vídeo (text-to-video). Independente da geração editorial/capa.
export async function generateTrendVideoMotion(input: {
  topic: string
  category: string
  styleRotation: string[]
  model: string
  shotsPerVideo?: number
  shotDurationSec?: number
  learning?: TrendCreativeLearningInput
}): Promise<TrendVideoMotionPack> {
  const fallback = buildTrendVideoMotionFallback(input)
  const editorialTemplate = pickTrendEditorialTemplate({
    topic: input.topic,
    category: input.category,
    preferredTemplateId: input.learning?.preferredEditorialTemplateId,
  })
  const learnedStyleBoost = input.learning?.preferredStyle ? [input.learning.preferredStyle] : []
  const editorialStyleRotation = applyEditorialStyleRotation([...learnedStyleBoost, ...input.styleRotation], editorialTemplate)
  const styles = editorialStyleRotation.length ? editorialStyleRotation.join(', ') : fallback.style
  const shotsPerVideo = clampShotsPerVideo(input.shotsPerVideo ?? 5)
  const shotDurationSec = clampShotDuration(input.shotDurationSec ?? 3)
  const styleArc = buildShotStyleArc(shotsPerVideo, input.topic)
    .map((slot, index) => `${index + 1}. ${slot.styleRole}: ${slot.visualStyle} (${slot.styleDirection})`)
    .join('\n')
  const learningContext = [
    input.learning?.preferredStyle ? `Estilo historicamente mais forte nesta categoria: ${input.learning.preferredStyle}` : '',
    input.learning?.preferredVideoModel ? `Modelo de video historicamente mais forte: ${input.learning.preferredVideoModel}` : '',
    input.learning?.topVideoReasons?.length ? `Motivos do setup de video: ${input.learning.topVideoReasons.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  try {
    const result = await generateSimpleText({
      model: input.model,
      systemPrompt:
        'Voce cria roteiros de video curto viral para Instagram — apenas a coreografia de MOVIMENTO/CAMERA de cada shot, para geracao text-to-video. Responda SOMENTE JSON valido. Evite politica, tragedia, violencia e temas sensiveis. Estruture os videos como mini filmes cinematograficos. PROIBIDO criar shots estaticos, retratos parados, parallax sutil ou animacao que pareca foto respirando.',
      userMessage: [
        `Tema: ${input.topic}`,
        `Categoria: ${input.category}`,
        `Angulo editorial: ${editorialTemplate.creativeAngle}`,
        `Estilos permitidos: ${styles}`,
        `Quantidade de shots: ${shotsPerVideo}`,
        `Duracao por shot: ${shotDurationSec} segundos`,
        `Style arc obrigatoria por shot:\n${styleArc}`,
        learningContext ? `Aprendizado historico:\n${learningContext}` : '',
        'Retorne JSON com: style, shots.',
        'shots deve ser um array com objetos: shotId, label, styleRole, visualStyle, styleDirection, visualIntent, subjectAction, environmentAction, cameraMove, lens, framing, lightShift, transition, payoff, rhythm, motionPrompt, durationSec.',
        'Cada shot deve parecer parte do mesmo mini filme vertical 9:16, com progressao temporal real entre os beats.',
        'Cada shot precisa ter estilo visual realmente diferente do shot anterior.',
        'Regra de diversidade: shot 1 ancorado no realismo; shot 2 stylized/anime; shot 3 abstract/data/graphic; shot 4 cinematic reveal/payoff; shot 5 premium editorial payoff, se existir.',
        'Cada shot precisa descrever: intencao visual, acao principal do sujeito, reacao do ambiente, movimento de camera, lente, enquadramento, mudanca de luz, transicao e payoff final.',
        'cameraMove e lens NAO podem se repetir entre shots do mesmo video — cada shot usa um movimento de camera e uma lente diferentes dos outros shots.',
        'Varie o ritmo entre os shots. O video nao pode parecer uniforme do inicio ao fim.',
        'Nao use linguagem de movimento sutil. Evite: subtle motion, gentle parallax, slight camera move, breathing image.',
        'Evite descricoes genericas sem imagem concreta, como "energia poderosa", "algo incrivel acontece", "tudo muda" — descreva o objeto, gesto ou textura especifica que aparece no shot.',
        'motionPrompt deve ser em PT-BR, agressivamente cinematografico e anti-loop. Nao descreva uma imagem estatica — descreva o que acontece no shot do inicio ao fim.',
      ].filter(Boolean).join('\n\n'),
      maxTokens: 1600,
      temperature: 0.9,
    })

    const parsed = parseAIJson<{ style?: string; shots?: Array<Partial<TrendVideoShot>> }>(result.text, 'trend video motion')
    const rawShots = Array.isArray(parsed.shots) && parsed.shots.length ? parsed.shots : fallback.shots
    const fallbackByIndex = fallback.shots

    return {
      style: parsed.style?.trim() || fallback.style,
      shots: rawShots
        .slice(0, shotsPerVideo)
        .map((shot, index) => normalizeShot(shot, index, fallbackByIndex[index] ?? fallbackByIndex[fallbackByIndex.length - 1])),
    }
  } catch {
    return fallback
  }
}
