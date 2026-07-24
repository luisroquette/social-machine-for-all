import { describe, expect, it } from 'vitest'
import { buildStaticNewsPrompt, chooseStaticNewsDraftFormat, computeStaticNewsEditorialPriority, extractStaticImageUrls, inferStaticNewsB2BAngle, materializeStaticNewsCandidate, selectCuratedStaticImageUrls } from './brand-static-news'
import { scoreStaticImageAnalysis } from './brand-static-visual'

describe('brand static news', () => {
  it('extrai imagens de post estatico do X', () => {
    const urls = extractStaticImageUrls('x', {
      media_urls: ['https://cdn.example.com/car-1.jpg', 'https://cdn.example.com/car-2.png'],
      media_types: ['image', 'image'],
    })
    expect(urls).toEqual([
      'https://cdn.example.com/car-1.jpg',
      'https://cdn.example.com/car-2.png',
    ])
  })

  it('usa thumbnail do youtube quando nao ha media_urls', () => {
    const urls = extractStaticImageUrls('youtube', {
      thumbnailUrl: 'https://img.youtube.com/vi/abc/maxresdefault.jpg',
    })
    expect(urls).toEqual(['https://img.youtube.com/vi/abc/maxresdefault.jpg'])
  })

  it('materializa candidato com media curada quando elegivel', () => {
    const item = materializeStaticNewsCandidate({
      id: 'curated-1',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'x',
      source_url: 'https://x.com/post/1',
      source_author: 'evnews',
      source_content: 'BYD chega ao Brasil com novo híbrido plug-in e preço no Brasil já definido para início de vendas no segundo semestre',
      source_metrics: {
        media_urls: ['https://cdn.example.com/byd.jpg'],
        media_types: ['image'],
      },
      relevance_score: 88,
    })

    expect(item).not.toBeNull()
    expect(item?.launch_category).toBe('sales_brazil')
    expect(item?.media_mode).toBe('curated_image')
    expect(item?.primary_image_url).toBe('https://cdn.example.com/byd.jpg')
    expect(item?.metadata.b2b_angle).toBe('frota')
  })

  it('materializa fallback generated_image quando nao encontra imagem', () => {
    const item = materializeStaticNewsCandidate({
      id: 'curated-2',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'rss',
      source_url: 'https://site.com/noticia',
      source_author: 'portal',
      source_content: 'Geely anuncia produção local no Brasil para abastecer o mercado brasileiro em 2026',
      source_metrics: {},
      relevance_score: 70,
    })

    expect(item).not.toBeNull()
    expect(item?.media_mode).toBe('generated_image')
    expect(item?.image_urls).toEqual([])
  })

  it('descarta conteudo elegivel para reels mas fora do escopo de lancamento BR', () => {
    const item = materializeStaticNewsCandidate({
      id: 'curated-3',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'x',
      source_url: 'https://x.com/post/3',
      source_author: 'infra',
      source_content: 'Rede de eletropostos DC fast cresce com foco em operação de frota elétrica e recarga corporativa',
      source_metrics: {
        media_urls: ['https://cdn.example.com/charger.jpg'],
        media_types: ['image'],
      },
      relevance_score: 60,
    })

    expect(item).toBeNull()
  })

  it('escolhe carousel quando ha mais de uma imagem curada', () => {
    const format = chooseStaticNewsDraftFormat({
      id: 'queue-1',
      curated_content_id: 'curated-1',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'x',
      source_url: 'https://x.com/post/1',
      source_author: 'evnews',
      source_content: 'BYD chega ao Brasil com novo híbrido plug-in e preço no Brasil já definido para início de vendas no segundo semestre',
      source_metrics: null,
      launch_category: 'sales_brazil',
      launch_score: 88,
      launch_reasons: ['brazil_confirmed'],
      media_mode: 'curated_image',
      image_urls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
      primary_image_url: 'https://cdn.example.com/1.jpg',
    })
    expect(format).toBe('carousel')
  })

  it('prompt de fallback pede imagem gerada', () => {
    const prompt = buildStaticNewsPrompt({
      id: 'queue-2',
      curated_content_id: 'curated-2',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'rss',
      source_url: 'https://site.com/noticia',
      source_author: 'portal',
      source_content: 'Geely anuncia produção local no Brasil para abastecer o mercado brasileiro em 2026',
      source_metrics: null,
      launch_category: 'production_brazil',
      launch_score: 70,
      launch_reasons: ['brazil_confirmed'],
      media_mode: 'generated_image',
      image_urls: [],
      primary_image_url: null,
    }, 'feed_post')
    expect(prompt).toContain('Não há imagem curada válida')
    expect(prompt).toContain('"image_prompt"')
  })

  it('filtra urls de imagem poluidas antes da fila editorial', () => {
    const urls = selectCuratedStaticImageUrls([
      'https://cdn.example.com/profile-avatar.jpg',
      'https://cdn.example.com/byd-seal-hero.jpg',
      'https://cdn.example.com/screenshot-text.png',
      'https://cdn.example.com/geely-rear-view.jpeg',
    ])
    expect(urls).toEqual([
      'https://cdn.example.com/byd-seal-hero.jpg',
      'https://cdn.example.com/geely-rear-view.jpeg',
    ])
  })

  it('prompt curado pede estrutura editorial e fallback visual', () => {
    const prompt = buildStaticNewsPrompt({
      id: 'queue-3',
      curated_content_id: 'curated-3',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      source_platform: 'x',
      source_url: 'https://x.com/post/3',
      source_author: 'evnews',
      source_content: 'BYD chega ao Brasil com preco no Brasil e inicio de vendas confirmado',
      source_metrics: null,
      launch_category: 'sales_brazil',
      launch_score: 88,
      launch_reasons: ['brazil_confirmed'],
      media_mode: 'curated_image',
      image_urls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
      primary_image_url: 'https://cdn.example.com/1.jpg',
      metadata: { b2b_angle: 'frota', editorial_priority_score: 120 },
    }, 'carousel')

    expect(prompt).toContain('"visual_mode": "curated_image"')
    expect(prompt).toContain('"image_prompt": "..."')
    expect(prompt).toContain('Gere exatamente 2 slides')
  })

  it('calcula prioridade editorial maior para pauta com vendas, preco e imagem', () => {
    const score = computeStaticNewsEditorialPriority({
      launchScore: 80,
      sourceRelevanceScore: 85,
      imageCount: 2,
      b2bAngle: 'frota',
      launchCategory: 'sales_brazil',
      text: 'preco no brasil com inicio de vendas no brasil',
    })
    expect(score).toBeGreaterThan(120)
  })

  it('infere angulo de recarga de destino para shopping e condominio', () => {
    const angle = inferStaticNewsB2BAngle('novo ev chega ao brasil e pressiona shopping, condominio e estacionamento', 'launch_brazil')
    expect(angle).toBe('recarga_destino')
  })

  it('penaliza screenshot com watermark e muito texto', () => {
    const analysis = scoreStaticImageAnalysis({
      url: 'https://cdn.example.com/screenshot-instagram-post.jpg',
      width: 1080,
      height: 1920,
      edgeDensity: 0.31,
      ocrText: '@felipeferaoficial Seguir Posts BYD chega ao Brasil com 400 km CLTC',
    })

    expect(analysis.score).toBeLessThan(0)
    expect(analysis.watermarkScore).toBeGreaterThan(0)
    expect(analysis.screenshotScore).toBeGreaterThan(0)
  })

  it('premia hero shot limpo do veiculo', () => {
    const analysis = scoreStaticImageAnalysis({
      url: 'https://cdn.example.com/byd-seal-hero-front.jpg',
      width: 1600,
      height: 1000,
      edgeDensity: 0.13,
      ocrText: '',
    })

    expect(analysis.score).toBeGreaterThan(20)
    expect(analysis.heroShotScore).toBeGreaterThan(0)
  })
})
