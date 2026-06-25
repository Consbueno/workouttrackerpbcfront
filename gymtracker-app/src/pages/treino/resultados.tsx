import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Scale } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WeightChart, type WeightPoint } from '@/components/charts/weight-chart'
import { MeasurementsChart } from '@/components/charts/measurements-chart'
import { medicoesApi } from '@/api/resultados'
import { formatDate } from '@/lib/utils'

interface Medicao {
  id: number
  measurement_date: string
  weight_kg?: number
  body_fat_pct?: number
  waist_cm?: number
  chest_cm?: number
  right_arm_relaxed_cm?: number
  hip_cm?: number
  right_thigh_cm?: number
}

export default function ResultadosPage() {
  const navigate = useNavigate()

  const { data: medicoes = [], isLoading } = useQuery<Medicao[]>({
    queryKey: ['medicoes-evolucao'],
    queryFn: () => medicoesApi.evolucao().then(r => r.data.data),
  })

  const { data: lista = [] } = useQuery<Medicao[]>({
    queryKey: ['medicoes-lista'],
    queryFn: () => medicoesApi.list().then(r => r.data.data),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resultados"
        description="Evolução de peso e medidas corporais."
        actions={
          <Button onClick={() => navigate('/treino/resultados/nova')}>
            <Plus className="h-4 w-4 mr-1" />
            Nova Medição
          </Button>
        }
      />

      {/* Gráficos */}
      {medicoes.length >= 2 && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Evolução do Peso (kg)</CardTitle>
            </CardHeader>
            <CardContent>
              <WeightChart data={medicoes.filter((m): m is Medicao & WeightPoint => m.weight_kg != null)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Circunferências (cm)</CardTitle>
            </CardHeader>
            <CardContent>
              <MeasurementsChart data={medicoes} />
            </CardContent>
          </Card>
        </>
      )}

      {/* Histórico */}
      <div>
        <h3 className="font-semibold mb-3">Histórico de Medições</h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg border animate-pulse" />)}
          </div>
        ) : lista.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center py-10 text-center text-muted-foreground">
              <Scale className="h-10 w-10 mb-3" />
              <p>Nenhuma medição registrada ainda.</p>
              <Button className="mt-4" onClick={() => navigate('/treino/resultados/nova')}>
                Registrar primeira medição
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {lista.map(m => (
              <Card key={m.id} className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/treino/resultados/nova?edit=${m.id}`)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Data</p>
                    <p className="font-medium text-sm">{formatDate(m.measurement_date)}</p>
                  </div>
                  {m.weight_kg != null && (
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Peso</p>
                      <p className="font-bold">{m.weight_kg} kg</p>
                    </div>
                  )}
                  {m.body_fat_pct != null && (
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">% Gordura</p>
                      <p className="font-semibold">{m.body_fat_pct}%</p>
                    </div>
                  )}
                  {m.waist_cm != null && (
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Cintura</p>
                      <p className="font-semibold">{m.waist_cm} cm</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
