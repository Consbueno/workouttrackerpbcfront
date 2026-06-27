import api from './axios'

export interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

export const treinadorApi = {
  chat: (mensagem: string, historico: Mensagem[]) =>
    api.post<{ resposta: string; acao?: string }>('/treinador/chat', { mensagem, historico }),
}
