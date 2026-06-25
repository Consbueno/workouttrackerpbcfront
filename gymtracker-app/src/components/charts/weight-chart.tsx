import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatDate } from '@/lib/utils'

export interface WeightPoint { measurement_date: string; weight_kg: number }

export function WeightChart({ data }: { data: WeightPoint[] }) {
  if (!data || data.length < 2) {
    return <p className="text-center text-sm text-muted-foreground py-8">Dados insuficientes para o gráfico.</p>
  }
  const chartData = data.map(d => ({ date: formatDate(d.measurement_date), kg: d.weight_kg }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
        <Tooltip formatter={(v: number) => [`${v} kg`, 'Peso']} />
        <Line type="monotone" dataKey="kg" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
