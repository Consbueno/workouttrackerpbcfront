import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Save, AlertCircle, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { useNextDay, useDay, useLastDay, useHistoricoDias } from '@/hooks/use-training'
import { diasApi } from '@/api/treino'
import { BlockBadge } from '@/components/training/block-badge'
import { ExerciseCard, type ExerciseExecution } from '@/components/training/exercise-card'
import { RestTimer } from '@/components/training/rest-timer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dumbbell } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

export default function ExecucaoPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { restTimerEnabled } = useAppStore()
  const { data: nextDay } = useNextDay()
  const { data: lastDay } = useLastDay()
  const { data: historico = [] } = useHistoricoDias()
  const [showHistorico, setShowHistorico] = useState(false)
  const dayId = nextDay?.id as number | undefined
  const { data: day, isLoading } = useDay(dayId)

  const [exercises, setExercises] = useState<ExerciseExecution[]>([])
  const [restTimer, setRestTimer] = useState<{ seconds: number } | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (day?.exercises) {
      setExercises(day.exercises.map((ex: ExerciseExecution) => ({
        ...ex,
        actual_load_kg: ex.actual_load_kg ?? ex.planned_load_kg,
      })))
    }
  }, [day])

  const startMutation = useMutation({
    mutationFn: () => diasApi.iniciar(dayId!),
    onSuccess: () => {
      setStarted(true)
      qc.invalidateQueries({ queryKey: ['proximo-dia'] })
    },
  })

  const draftMutation = useMutation({
    mutationFn: () => diasApi.rascunho(dayId!, { exercises }),
    onSuccess: () => toast({ title: 'Rascunho salvo!' }),
  })

  const completeMutation = useMutation({
    mutationFn: (notes?: string) =>
      diasApi.concluir(dayId!, { exercises, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proximo-dia'] })
      qc.invalidateQueries({ queryKey: ['ultimo-dia'] })
      qc.invalidateQueries({ queryKey: ['historico-dias'] })
      qc.invalidateQueries({ queryKey: ['dias-stats'] })
      qc.invalidateQueries({ queryKey: ['programa-ativo'] })
      toast({ title: 'Treino concluído! Ótimo trabalho! 💪' })
      navigate('/')
    },
  })

  const missMutation = useMutation({
    mutationFn: () => diasApi.falta(dayId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proximo-dia'] })
      qc.invalidateQueries({ queryKey: ['ultimo-dia'] })
      qc.invalidateQueries({ queryKey: ['historico-dias'] })
      qc.invalidateQueries({ queryKey: ['dias-stats'] })
      toast({ title: 'Dia marcado como falta.' })
      navigate('/')
    },
  })

  const revertMutation = useMutation({
    mutationFn: (id: number) => diasApi.reverter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proximo-dia'] })
      qc.invalidateQueries({ queryKey: ['ultimo-dia'] })
      qc.invalidateQueries({ queryKey: ['historico-dias'] })
      qc.invalidateQueries({ queryKey: ['dias-stats'] })
      qc.invalidateQueries({ queryKey: ['programa-ativo'] })
      toast({ title: 'Treino revertido para pendente.' })
    },
    onError: () => toast({ title: 'Erro ao reverter.', variant: 'destructive' }),
  })

  const handleExerciseChange = (id: number, field: string, value: unknown) => {
    setExercises(prev => prev.map(ex => ex.id === id ? { ...ex, [field]: value } : ex))
  }

  const handleToggle = (id: number) => {
    setExercises(prev => prev.map(ex => ex.id === id ? { ...ex, is_completed: !ex.is_completed } : ex))
  }

  const handleRestComplete = (seconds: number) => {
    if (restTimerEnabled) setRestTimer({ seconds })
  }

  const completedCount = exercises.filter(e => e.is_completed).length

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    )
  }

  if (!nextDay) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Ciclo concluído!</h2>
        <p className="text-muted-foreground mb-6">Todos os treinos foram finalizados.</p>
        <Button onClick={() => navigate('/treino/fim-ciclo')}>Ver Resumo do Ciclo</Button>
        {lastDay && (
          <button
            onClick={() => {
              if (confirm(`Reverter Dia ${lastDay.day_number} (${lastDay.status === 'completed' ? 'concluído' : 'falta'}) para pendente?`)) {
                revertMutation.mutate(lastDay.id)
              }
            }}
            disabled={revertMutation.isPending}
            className="mt-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 mx-auto"
          >
            <RotateCcw className="h-3 w-3" />
            Reverter último treino (Dia {lastDay.day_number})
          </button>
        )}
      </div>
    )
  }

  const isInProgress = nextDay.status === 'in_progress' || started

  return (
    <div className="space-y-4 pb-44">
      {/* Header */}
      <div className="space-y-2">
        <BlockBadge color={day?.block_color ?? 'blue'} name={day?.block_name ?? ''} />
        <div>
          <h1 className="text-xl font-bold">
            Treino {day?.letter} — {day?.split_description}
          </h1>
          <p className="text-sm text-muted-foreground">
            Dia {day?.day_number} de {day?.total_days} · Semana {day?.week_number}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{completedCount}</span>/{exercises.length} exercícios concluídos
        </div>
      </div>

      {/* Iniciar treino se ainda não começou */}
      {!isInProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <Dumbbell className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-medium">Pronto para começar?</p>
              <p className="text-xs text-muted-foreground">Inicie o treino para registrar o horário.</p>
            </div>
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Iniciando...' : 'Iniciar'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lista de exercícios */}
      <div className="space-y-3">
        {exercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            onChange={handleExerciseChange}
            onToggle={handleToggle}
            onCompleted={seconds => handleRestComplete(seconds)}
          />
        ))}
      </div>

      {/* Histórico de treinos realizados */}
      {historico.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowHistorico(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              Treinos anteriores ({historico.length})
            </span>
            {showHistorico ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showHistorico && (
            <div className="border-t divide-y">
              {historico.map(d => (
                <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      Dia {d.day_number} — Treino {d.letter} · Sem. {d.week_number}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{d.split_description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      d.status === 'completed'
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-red-500/15 text-red-400'
                    )}>
                      {d.status === 'completed' ? 'Realizado' : 'Falta'}
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`Reverter Dia ${d.day_number} para pendente?`)) {
                          revertMutation.mutate(d.id)
                        }
                      }}
                      disabled={revertMutation.isPending}
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      title="Reverter para pendente"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timer de descanso */}
      {restTimer && (
        <RestTimer
          seconds={restTimer.seconds}
          onFinish={() => setRestTimer(null)}
          onDismiss={() => setRestTimer(null)}
        />
      )}

      {/* Botões de ação fixos */}
      <div className={cn(
        'fixed bottom-16 md:bottom-0 left-0 right-0 z-30 p-3 border-t bg-background',
        restTimer ? 'bottom-36 md:bottom-24' : ''
      )}>
        <div className="mx-auto max-w-4xl flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-red-700/80 hover:bg-red-700 text-white border-red-700"
            onClick={() => {
              if (confirm('Deseja marcar este dia como Falta? Isso avançará para o próximo treino.')) {
                missMutation.mutate()
              }
            }}
            disabled={missMutation.isPending}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Falta
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => draftMutation.mutate()}
            disabled={draftMutation.isPending}
          >
            <Save className="h-4 w-4 mr-1" />
            Salvar
          </Button>

          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => {
              const msg = completedCount < exercises.length
                ? `Deseja concluir com ${completedCount} de ${exercises.length} exercícios realizados?`
                : 'Confirma a conclusão do treino?'
              if (confirm(msg)) completeMutation.mutate(undefined)
            }}
            disabled={completeMutation.isPending}
          >
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Concluir
          </Button>
        </div>

        {completedCount === 0 && isInProgress && (
          <div className="mx-auto max-w-4xl mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            <span>Você ainda não marcou nenhum exercício como concluído.</span>
          </div>
        )}
      </div>
    </div>
  )
}
