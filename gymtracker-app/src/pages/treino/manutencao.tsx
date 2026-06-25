import React, { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Trash2, AlertCircle, RotateCcw, CheckCircle2, ChevronDown, ChevronUp, Save, Ban, ArrowUp, ArrowDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { exerciciosApi, atletaApi, academiaApi } from '@/api/cadastros'
import { programasApi, diasApi } from '@/api/treino'
import { MUSCLE_GROUPS, BLOCK_COLORS } from '@/lib/constants'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Tipos ──────────────────────────────────────────────────────────────────

interface BlockConfig {
  block_order: number; name: string; start_week: number; end_week: number
  color: string; target_reps: string; target_intensity: string; default_rest_seconds: number
}

interface ExerciseBlockConfig {
  block_order: number; sets: number; reps: string; load_kg: number; rest_seconds: number
}

interface SplitExercise {
  _key: string; exercise_id: number | null; exercise_order: number
  block_configs: ExerciseBlockConfig[]
}

interface Split {
  _key: string; letter: string; description: string
  muscle_groups: string[]; split_order: number
  exercises: SplitExercise[]
}

interface TrainingDay {
  id: number; day_number: number; week_number: number; status: string
  letter: string; split_description: string; block_name: string; block_color: string
}

interface DayExercise {
  id: number; exercise_name: string
  planned_sets: number; planned_reps: string; planned_load_kg: number; planned_rest_seconds: number
  actual_load_kg: number | null; actual_reps: unknown; is_completed: boolean
}

const DEFAULT_BLOCKS: BlockConfig[] = [
  { block_order: 1, name: 'Resistência', start_week: 1,  end_week: 4,  color: 'blue',   target_reps: '15-25', target_intensity: '50-65% 1RM', default_rest_seconds: 45  },
  { block_order: 2, name: 'Hipertrofia', start_week: 5,  end_week: 10, color: 'yellow', target_reps: '8-12',  target_intensity: '65-80% 1RM', default_rest_seconds: 75  },
  { block_order: 3, name: 'Força',       start_week: 11, end_week: 15, color: 'red',    target_reps: '3-6',   target_intensity: '80-92% 1RM', default_rest_seconds: 180 },
  { block_order: 4, name: 'Deload',      start_week: 16, end_week: 16, color: 'gray',   target_reps: '12-15', target_intensity: '50-60% 1RM', default_rest_seconds: 60  },
]

function genKey() { return Math.random().toString(36).slice(2) }

function makeDefaultExercise(blockCount: number, order: number): SplitExercise {
  return {
    _key: genKey(), exercise_id: null, exercise_order: order,
    block_configs: Array.from({ length: blockCount }, (_, i) => ({
      block_order: i + 1, sets: 3, reps: '10', load_kg: 0, rest_seconds: 60,
    })),
  }
}

// ── Calendário de Treinos (Step 5) ──────────────────────────────────────────

function CalendarioView({ onBack, programaId, onAbandon }: { onBack: () => void; programaId?: number; onAbandon: () => void }) {
  const qc = useQueryClient()
  const [expandedDay, setExpandedDay] = useState<number | null>(null)
  const [planEdits, setPlanEdits] = useState<Record<number, Partial<DayExercise>>>({})
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({})

  const { data: allDays = [], isLoading } = useQuery({
    queryKey: ['todos-dias'],
    queryFn: () => diasApi.list().then(r => r.data.data as TrainingDay[]),
    staleTime: 60_000,
  })

  const { data: dayDetail } = useQuery({
    queryKey: ['dia', expandedDay],
    queryFn: () => diasApi.get(expandedDay!).then(r => r.data.data),
    enabled: expandedDay !== null,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['todos-dias'] })
    qc.invalidateQueries({ queryKey: ['proximo-dia'] })
    qc.invalidateQueries({ queryKey: ['ultimo-dia'] })
    qc.invalidateQueries({ queryKey: ['historico-dias'] })
    qc.invalidateQueries({ queryKey: ['programa-ativo'] })
    qc.invalidateQueries({ queryKey: ['dias-stats'] })
  }

  const markMutation = useMutation({
    mutationFn: (id: number) => diasApi.marcarRealizado(id),
    onSuccess: () => { invalidate(); toast({ title: 'Marcado como realizado.' }) },
    onError: () => toast({ title: 'Erro ao marcar.', variant: 'destructive' }),
  })

  const revertMutation = useMutation({
    mutationFn: (id: number) => diasApi.reverter(id),
    onSuccess: () => { invalidate(); toast({ title: 'Revertido para pendente.' }) },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao reverter.'
      toast({ title: msg, variant: 'destructive' })
    },
  })

  const savePlanMutation = useMutation({
    mutationFn: async ({ dayId, exercises }: { dayId: number; exercises: DayExercise[] }) => {
      await Promise.all(
        exercises.map(ex => {
          const edit = planEdits[ex.id]
          if (!edit) return Promise.resolve()
          return diasApi.updateExercicioPlano(dayId, ex.id, edit)
        })
      )
    },
    onSuccess: (_, { dayId }) => {
      setPlanEdits({})
      qc.invalidateQueries({ queryKey: ['dia', dayId] })
      toast({ title: 'Plano salvo com sucesso.' })
    },
    onError: () => toast({ title: 'Erro ao salvar plano.', variant: 'destructive' }),
  })

  const abandonMutation = useMutation({
    mutationFn: () => programasApi.abandonar(programaId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programa-ativo'] })
      qc.invalidateQueries({ queryKey: ['todos-dias'] })
      qc.invalidateQueries({ queryKey: ['proximo-dia'] })
      qc.invalidateQueries({ queryKey: ['dias-stats'] })
      toast({ title: 'Programa abandonado. Você pode criar um novo.' })
      onAbandon()
    },
    onError: () => toast({ title: 'Erro ao abandonar programa.', variant: 'destructive' }),
  })

  const byBlock = useMemo(() => {
    const map: Record<string, { color: string; days: TrainingDay[] }> = {}
    for (const d of allDays) {
      if (!map[d.block_name]) map[d.block_name] = { color: d.block_color, days: [] }
      map[d.block_name].days.push(d)
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v }))
  }, [allDays])

  const statusLabel = (s: string) =>
    s === 'completed' ? 'Realizado' : s === 'missed' ? 'Falta' : s === 'in_progress' ? 'Em andamento' : 'Pendente'

  const statusClass = (s: string) =>
    s === 'completed' ? 'bg-green-500/15 text-green-400' :
    s === 'missed' ? 'bg-red-500/15 text-red-400' :
    s === 'in_progress' ? 'bg-blue-500/15 text-blue-400' :
    'bg-muted text-muted-foreground'

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Calendário</h2>
        <Badge variant="outline">{allDays.length} dias</Badge>
        <div className="flex-1" />
        {programaId && (
          <button
            onClick={() => {
              if (confirm('Abandonar o programa atual? Você poderá criar um novo programa em seguida.')) {
                abandonMutation.mutate()
              }
            }}
            disabled={abandonMutation.isPending}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
          >
            <Ban className="h-3.5 w-3.5" />
            Abandonar
          </button>
        )}
      </div>

      {byBlock.map(block => {
        const colorCfg = BLOCK_COLORS.find(c => c.value === block.color)
        const isCollapsed = collapsedBlocks[block.name] ?? false
        const doneCount = block.days.filter(d => d.status === 'completed').length

        return (
          <div key={block.name} className={cn('border-l-4 rounded-lg border overflow-hidden', colorCfg?.border ?? 'border-l-gray-400')}>
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
              onClick={() => setCollapsedBlocks(prev => ({ ...prev, [block.name]: !isCollapsed }))}
            >
              <div className="flex items-center gap-3">
                <span className={cn('h-3 w-3 rounded-full', colorCfg?.bg ?? 'bg-gray-400')} />
                <span className="font-medium text-sm">{block.name}</span>
                <span className="text-xs text-muted-foreground">{block.days.length} dias · {doneCount} realizados</span>
              </div>
              {isCollapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </button>

            {!isCollapsed && (
              <div className="border-t divide-y">
                {block.days.map(d => {
                  const isExpanded = expandedDay === d.id
                  const exercises: DayExercise[] = isExpanded && dayDetail?.exercises ? dayDetail.exercises : []
                  const hasEdits = exercises.some(ex => planEdits[ex.id])

                  return (
                    <div key={d.id}>
                      {/* Linha do dia */}
                      <div className="flex items-center gap-2 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            Dia {d.day_number} · Sem. {d.week_number} — Treino {d.letter}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{d.split_description}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusClass(d.status))}>
                            {statusLabel(d.status)}
                          </span>

                          {d.status !== 'completed' ? (
                            <button
                              onClick={() => markMutation.mutate(d.id)}
                              disabled={markMutation.isPending}
                              className="text-muted-foreground hover:text-green-400 transition-colors disabled:opacity-40"
                              title="Marcar como realizado"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => revertMutation.mutate(d.id)}
                              disabled={revertMutation.isPending}
                              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                              title="Estornar para pendente"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setExpandedDay(isExpanded ? null : d.id)
                              setPlanEdits({})
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-border"
                          >
                            {isExpanded ? 'Fechar' : 'Editar'}
                          </button>
                        </div>
                      </div>

                      {/* Exercícios expandidos */}
                      {isExpanded && (
                        <div className="bg-muted/20 border-t px-4 py-3 space-y-3">
                          {!dayDetail ? (
                            <p className="text-xs text-muted-foreground">Carregando...</p>
                          ) : exercises.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum exercício neste dia.</p>
                          ) : (
                            <>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs min-w-[420px]">
                                  <thead>
                                    <tr className="border-b text-muted-foreground">
                                      <th className="text-left py-1 font-medium pr-2">Exercício</th>
                                      <th className="text-center py-1 font-medium w-14">Séries</th>
                                      <th className="text-center py-1 font-medium w-16">Reps</th>
                                      <th className="text-center py-1 font-medium w-16">Kg</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {exercises.map(ex => {
                                      const edit = planEdits[ex.id] ?? {}
                                      return (
                                        <tr key={ex.id} className="border-b last:border-0">
                                          <td className="py-1.5 pr-2 font-medium">{ex.exercise_name}</td>
                                          <td className="py-1 px-1">
                                            <Input
                                              type="number" min="1"
                                              className="h-7 w-14 text-xs text-center px-1"
                                              value={edit.planned_sets ?? ex.planned_sets}
                                              onChange={e => setPlanEdits(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], planned_sets: parseInt(e.target.value) || ex.planned_sets } }))}
                                            />
                                          </td>
                                          <td className="py-1 px-1">
                                            <Input
                                              className="h-7 w-16 text-xs text-center px-1"
                                              value={edit.planned_reps ?? ex.planned_reps}
                                              onChange={e => setPlanEdits(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], planned_reps: e.target.value } }))}
                                            />
                                          </td>
                                          <td className="py-1 px-1">
                                            <Input
                                              type="number" min="0" step="0.5"
                                              className="h-7 w-16 text-xs text-center px-1"
                                              value={edit.planned_load_kg ?? ex.planned_load_kg}
                                              onChange={e => setPlanEdits(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], planned_load_kg: parseFloat(e.target.value) || 0 } }))}
                                            />
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {hasEdits && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => savePlanMutation.mutate({ dayId: d.id, exercises })}
                                  disabled={savePlanMutation.isPending}
                                >
                                  <Save className="h-3 w-3 mr-1" />
                                  {savePlanMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Componente Principal ───────────────────────────────────────────────────

export default function ManutencaoPage() {
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  // null = aguardando verificação de programa ativo; true = calendário; false = wizard
  const [showCalendario, setShowCalendario] = useState<boolean | null>(null)

  // Step 1
  const [programName, setProgramName] = useState('Ciclo 1 — Periodização 16 Semanas')
  const [athleteId, setAthleteId] = useState<number | null>(null)
  const [gymId, setGymId] = useState<number | null>(null)
  const [totalWeeks, setTotalWeeks] = useState(16)
  const [weeklyFreq, setWeeklyFreq] = useState(4)
  const [cardioFreq, setCardioFreq] = useState(0)

  // Step 2
  const [blocks, setBlocks] = useState<BlockConfig[]>(DEFAULT_BLOCKS)

  // Step 3
  const [splits, setSplits] = useState<Split[]>([
    { _key: genKey(), letter: 'A', description: 'Peito + Tríceps', muscle_groups: ['Peito', 'Tríceps'], split_order: 1, exercises: [makeDefaultExercise(4, 1)] },
    { _key: genKey(), letter: 'B', description: 'Costas + Bíceps', muscle_groups: ['Costas', 'Bíceps'], split_order: 2, exercises: [makeDefaultExercise(4, 1)] },
    { _key: genKey(), letter: 'C', description: 'Pernas + Glúteos', muscle_groups: ['Quadríceps', 'Glúteos', 'Posterior'], split_order: 3, exercises: [makeDefaultExercise(4, 1)] },
    { _key: genKey(), letter: 'D', description: 'Ombros + Abdômen', muscle_groups: ['Ombros', 'Abdômen'], split_order: 4, exercises: [makeDefaultExercise(4, 1)] },
  ])

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercicios'],
    queryFn: () => exerciciosApi.list().then(r => r.data.data as { id: number; name: string; primary_muscle_group: string; is_active: boolean }[]),
  })
  const { data: athlete } = useQuery({
    queryKey: ['atleta'],
    queryFn: () => atletaApi.get().then(r => r.data.data),
  })
  const { data: gyms = [] } = useQuery({
    queryKey: ['academias'],
    queryFn: () => academiaApi.list().then(r => r.data.data as { id: number; name: string; is_active: boolean }[]),
  })
  const { data: programaAtivo, isLoading: loadingPrograma } = useQuery({
    queryKey: ['programa-ativo'],
    queryFn: () => programasApi.getAtivo().then(r => r.data.data),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (athlete?.id) setAthleteId(athlete.id)
  }, [athlete])

  // Inicializa a visão: calendário se existe programa, wizard se não existe
  useEffect(() => {
    if (!loadingPrograma && showCalendario === null) {
      setShowCalendario(!!programaAtivo)
    }
  }, [loadingPrograma, programaAtivo])

  const blocksSum = blocks.reduce((s, b) => s + (b.end_week - b.start_week + 1), 0)
  const blocksValid = blocksSum === totalWeeks

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: programName,
        athlete_id: athleteId!,
        gym_id: gymId,
        total_weeks: totalWeeks,
        weekly_training_freq: weeklyFreq,
        weekly_cardio_freq: cardioFreq,
        blocks: blocks.map(b => ({ ...b })),
        splits: splits.map((s, si) => ({
          letter: s.letter,
          description: s.description,
          muscle_groups: s.muscle_groups,
          split_order: si + 1,
          exercises: s.exercises
            .filter(e => e.exercise_id !== null)
            .map((e, ei) => ({
              exercise_id: e.exercise_id!,
              exercise_order: ei + 1,
              block_configs: e.block_configs,
            })),
        })),
      }
      return programasApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programa-ativo'] })
      qc.invalidateQueries({ queryKey: ['todos-dias'] })
      toast({ title: 'Programa criado com sucesso!' })
      setShowCalendario(true)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao criar programa.'
      toast({ title: 'Erro', description: msg, variant: 'destructive' })
    },
  })

  // ── Manipulação de blocos ──────────────────────────────────────────────

  const updateBlock = (i: number, field: keyof BlockConfig, value: unknown) => {
    setBlocks(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: value } : b))
  }

  const addBlock = () => {
    setBlocks(prev => [
      ...prev,
      { block_order: prev.length + 1, name: `Bloco ${prev.length + 1}`, start_week: totalWeeks, end_week: totalWeeks, color: 'green', target_reps: '10-12', target_intensity: '70% 1RM', default_rest_seconds: 60 },
    ])
  }

  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    setBlocks(prev => {
      const next = [...prev]
      // Preserva duração de cada bloco, só troca nome/config
      const durI = next[i].end_week - next[i].start_week + 1
      const durJ = next[j].end_week - next[j].start_week + 1
      ;[next[i], next[j]] = [next[j], next[i]]
      // Recalcula semanas mantendo durações após troca
      let week = 1
      return next.map((b, idx) => {
        const dur = idx === i ? durJ : idx === j ? durI : b.end_week - b.start_week + 1
        const updated = { ...b, block_order: idx + 1, start_week: week, end_week: week + dur - 1 }
        week += dur
        return updated
      })
    })
  }

  const removeBlock = (i: number) => {
    if (blocks.length <= 2) return
    setBlocks(prev => prev.filter((_, idx) => idx !== i).map((b, idx) => ({ ...b, block_order: idx + 1 })))
    setSplits(prev => prev.map(s => ({
      ...s,
      exercises: s.exercises.map(e => ({
        ...e,
        block_configs: e.block_configs.filter((_, idx) => idx !== i).map((cfg, idx) => ({ ...cfg, block_order: idx + 1 })),
      })),
    })))
  }

  // ── Manipulação de splits ──────────────────────────────────────────────

  const addSplit = () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F']
    const letter = letters[splits.length] ?? `T${splits.length + 1}`
    setSplits(prev => [
      ...prev,
      { _key: genKey(), letter, description: '', muscle_groups: [], split_order: prev.length + 1, exercises: [makeDefaultExercise(blocks.length, 1)] },
    ])
  }

  const removeSplit = (key: string) => {
    if (splits.length <= 1) return
    setSplits(prev => prev.filter(s => s._key !== key).map((s, i) => ({ ...s, split_order: i + 1 })))
  }

  const updateSplit = (key: string, field: keyof Split, value: unknown) => {
    setSplits(prev => prev.map(s => s._key === key ? { ...s, [field]: value } : s))
  }

  const addExercise = (splitKey: string) => {
    setSplits(prev => prev.map(s => {
      if (s._key !== splitKey) return s
      return { ...s, exercises: [...s.exercises, makeDefaultExercise(blocks.length, s.exercises.length + 1)] }
    }))
  }

  const removeExercise = (splitKey: string, exKey: string) => {
    setSplits(prev => prev.map(s => {
      if (s._key !== splitKey) return s
      return { ...s, exercises: s.exercises.filter(e => e._key !== exKey).map((e, i) => ({ ...e, exercise_order: i + 1 })) }
    }))
  }

  const updateExercise = (splitKey: string, exKey: string, field: keyof SplitExercise, value: unknown) => {
    setSplits(prev => prev.map(s => {
      if (s._key !== splitKey) return s
      return { ...s, exercises: s.exercises.map(e => e._key === exKey ? { ...e, [field]: value } : e) }
    }))
  }

  const updateBlockConfig = (splitKey: string, exKey: string, blockOrder: number, field: keyof ExerciseBlockConfig, value: unknown) => {
    setSplits(prev => prev.map(s => {
      if (s._key !== splitKey) return s
      return {
        ...s,
        exercises: s.exercises.map(e => {
          if (e._key !== exKey) return e
          return {
            ...e,
            block_configs: e.block_configs.map(cfg =>
              cfg.block_order === blockOrder ? { ...cfg, [field]: value } : cfg
            ),
          }
        }),
      }
    }))
  }

  const activeExercises = exercises.filter((e: { is_active: boolean }) => e.is_active)

  // ── Render ─────────────────────────────────────────────────────────────

  // Enquanto verifica se existe programa ativo, mostra skeleton
  if (showCalendario === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Manutenção do Treino" description="Carregando..." />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manutenção do Treino"
        description={showCalendario ? 'Calendário do programa' : `Passo ${step} de 4`}
        actions={
          showCalendario ? (
            <Button size="sm" variant="outline" onClick={() => setShowCalendario(false)}>
              Novo Programa
            </Button>
          ) : programaAtivo ? (
            <Button size="sm" variant="outline" onClick={() => setShowCalendario(true)}>
              Ver Calendário
            </Button>
          ) : undefined
        }
      />

      {/* Calendário */}
      {showCalendario ? (
        <CalendarioView
          onBack={() => setShowCalendario(false)}
          programaId={programaAtivo?.id}
          onAbandon={() => setShowCalendario(false)}
        />
      ) : (
        <>
          {/* Step indicator */}
          <div className="flex gap-1">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={cn('h-1.5 flex-1 rounded-full', s <= step ? 'bg-primary' : 'bg-muted')} />
            ))}
          </div>

          {/* ── STEP 1: Configuração Geral ── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Configuração Geral</h2>
              <div>
                <Label>Nome do programa *</Label>
                <Input className="mt-1" value={programName} onChange={e => setProgramName(e.target.value)} />
              </div>
              {athlete ? (
                <div>
                  <Label>Atleta</Label>
                  <Input className="mt-1" value={athlete.full_name} disabled />
                </div>
              ) : (
                <Card className="border-yellow-500/50 bg-yellow-500/5">
                  <CardContent className="p-3 flex gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    Cadastre um perfil de atleta antes de criar o programa.
                  </CardContent>
                </Card>
              )}
              {gyms.length > 0 && (
                <div>
                  <Label>Academia (opcional)</Label>
                  <Select value={gymId ? String(gymId) : ''} onValueChange={v => setGymId(v ? parseInt(v) : null)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Nenhuma</SelectItem>
                      {gyms.filter((g: { is_active: boolean }) => g.is_active).map((g: { id: number; name: string }) => (
                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Total de semanas</Label>
                  <Input type="number" min="8" max="24" className="mt-1"
                    value={totalWeeks} onChange={e => setTotalWeeks(parseInt(e.target.value) || 16)} />
                </div>
                <div>
                  <Label>Treinos/semana</Label>
                  <Input type="number" min="2" max="6" className="mt-1"
                    value={weeklyFreq} onChange={e => setWeeklyFreq(parseInt(e.target.value) || 4)} />
                </div>
                <div>
                  <Label>Cardio/semana</Label>
                  <Input type="number" min="0" max="6" className="mt-1"
                    value={cardioFreq} onChange={e => setCardioFreq(parseInt(e.target.value) || 0)} />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Blocos ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Estrutura dos Blocos</h2>
                <Button size="sm" variant="outline" onClick={addBlock} disabled={blocks.length >= 6}>
                  <Plus className="h-4 w-4 mr-1" />Bloco
                </Button>
              </div>

              {!blocksValid && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="p-3 flex gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    A soma dos blocos ({blocksSum} semanas) é diferente do total do ciclo ({totalWeeks} semanas). Ajuste os blocos.
                  </CardContent>
                </Card>
              )}

              {blocks.map((b, i) => {
                const colorCfg = BLOCK_COLORS.find(c => c.value === b.color)
                return (
                  <Card key={i} className={cn('border-l-4', colorCfg?.border ?? 'border-l-gray-400')}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Bloco {i + 1}</CardTitle>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => moveBlock(i, -1)} disabled={i === 0}
                            title="Mover para cima"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1}
                            title="Mover para baixo"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          {blocks.length > 2 && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeBlock(i)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Nome</Label>
                          <Input className="mt-1 h-8 text-sm" value={b.name} onChange={e => updateBlock(i, 'name', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Cor</Label>
                          <Select value={b.color} onValueChange={v => updateBlock(i, 'color', v)}>
                            <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {BLOCK_COLORS.map(c => (
                                <SelectItem key={c.value} value={c.value}>
                                  <span className="flex items-center gap-2">
                                    <span className={cn('h-3 w-3 rounded-full', c.bg)} />
                                    {c.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Semana início</Label>
                          <Input type="number" min="1" className="mt-1 h-8 text-sm"
                            value={b.start_week} onChange={e => updateBlock(i, 'start_week', parseInt(e.target.value) || 1)} />
                        </div>
                        <div>
                          <Label className="text-xs">Semana fim</Label>
                          <Input type="number" min="1" className="mt-1 h-8 text-sm"
                            value={b.end_week} onChange={e => updateBlock(i, 'end_week', parseInt(e.target.value) || 1)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Reps-alvo</Label>
                          <Input className="mt-1 h-8 text-sm" value={b.target_reps} onChange={e => updateBlock(i, 'target_reps', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Intensidade</Label>
                          <Input className="mt-1 h-8 text-sm" value={b.target_intensity} onChange={e => updateBlock(i, 'target_intensity', e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Descanso (s)</Label>
                          <Input type="number" className="mt-1 h-8 text-sm"
                            value={b.default_rest_seconds} onChange={e => updateBlock(i, 'default_rest_seconds', parseInt(e.target.value) || 60)} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* ── STEP 3: Splits ── */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Divisão de Treinos</h2>
                <Button size="sm" variant="outline" onClick={addSplit} disabled={splits.length >= 6}>
                  <Plus className="h-4 w-4 mr-1" />Treino
                </Button>
              </div>

              {splits.map(split => (
                <Card key={split._key}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Treino {split.letter}</CardTitle>
                      {splits.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeSplit(split._key)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Letra/Nome</Label>
                        <Input className="mt-1 h-8 text-sm" value={split.letter}
                          onChange={e => updateSplit(split._key, 'letter', e.target.value)} maxLength={5} />
                      </div>
                      <div>
                        <Label className="text-xs">Descrição</Label>
                        <Input className="mt-1 h-8 text-sm" value={split.description}
                          onChange={e => updateSplit(split._key, 'description', e.target.value)}
                          placeholder="Ex: Peito + Tríceps" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Grupos musculares</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {MUSCLE_GROUPS.map(g => {
                          const selected = split.muscle_groups.includes(g)
                          return (
                            <button key={g} onClick={() => {
                              const next = selected
                                ? split.muscle_groups.filter(m => m !== g)
                                : [...split.muscle_groups, g]
                              updateSplit(split._key, 'muscle_groups', next)
                            }} className={cn(
                              'text-xs px-2 py-1 rounded-full border transition-colors',
                              selected ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary'
                            )}>
                              {g}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs mb-2 block">Exercícios</Label>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse min-w-[600px]">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 pr-2 font-medium w-8">#</th>
                              <th className="text-left py-1 pr-2 font-medium min-w-[140px]">Exercício</th>
                              {blocks.map(b => (
                                <th key={b.block_order} colSpan={3} className="text-center py-1 px-1 font-medium">
                                  <span className={cn('px-1.5 py-0.5 rounded text-white text-xs',
                                    BLOCK_COLORS.find(c => c.value === b.color)?.bg ?? 'bg-gray-500')}>
                                    {b.name}
                                  </span>
                                </th>
                              ))}
                              <th className="w-7"></th>
                            </tr>
                            <tr className="border-b text-muted-foreground">
                              <th></th><th></th>
                              {blocks.map(b => (
                                <React.Fragment key={b.block_order}>
                                  <th className="py-0.5 px-1">Séries</th>
                                  <th className="py-0.5 px-1">Reps</th>
                                  <th className="py-0.5 px-1">Kg</th>
                                </React.Fragment>
                              ))}
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {split.exercises.map((ex, ei) => (
                              <tr key={ex._key} className="border-b last:border-0">
                                <td className="py-1 pr-2 text-muted-foreground">{ei + 1}</td>
                                <td className="py-1 pr-2">
                                  <Select
                                    value={ex.exercise_id ? String(ex.exercise_id) : ''}
                                    onValueChange={v => updateExercise(split._key, ex._key, 'exercise_id', v ? parseInt(v) : null)}
                                  >
                                    <SelectTrigger className="h-7 text-xs min-w-[130px]">
                                      <SelectValue placeholder="Selecionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {activeExercises.map((e: { id: number; name: string; primary_muscle_group: string }) => (
                                        <SelectItem key={e.id} value={String(e.id)}>
                                          {e.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                {ex.block_configs.map(cfg => (
                                  <React.Fragment key={cfg.block_order}>
                                    <td className="py-1 px-1">
                                      <Input type="number" min="1" className="h-7 w-14 text-xs text-center px-1"
                                        value={cfg.sets}
                                        onChange={e => updateBlockConfig(split._key, ex._key, cfg.block_order, 'sets', parseInt(e.target.value) || 3)} />
                                    </td>
                                    <td className="py-1 px-1">
                                      <Input className="h-7 w-14 text-xs text-center px-1"
                                        value={cfg.reps}
                                        onChange={e => updateBlockConfig(split._key, ex._key, cfg.block_order, 'reps', e.target.value)} />
                                    </td>
                                    <td className="py-1 px-1">
                                      <Input type="number" min="0" step="0.5" className="h-7 w-16 text-xs text-center px-1"
                                        value={cfg.load_kg}
                                        onChange={e => updateBlockConfig(split._key, ex._key, cfg.block_order, 'load_kg', parseFloat(e.target.value) || 0)} />
                                    </td>
                                  </React.Fragment>
                                ))}
                                <td className="py-1 pl-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7"
                                    onClick={() => removeExercise(split._key, ex._key)}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Button size="sm" variant="outline" className="mt-2 h-7 text-xs"
                        onClick={() => addExercise(split._key)}>
                        <Plus className="h-3 w-3 mr-1" />Exercício
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ── STEP 4: Revisão ── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Revisão e Confirmação</h2>

              <Card>
                <CardContent className="pt-4 space-y-2">
                  <p><span className="font-medium">Programa:</span> {programName}</p>
                  <p><span className="font-medium">Duração:</span> {totalWeeks} semanas</p>
                  <p><span className="font-medium">Frequência:</span> {weeklyFreq} treinos/semana</p>
                  {cardioFreq > 0 && <p><span className="font-medium">Cardio:</span> {cardioFreq}x/semana</p>}
                  <p><span className="font-medium">Total de dias gerados:</span> {totalWeeks * weeklyFreq}</p>
                </CardContent>
              </Card>

              <h3 className="font-medium">Blocos</h3>
              <div className="flex flex-wrap gap-2">
                {blocks.map(b => {
                  const c = BLOCK_COLORS.find(x => x.value === b.color)
                  return (
                    <Badge key={b.block_order} className={cn('text-white', c?.bg)}>
                      {b.name} (S{b.start_week}–S{b.end_week})
                    </Badge>
                  )
                })}
              </div>

              <h3 className="font-medium">Divisão</h3>
              <div className="space-y-2">
                {splits.map(s => (
                  <Card key={s._key}>
                    <CardContent className="p-3">
                      <p className="font-medium text-sm">Treino {s.letter} — {s.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.exercises.filter(e => e.exercise_id).length} exercício(s) · {s.muscle_groups.join(', ')}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Navegação entre steps */}
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />Voltar
            </Button>

            {step < 4 ? (
              <Button
                onClick={() => setStep(s => s + 1)}
                disabled={
                  (step === 1 && (!programName || !athleteId)) ||
                  (step === 2 && !blocksValid)
                }
              >
                Próximo<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Salvando...' : 'Salvar Programa'}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
