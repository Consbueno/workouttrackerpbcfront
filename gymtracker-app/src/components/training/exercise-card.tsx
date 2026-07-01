import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface SetData {
  load_kg: number
  reps: number
  notes: string
  done: boolean
}

export interface ExerciseExecution {
  id: number
  exercise_name: string
  primary_muscle_group: string
  planned_sets: number
  planned_reps: string
  planned_load_kg: number
  planned_rest_seconds: number
  actual_load_kg: number | null
  actual_reps: SetData[] | number | null
  is_completed: boolean
  exercise_notes: string | null
}

interface ExerciseCardProps {
  exercise: ExerciseExecution
  onChange: (id: number, field: string, value: unknown) => void
  onToggle: (id: number) => void
  onCompleted?: (restSeconds: number) => void
}

function buildSets(exercise: ExerciseExecution): SetData[] {
  const n = exercise.planned_sets
  const defaultLoad = exercise.actual_load_kg ?? exercise.planned_load_kg ?? 0
  const defaultReps = parseInt(exercise.planned_reps) || 0
  const arr = exercise.actual_reps

  if (
    Array.isArray(arr) &&
    arr.length > 0 &&
    typeof arr[0] === 'object' &&
    arr[0] !== null &&
    'reps' in (arr[0] as object)
  ) {
    const sets = arr as SetData[]
    if (sets.length === n) return sets
    if (sets.length < n) {
      const last = sets[sets.length - 1]
      return [
        ...sets,
        ...Array.from({ length: n - sets.length }, () => ({
          load_kg: last?.load_kg ?? defaultLoad,
          reps: defaultReps,
          notes: '',
          done: false,
        })),
      ]
    }
    return sets.slice(0, n)
  }

  return Array.from({ length: n }, () => ({
    load_kg: defaultLoad,
    reps: typeof arr === 'number' ? arr : defaultReps,
    notes: '',
    done: false,
  }))
}

export function ExerciseCard({ exercise, onChange, onToggle, onCompleted }: ExerciseCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [sets, setSets] = useState<SetData[]>(() => buildSets(exercise))
  const [openNotesIdx, setOpenNotesIdx] = useState<number | null>(null)

  useEffect(() => {
    setSets(buildSets(exercise))
    setOpenNotesIdx(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id])

  const updateSet = (i: number, field: keyof SetData, value: SetData[keyof SetData]) => {
    const newSets = sets.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    setSets(newSets)
    onChange(exercise.id, 'actual_reps', newSets)
    if (field === 'load_kg' && i === 0) {
      onChange(exercise.id, 'actual_load_kg', value)
    }
  }

  const handleToggle = () => {
    onToggle(exercise.id)
    if (!exercise.is_completed && onCompleted) {
      onCompleted(exercise.planned_rest_seconds)
    }
    if (!expanded) setExpanded(true)
  }

  const doneSets = sets.filter(s => s.done).length

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        exercise.is_completed ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-card'
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Marcador de conclusão do exercício (independente das séries) */}
        <button
          onClick={handleToggle}
          className={cn(
            'mt-0.5 h-6 w-6 flex-shrink-0 rounded-full border-2 transition-colors flex items-center justify-center',
            exercise.is_completed
              ? 'border-green-500 bg-green-500 text-white'
              : 'border-muted-foreground hover:border-primary'
          )}
          aria-label="Marcar exercício como concluído"
        >
          {exercise.is_completed && (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="2,6 5,9 10,3" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={cn('font-semibold text-sm', exercise.is_completed && 'line-through text-muted-foreground')}>
                {exercise.exercise_name}
              </p>
              <Badge variant="outline" className="mt-1 text-xs">
                {exercise.primary_muscle_group}
              </Badge>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-bold text-primary">
                {exercise.planned_sets} × {exercise.planned_reps}
              </p>
              <p className="text-xs text-muted-foreground">
                {doneSets > 0
                  ? `${doneSets}/${exercise.planned_sets} séries`
                  : exercise.planned_load_kg > 0
                    ? `${exercise.planned_load_kg} kg`
                    : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>Descanso: {exercise.planned_rest_seconds}s</span>
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Fechar' : 'Registrar séries'}
            </button>
          </div>

          {expanded && (
            <div className="mt-3 border-t pt-3">
              {/* Cabeçalho das colunas */}
              <div className="grid grid-cols-[16px_1fr_1fr_28px_24px] gap-x-2 mb-1.5">
                <span className="text-[10px] text-muted-foreground text-center">#</span>
                <span className="text-[10px] text-muted-foreground">Carga (kg)</span>
                <span className="text-[10px] text-muted-foreground">Reps</span>
                <span />
                <span />
              </div>

              {/* Linhas de série */}
              <div className="space-y-2">
                {sets.map((set, i) => (
                  <div key={i}>
                    <div className="grid grid-cols-[16px_1fr_1fr_28px_24px] gap-x-2 items-center">
                      <span
                        className={cn(
                          'text-xs font-semibold text-center leading-none',
                          set.done ? 'text-green-400' : 'text-muted-foreground'
                        )}
                      >
                        {i + 1}
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        value={set.load_kg || ''}
                        placeholder={exercise.planned_load_kg > 0 ? String(exercise.planned_load_kg) : '0'}
                        onChange={e => updateSet(i, 'load_kg', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm px-2"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={set.reps || ''}
                        placeholder={exercise.planned_reps}
                        onChange={e => updateSet(i, 'reps', parseInt(e.target.value) || 0)}
                        className="h-8 text-sm px-2"
                      />
                      {/* Marcador de série concluída */}
                      <button
                        onClick={() => updateSet(i, 'done', !set.done)}
                        className={cn(
                          'h-7 w-7 rounded-full border-2 transition-colors flex items-center justify-center mx-auto',
                          set.done
                            ? 'border-green-500 bg-green-500 text-white'
                            : 'border-muted-foreground hover:border-green-500'
                        )}
                        aria-label={`Marcar série ${i + 1} como concluída`}
                      >
                        {set.done && (
                          <svg
                            viewBox="0 0 12 12"
                            className="h-2.5 w-2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <polyline points="2,6 5,9 10,3" />
                          </svg>
                        )}
                      </button>
                      {/* Obs da série */}
                      <button
                        onClick={() => setOpenNotesIdx(openNotesIdx === i ? null : i)}
                        className={cn(
                          'h-6 w-6 flex items-center justify-center rounded transition-colors',
                          set.notes ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                        )}
                        aria-label={`Observações série ${i + 1}`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {openNotesIdx === i && (
                      <div className="mt-1 pl-5">
                        <Input
                          type="text"
                          placeholder={`Obs série ${i + 1}...`}
                          value={set.notes}
                          onChange={e => updateSet(i, 'notes', e.target.value)}
                          className="h-7 text-xs"
                          autoFocus
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Observações gerais do exercício */}
              <div className="mt-3">
                <Textarea
                  placeholder="Obs do exercício (opcional)..."
                  value={exercise.exercise_notes ?? ''}
                  onChange={e => onChange(exercise.id, 'exercise_notes', e.target.value)}
                  className="text-sm h-12 resize-none"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
