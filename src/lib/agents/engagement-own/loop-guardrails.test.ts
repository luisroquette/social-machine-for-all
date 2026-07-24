import { describe, expect, it } from 'vitest'
import {
  assessNovelty,
  buildThreadMemory,
  decideGuardrailAction,
  parseHandleList,
  resolveThreadId,
} from './loop-guardrails'

describe('engagement-own loop guardrails', () => {
  it('normaliza listas de handles para owned/known agents', () => {
    const handles = parseHandleList('@Your_AI_Profile, example_handle', ' @bot_lab ')
    expect(Array.from(handles).sort()).toEqual(['bot_lab', 'example_handle', 'your_ai_profile'])
  })

  it('usa conversation_id como thread_id quando disponivel', () => {
    expect(resolveThreadId({
      conversationId: 'conv-123',
      rootTweetId: 'root-123',
      currentReplyId: 'reply-123',
    })).toBe('conv-123')
  })

  it('bloqueia cross-talk same-owner com alternancia curta e sem terceiros', () => {
    const memory = buildThreadMemory({
      ownHandle: 'your_ai_profile',
      replyAuthor: 'example_handle',
      currentReplyId: '333',
      threadId: 'conv-333',
      recentReplies: [
        { id: '111', author: 'example_handle', text: 'Primeiro ponto', createdAt: '2026-06-20T12:00:00.000Z', threadId: 'conv-333' },
        { id: '333', author: 'example_handle', text: 'Segundo ponto', createdAt: '2026-06-20T12:05:00.000Z', threadId: 'conv-333' },
      ],
      recentPairActions: [
        {
          createdAt: '2026-06-20T12:02:00.000Z',
          executedAt: '2026-06-20T12:02:30.000Z',
          status: 'executed',
          commentText: 'Resposta anterior',
          metadata: { guardrail: { hasNovelty: false } },
        },
      ],
    })

    const novelty = assessNovelty({
      candidateReply: 'Concordo com o ponto.',
      originalReplyText: 'Segundo ponto',
      recentOwnReplies: ['Resposta anterior'],
    })

    const decision = decideGuardrailAction({
      memory,
      novelty,
      counterpartyHandle: 'example_handle',
      ownedHandles: parseHandleList('your_ai_profile,example_handle'),
      knownAgentHandles: new Set<string>(),
    })

    expect(memory.turnAlternationStreak).toBeGreaterThanOrEqual(3)
    expect(decision.action).toBe('block')
    expect(decision.reasons).toContain('same_owner_cross_talk')
  })

  it('bloqueia same-owner logo no primeiro reply, sem depender de alternancia', () => {
    const memory = buildThreadMemory({
      ownHandle: 'your_ai_profile',
      replyAuthor: 'example_owner',
      currentReplyId: 'first-touch',
      threadId: 'conv-first-touch',
      recentReplies: [
        { id: 'first-touch', author: 'example_owner', text: 'Discordo desse ponto', createdAt: '2026-07-06T12:00:00.000Z', threadId: 'conv-first-touch' },
      ],
      recentPairActions: [],
    })

    const novelty = assessNovelty({
      candidateReply: 'Nos nossos testes a latência caiu 18%, mas depende do índice usado.',
      originalReplyText: 'Discordo desse ponto',
      recentOwnReplies: [],
    })

    const decision = decideGuardrailAction({
      memory,
      novelty,
      counterpartyHandle: 'example_owner',
      ownedHandles: parseHandleList('your_ai_profile,example_owner,example_handle'),
      knownAgentHandles: new Set<string>(),
    })

    expect(decision.action).toBe('block')
    expect(decision.reasons).toContain('same_owner_hard_block')
  })

  it('exige novelty forte quando loop score entra em risco medio', () => {
    const memory = buildThreadMemory({
      ownHandle: 'your_ai_profile',
      replyAuthor: 'usuario_recorrente',
      currentReplyId: '444',
      threadId: 'conv-444',
      recentReplies: [
        { id: '111', author: 'usuario_recorrente', text: 'Comentário A', createdAt: '2026-06-20T11:00:00.000Z', threadId: 'conv-444' },
        { id: '150', author: 'outra_pessoa', text: 'Comentário lateral', createdAt: '2026-06-20T11:01:00.000Z', threadId: 'conv-444' },
        { id: '222', author: 'usuario_recorrente', text: 'Comentário B', createdAt: '2026-06-20T11:05:00.000Z', threadId: 'conv-444' },
        { id: '320', author: 'terceiro', text: 'Outro comentário', createdAt: '2026-06-20T11:06:00.000Z', threadId: 'conv-444' },
        { id: '444', author: 'usuario_recorrente', text: 'Comentário C', createdAt: '2026-06-20T11:10:00.000Z', threadId: 'conv-444' },
      ],
      recentPairActions: [
        {
          createdAt: '2026-06-20T11:02:00.000Z',
          executedAt: '2026-06-20T11:02:15.000Z',
          status: 'executed',
          commentText: 'Resposta 1',
          metadata: { guardrail: { hasNovelty: true } },
        },
        {
          createdAt: '2026-06-20T11:07:00.000Z',
          executedAt: '2026-06-20T11:07:10.000Z',
          status: 'executed',
          commentText: 'Resposta 2',
          metadata: { guardrail: { hasNovelty: false } },
        },
      ],
    })

    const novelty = assessNovelty({
      candidateReply: 'Boa, concordo com isso.',
      originalReplyText: 'Comentário C',
      recentOwnReplies: ['Resposta 1', 'Resposta 2'],
    })

    const decision = decideGuardrailAction({
      memory,
      novelty,
      counterpartyHandle: 'usuario_recorrente',
      ownedHandles: parseHandleList('your_ai_profile'),
      knownAgentHandles: new Set<string>(),
    })

    expect(decision.action).toBe('allow_if_strong_novelty')
    expect(novelty.strong).toBe(false)
  })

  it('entra em cooldown quando ha looping acelerado e baixa novidade recorrente', () => {
    const memory = buildThreadMemory({
      ownHandle: 'your_ai_profile',
      replyAuthor: 'research_bot',
      currentReplyId: '666',
      threadId: 'conv-666',
      recentReplies: [
        { id: '111', author: 'research_bot', text: 'A', createdAt: '2026-06-20T11:00:00.000Z', threadId: 'conv-666' },
        { id: '222', author: 'research_bot', text: 'B', createdAt: '2026-06-20T11:04:00.000Z', threadId: 'conv-666' },
        { id: '333', author: 'research_bot', text: 'C', createdAt: '2026-06-20T11:08:00.000Z', threadId: 'conv-666' },
        { id: '666', author: 'research_bot', text: 'D', createdAt: '2026-06-20T11:12:00.000Z', threadId: 'conv-666' },
      ],
      recentPairActions: [
        {
          createdAt: '2026-06-20T11:01:00.000Z',
          executedAt: '2026-06-20T11:01:10.000Z',
          status: 'executed',
          commentText: 'Resposta repetida 1',
          metadata: { guardrail: { hasNovelty: false } },
        },
        {
          createdAt: '2026-06-20T11:05:00.000Z',
          executedAt: '2026-06-20T11:05:10.000Z',
          status: 'executed',
          commentText: 'Resposta repetida 2',
          metadata: { guardrail: { hasNovelty: false } },
        },
        {
          createdAt: '2026-06-20T11:09:00.000Z',
          executedAt: '2026-06-20T11:09:10.000Z',
          status: 'executed',
          commentText: 'Resposta repetida 3',
          metadata: { guardrail: { hasNovelty: false } },
        },
      ],
    })

    const novelty = assessNovelty({
      candidateReply: 'Boa, faz sentido.',
      originalReplyText: 'D',
      recentOwnReplies: ['Resposta repetida 1', 'Resposta repetida 2', 'Resposta repetida 3'],
    })

    const decision = decideGuardrailAction({
      memory,
      novelty,
      counterpartyHandle: 'research_bot',
      ownedHandles: parseHandleList('your_ai_profile'),
      knownAgentHandles: parseHandleList('research_bot'),
    })

    expect(decision.action).toBe('cooldown')
    expect(decision.loopScore).toBeGreaterThanOrEqual(0.78)
  })

  it('isola duas threads diferentes do mesmo perfil', () => {
    const memory = buildThreadMemory({
      ownHandle: 'your_ai_profile',
      replyAuthor: 'mesmo_autor',
      currentReplyId: 'thread-b-2',
      threadId: 'thread-b',
      recentReplies: [
        { id: 'thread-a-1', author: 'mesmo_autor', text: 'A1', createdAt: '2026-06-20T10:00:00.000Z', threadId: 'thread-a' },
        { id: 'thread-b-1', author: 'mesmo_autor', text: 'B1', createdAt: '2026-06-20T10:05:00.000Z', threadId: 'thread-b' },
        { id: 'thread-b-2', author: 'mesmo_autor', text: 'B2', createdAt: '2026-06-20T10:10:00.000Z', threadId: 'thread-b' },
      ],
      recentPairActions: [
        {
          createdAt: '2026-06-20T10:06:00.000Z',
          executedAt: '2026-06-20T10:06:10.000Z',
          status: 'executed',
          commentText: 'Resposta na thread B',
          metadata: { guardrail: { hasNovelty: true } },
        },
      ],
    })

    expect(memory.threadId).toBe('thread-b')
    expect(memory.recentThirdPartyReplies).toBe(2)
    expect(memory.pairDominance).toBe(1)
  })

  it('marca novelty forte quando a resposta adiciona dado tecnico concreto', () => {
    const novelty = assessNovelty({
      candidateReply: 'Nos nossos testes, o recall caiu 12% com IVF-PQ. Vocês mediram P95 e custo de RAM também?',
      originalReplyText: 'Qual índice vocês usaram?',
      recentOwnReplies: ['Resposta genérica anterior'],
    })

    expect(novelty.useful).toBe(true)
    expect(novelty.strong).toBe(true)
    expect(novelty.score).toBeGreaterThan(0.55)
  })
})
