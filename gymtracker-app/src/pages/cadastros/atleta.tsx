import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { atletaApi } from '@/api/cadastros'
import { BODY_REGIONS } from '@/lib/constants'
import { calcBMI, bmiCategory, calcAge } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

interface BodyRestriction { region: string; has_restriction: boolean; notes: string }

const defaultRestrictions: BodyRestriction[] = BODY_REGIONS.map(r => ({
  region: r, has_restriction: false, notes: '',
}))

const emptyForm = {
  full_name: '', birth_date: '', sex: '', weight_kg: '',
  height_cm: '', is_diabetic: false, is_hypertensive: false,
  is_cardiac: false, health_notes: '', fitness_goals: '',
}

export default function AtletaPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState(emptyForm)
  const [restrictions, setRestrictions] = useState<BodyRestriction[]>(defaultRestrictions)
  const [isNew, setIsNew] = useState(true)

  const { data: athlete } = useQuery({
    queryKey: ['atleta'],
    queryFn: () => atletaApi.get().then(r => r.data.data),
  })

  const toIsoDate = (d: string | undefined): string => {
    if (!d) return ''
    const s = String(d)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
    const parsed = new Date(s)
    return isNaN(parsed.getTime()) ? '' : parsed.toISOString().substring(0, 10)
  }

  useEffect(() => {
    if (athlete) {
      setIsNew(false)
      setForm({
        full_name: athlete.full_name ?? '',
        birth_date: toIsoDate(athlete.birth_date),
        sex: athlete.sex ?? '',
        weight_kg: String(athlete.weight_kg ?? ''),
        height_cm: String(athlete.height_cm ?? ''),
        is_diabetic: athlete.is_diabetic ?? false,
        is_hypertensive: athlete.is_hypertensive ?? false,
        is_cardiac: athlete.is_cardiac ?? false,
        health_notes: athlete.health_notes ?? '',
        fitness_goals: athlete.fitness_goals ?? '',
      })
      if (Array.isArray(athlete.body_restrictions) && athlete.body_restrictions.length > 0) {
        const merged = defaultRestrictions.map(def => {
          const found = athlete.body_restrictions.find((r: BodyRestriction) => r.region === def.region)
          return found ?? def
        })
        setRestrictions(merged)
      }
    }
  }, [athlete])

  const bmi = form.weight_kg && form.height_cm
    ? calcBMI(parseFloat(form.weight_kg), parseInt(form.height_cm))
    : null
  const age = form.birth_date ? calcAge(form.birth_date) : null

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        weight_kg: parseFloat(form.weight_kg),
        height_cm: parseInt(form.height_cm),
        body_restrictions: restrictions,
      }
      return isNew ? atletaApi.create(payload) : atletaApi.update(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atleta'] })
      setIsNew(false)
      toast({ title: 'Perfil atualizado com sucesso!' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao salvar.'
      toast({ title: 'Erro', description: msg, variant: 'destructive' })
    },
  })

  const toggleRestriction = (region: string) => {
    setRestrictions(prev => prev.map(r =>
      r.region === region ? { ...r, has_restriction: !r.has_restriction } : r
    ))
  }
  const updateRestrictionNotes = (region: string, notes: string) => {
    setRestrictions(prev => prev.map(r => r.region === region ? { ...r, notes } : r))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perfil do Atleta"
        description="Dados pessoais e condições de saúde."
        actions={
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar Perfil'}
          </Button>
        }
      />

      {/* Dados pessoais */}
      <Card>
        <CardHeader><CardTitle>Dados Pessoais</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nome completo *</Label>
            <Input className="mt-1" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de nascimento *</Label>
              <Input type="date" className="mt-1" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
              {age !== null && <p className="text-xs text-muted-foreground mt-1">{age} anos</p>}
            </div>
            <div>
              <Label>Sexo *</Label>
              <Select value={form.sex} onValueChange={v => setForm(f => ({ ...f, sex: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Masculino</SelectItem>
                  <SelectItem value="F">Feminino</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Peso atual (kg) *</Label>
              <Input type="number" step="0.1" className="mt-1" value={form.weight_kg}
                onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} />
            </div>
            <div>
              <Label>Altura (cm) *</Label>
              <Input type="number" className="mt-1" value={form.height_cm}
                onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))} />
            </div>
          </div>
          {bmi !== null && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">IMC: {bmi}</Badge>
              <Badge variant="secondary">{bmiCategory(bmi)}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Objetivos */}
      <Card>
        <CardHeader>
          <CardTitle>Objetivos com os Treinos</CardTitle>
        </CardHeader>
        <CardContent>
          <Label>O que você deseja alcançar?</Label>
          <Textarea
            className="mt-1 resize-none"
            rows={4}
            placeholder="Ex: perder gordura abdominal, ganhar massa nos ombros e peito, melhorar resistência cardiovascular, preparar para uma competição de fisiculturismo..."
            value={form.fitness_goals}
            onChange={e => setForm(f => ({ ...f, fitness_goals: e.target.value }))}
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Essa informação é usada pela IA para personalizar a análise do seu ciclo de treino.
          </p>
        </CardContent>
      </Card>

      {/* Condições de saúde */}
      <Card>
        <CardHeader><CardTitle>Condições de Saúde</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={form.is_diabetic} onCheckedChange={v => setForm(f => ({ ...f, is_diabetic: v }))} />
            <Label>Diabético(a)</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_hypertensive} onCheckedChange={v => setForm(f => ({ ...f, is_hypertensive: v }))} />
            <Label>Hipertenso(a)</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_cardiac} onCheckedChange={v => setForm(f => ({ ...f, is_cardiac: v }))} />
            <Label>Condição cardíaca</Label>
          </div>
          <div>
            <Label>Observações de saúde</Label>
            <Textarea className="mt-1 resize-none" rows={3} value={form.health_notes}
              onChange={e => setForm(f => ({ ...f, health_notes: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      {/* Restrições corporais */}
      <Card>
        <CardHeader><CardTitle>Restrições Corporais</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {restrictions.map(r => (
            <div key={r.region} className="border rounded-md p-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={r.has_restriction}
                  onCheckedChange={() => toggleRestriction(r.region)}
                />
                <Label className={r.has_restriction ? 'text-destructive font-medium' : ''}>
                  {r.region}
                </Label>
              </div>
              {r.has_restriction && (
                <div className="mt-2 ml-10">
                  <Input
                    placeholder="Descreva a restrição..."
                    value={r.notes}
                    onChange={e => updateRestrictionNotes(r.region, e.target.value)}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full">
        {saveMutation.isPending ? 'Salvando...' : 'Salvar Perfil'}
      </Button>
    </div>
  )
}
