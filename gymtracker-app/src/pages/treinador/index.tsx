import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils'
import { treinadorApi, type Mensagem } from '@/api/treinador'
import { toast } from '@/hooks/use-toast'
import { useQueryClient } from '@tanstack/react-query'

const MODOS = [
  { label: 'Perfil', prompt: 'Mostre meu perfil de atleta e avalie meus dados.' },
  { label: 'Objetivo', prompt: 'Quero revisar e ajustar meu objetivo de treino.' },
  { label: 'Prescrever', prompt: 'Prescreve um programa de 16 semanas para mim.' },
  { label: 'Avaliar', prompt: 'Avalia meu programa de treino atual.' },
  { label: 'Diagnóstico', prompt: 'Mostra meu diagnóstico de progresso.' },
]

const BOAS_VINDAS: Mensagem = {
  role: 'assistant',
  content: `Olá! Sou seu treinador pessoal integrado ao GymTracker. Tenho acesso ao seu perfil, programa ativo e histórico de medições.

Posso te ajudar com:
- **Perfil** — interpretar seus dados e condições de saúde
- **Objetivo** — definir ou revisar sua meta e avaliar se o prazo é realístico
- **Prescrever** — montar um programa de 16 semanas com periodização em blocos e **salvar automaticamente** no GymTracker
- **Avaliar** — analisar seu programa atual e identificar problemas
- **Diagnóstico** — cruzar suas medições com treinos e projetar resultados

Use os botões acima para começar, ou me diga o que precisa.`,
}

function renderContent(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="font-bold text-sm mt-4 mb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(<p key={i} className="font-semibold text-sm">{line.slice(2, -2)}</p>)
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      const bullet = line.startsWith('- ') ? line.slice(2) : line.slice(2)
      elements.push(
        <li key={i} className="text-sm ml-3 list-disc list-inside leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatInline(bullet) }}
        />
      )
    } else if (/^\d+\. /.test(line)) {
      elements.push(
        <li key={i} className="text-sm ml-3 list-decimal list-inside leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatInline(line.replace(/^\d+\. /, '')) }}
        />
      )
    } else if (line.startsWith('```')) {
      // bloco de código — coletar até fechar
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="bg-muted rounded p-2 text-xs overflow-x-auto my-2 whitespace-pre-wrap">
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatInline(line) }}
        />
      )
    }
    i++
  }

  return <>{elements}</>
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs">$1</code>')
}

export default function TreinadorPage() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([BOAS_VINDAS])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, loading])

  const enviar = async (texto?: string) => {
    const msg = (texto ?? input).trim()
    if (!msg || loading) return

    const novasMensagens: Mensagem[] = [...mensagens, { role: 'user', content: msg }]
    setMensagens(novasMensagens)
    setInput('')
    setLoading(true)

    try {
      // histórico exclui a mensagem de boas-vindas (role assistant inicial)
      const historico = novasMensagens.slice(1, -1)
      const { data } = await treinadorApi.chat(msg, historico)
      setMensagens(prev => [...prev, { role: 'assistant', content: data.resposta }])
      if (data.acao === 'programa_criado') {
        queryClient.invalidateQueries({ queryKey: ['programa-ativo'] })
        queryClient.invalidateQueries({ queryKey: ['proximo-dia'] })
        queryClient.invalidateQueries({ queryKey: ['historico-dias'] })
        toast({ title: '✅ Programa criado no GymTracker!', description: 'Acesse Treino → Manutenção para ver os detalhes.' })
      }
    } catch {
      toast({ title: 'Erro ao conectar com o treinador. Tente novamente.', variant: 'destructive' })
      setMensagens(prev => prev.slice(0, -1)) // remove a mensagem do usuário se falhar
    } finally {
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] md:h-[calc(100vh-2rem)]">
      <PageHeader
        title="Treinador"
        description="Personal trainer AI com acesso ao seu perfil e histórico."
      />

      {/* Botões de modo rápido */}
      <div className="flex gap-2 flex-wrap mb-3">
        {MODOS.map(m => (
          <Button
            key={m.label}
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => enviar(m.prompt)}
            className="text-xs h-7"
          >
            {m.label}
          </Button>
        ))}
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {mensagens.map((msg, idx) => (
          <div
            key={idx}
            className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
          >
            {/* Avatar */}
            <div className={cn(
              'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
              msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
            )}>
              {msg.role === 'user'
                ? <User className="h-4 w-4" />
                : <Bot className="h-4 w-4 text-primary" />
              }
            </div>

            {/* Balão */}
            <div className={cn(
              'max-w-[85%] rounded-2xl px-4 py-3',
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                : 'bg-muted rounded-tl-sm'
            )}>
              {msg.role === 'user'
                ? <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                : <div className="space-y-0.5">{renderContent(msg.content)}</div>
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Pensando...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-3 border-t mt-3">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
          rows={2}
          disabled={loading}
          className="resize-none text-sm"
        />
        <Button
          size="icon"
          onClick={() => enviar()}
          disabled={!input.trim() || loading}
          className="self-end h-10 w-10 shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
