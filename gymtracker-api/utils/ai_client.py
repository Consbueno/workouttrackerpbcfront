import anthropic
import os
import json

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

SYSTEM_PROMPT = """Você é um preparador físico e analista de treino especializado em periodização por blocos.
Analise os dados de treino do atleta e gere um relatório estruturado em Português do Brasil com as seguintes seções:

1. RESUMO GERAL — visão geral da aderência e progresso
2. ANÁLISE POR BLOCO — como foi a execução em cada bloco (Resistência, Hipertrofia, Força)
3. PROGRESSÃO DE CARGA — exercícios que progrediram vs. estagnaram vs. regrediram
4. PONTOS DE ATENÇÃO — observações do atleta que indicam dor, desconforto ou limitação. Cruze com as restrições corporais cadastradas.
5. EVOLUÇÃO CORPORAL — análise das medições (peso, circunferências, indicadores de saúde)
6. DIAGNÓSTICO — conclusão geral: o ciclo está sendo efetivo? O que funcionou? O que não funcionou?
7. SUGESTÕES PARA O PRÓXIMO CICLO — recomendações concretas: ajustar carga em quais exercícios, mudar algum exercício, modificar frequência, alterar algum bloco, etc.

Considere as condições de saúde e restrições corporais do atleta ao fazer recomendações.
Seja direto e prático. Não use jargão desnecessário. Use dados específicos dos treinos na análise."""


def gerar_analise(payload: dict) -> str:
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)}],
    )
    return message.content[0].text
