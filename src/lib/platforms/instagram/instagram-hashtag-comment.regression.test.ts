/**
 * REGRESSÃO: Hashtags devem ser postadas como primeiro comentário, não na caption.
 * Bug: hashtags na caption são fingerprint de bot e causam redução de alcance/shadow ban.
 * Fix: splitHashtags() + postComment() após publicação bem-sucedida.
 */
import { describe, it, expect } from 'vitest'
import { splitHashtags } from './client'

describe('REGRESSÃO: splitHashtags — hashtags movidas para comentário', () => {
  it('extrai hashtags do final da caption', () => {
    const caption = 'A IA está mudando tudo.\n\nEste é o contexto.\n\n#inteligenciaartificial #IA #tech'
    const { cleanCaption, hashtags } = splitHashtags(caption)
    expect(cleanCaption).not.toContain('#')
    expect(hashtags).toBe('#inteligenciaartificial #IA #tech')
  })

  it('extrai hashtags inline misturadas no texto', () => {
    const caption = 'A #OpenAI lançou algo novo. Vale a pena #conferir. #IA #tech'
    const { hashtags } = splitHashtags(caption)
    expect(hashtags).toBe('#OpenAI #conferir #IA #tech')
  })

  it('cleanCaption não tem hashtags residuais', () => {
    const caption = 'Hook forte aqui.\n\nContexto com dado.\n\nCTA aqui.\n\n#eletroposto #EVBrasil #brand'
    const { cleanCaption } = splitHashtags(caption)
    expect(cleanCaption).not.toMatch(/#\w/)
  })

  it('caption sem hashtags retorna hashtags vazio e caption intacta', () => {
    const caption = 'Post sem nenhuma hashtag aqui.'
    const { cleanCaption, hashtags } = splitHashtags(caption)
    expect(cleanCaption).toBe(caption)
    expect(hashtags).toBe('')
  })

  it('suporta acentos em hashtags PT-BR', () => {
    const caption = 'Texto normal.\n\n#mobilidadeelétrica #ônibus #ação'
    const { hashtags } = splitHashtags(caption)
    expect(hashtags).toContain('#mobilidadeelétrica')
    expect(hashtags).toContain('#ônibus')
    expect(hashtags).toContain('#ação')
  })

  it('cleanCaption não tem linhas em branco duplas extras após remoção', () => {
    const caption = 'Linha 1.\n\n#tag1 #tag2'
    const { cleanCaption } = splitHashtags(caption)
    expect(cleanCaption).not.toMatch(/\n{3,}/)
  })
})
