/**
 * Ângulos rotativos de CTA "seguir o perfil" para a caption dos Reels.
 *
 * Por que existe (16/06/2026):
 * O perfil tinha muitas views e poucos seguidores. A caption fechava sempre com o
 * MESMO boilerplate ("Siga @x pra mais conteudo sobre IA") — genérico, sem razão
 * pra seguir e com fingerprint repetido. Estes ângulos dão uma RAZÃO concreta pra
 * seguir, alternando entre as 3 facetas da identidade aprovada: digest diário de
 * IA + insider que testa em produção + série/continuidade. A rotação também evita
 * padrão repetido e, no futuro (quando insights por-reel forem liberadas), permite
 * descobrir qual ângulo converte melhor.
 *
 * O texto é uma INSTRUÇÃO de ângulo para o modelo redigir o fechamento com a voz
 * natural do perfil — não uma frase fixa para colar.
 */
export const FOLLOW_CTA_ANGLES: ReadonlyArray<{ key: string; angle: string }> = [
  {
    key: 'digest',
    angle:
      'DIGEST DIÁRIO: tem novidade de IA testada aqui todo dia. Convide a pessoa a seguir pra receber a IA do dia antes de todo mundo.',
  },
  {
    key: 'insider',
    angle:
      'INSIDER: você testa essas ferramentas em produção e mostra o que funciona de verdade. Convide a seguir quem quer o filtro de quem USA IA, não de quem só comenta.',
  },
  {
    key: 'serie',
    angle:
      'CONTINUIDADE: esse assunto tem desdobramento nos próximos posts. Convide a seguir pra não perder a continuação.',
  },
  {
    key: 'profundidade',
    angle:
      'PROFUNDIDADE SEM HYPE: aqui o tema é destrinchado sem hype nem manchete vazia. Convide a seguir quem quer entender de verdade.',
  },
  {
    key: 'curadoria',
    angle:
      'CURADORIA: saem centenas de lançamentos de IA por dia e você filtra só o que importa. Convide a seguir pra economizar tempo e não se perder no hype.',
  },
]

/**
 * Escolhe um ângulo de follow-CTA. `rng` injetável para teste determinístico.
 */
export function pickFollowCtaAngle(rng: () => number = Math.random): { key: string; angle: string } {
  const i = Math.floor(rng() * FOLLOW_CTA_ANGLES.length) % FOLLOW_CTA_ANGLES.length
  return FOLLOW_CTA_ANGLES[i]
}
