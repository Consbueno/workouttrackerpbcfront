import json
from decimal import Decimal
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

import db
from utils.ai_client import client

bp = Blueprint("treinador", __name__)

# ── Blocos fixos — nunca alterar ─────────────────────────────────────────────
BLOCOS_PADRAO = [
    {"block_order": 1, "name": "Resistência",  "start_week": 1,  "end_week": 4,
     "color": "blue",   "target_reps": "15-25", "target_intensity": "50-65% 1RM", "default_rest_seconds": 60},
    {"block_order": 2, "name": "Hipertrofia",  "start_week": 5,  "end_week": 10,
     "color": "yellow", "target_reps": "8-15",  "target_intensity": "65-75% 1RM", "default_rest_seconds": 75},
    {"block_order": 3, "name": "Força",        "start_week": 11, "end_week": 15,
     "color": "red",    "target_reps": "3-6",   "target_intensity": "75-90% 1RM", "default_rest_seconds": 180},
    {"block_order": 4, "name": "Deload",       "start_week": 16, "end_week": 16,
     "color": "gray",   "target_reps": "10-15", "target_intensity": "50-60% 1RM", "default_rest_seconds": 90},
]

# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS = [
    {
        "name": "criar_programa_treino",
        "description": (
            "Cria um novo programa de treino de 16 semanas no banco de dados do GymTracker, "
            "gerando automaticamente todos os treinos (training_days) e arquivando o programa "
            "ativo se existir. Use SOMENTE após o atleta confirmar explicitamente que quer criar "
            "o programa. Os 4 blocos (Resistência/Hipertrofia/Força/Deload) são criados "
            "automaticamente pelo backend com os parâmetros fixos da periodização."
        ),
        "input_schema": {
            "type": "object",
            "required": ["nome", "weekly_training_freq", "splits"],
            "properties": {
                "nome": {
                    "type": "string",
                    "description": "Nome do programa. Ex: 'Ciclo 1 — Hipertrofia 16 Semanas'"
                },
                "weekly_training_freq": {
                    "type": "integer",
                    "description": "Frequência semanal de treinos (2 a 6 dias por semana)"
                },
                "weekly_cardio_freq": {
                    "type": "integer",
                    "description": "Frequência semanal de cardio (0 se não houver)",
                    "default": 0
                },
                "splits": {
                    "type": "array",
                    "description": "Lista de splits (treinos A, B, C...). Cada split contém os exercícios com configs por bloco.",
                    "items": {
                        "type": "object",
                        "required": ["letter", "description", "split_order", "muscle_groups", "exercises"],
                        "properties": {
                            "letter": {"type": "string", "description": "Letra do split: A, B, C..."},
                            "description": {"type": "string", "description": "Descrição do split. Ex: Push — Peito, Ombros, Tríceps"},
                            "split_order": {"type": "integer"},
                            "muscle_groups": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Grupos musculares trabalhados neste split"
                            },
                            "exercises": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["exercise_id", "exercise_order", "block_configs"],
                                    "properties": {
                                        "exercise_id": {
                                            "type": "integer",
                                            "description": "ID do exercício conforme listado no contexto (campo exercicios)"
                                        },
                                        "exercise_order": {"type": "integer"},
                                        "block_configs": {
                                            "type": "array",
                                            "description": "Configuração para cada um dos 4 blocos (block_order 1, 2, 3, 4)",
                                            "items": {
                                                "type": "object",
                                                "required": ["block_order", "sets", "reps", "load_kg", "rest_seconds"],
                                                "properties": {
                                                    "block_order": {"type": "integer"},
                                                    "sets": {"type": "integer"},
                                                    "reps": {"type": "string", "description": "Ex: '20', '10', '4'"},
                                                    "load_kg": {"type": "number", "description": "0 se não souber a carga inicial"},
                                                    "rest_seconds": {"type": "integer"}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
]

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Você é um personal trainer especializado em periodização por blocos, integrado ao GymTracker 16W.

O contexto completo do atleta (perfil, programa ativo, medições, exercícios disponíveis) é fornecido no início de cada conversa. Use esses dados em todas as respostas. Nunca invente dados que não estão no contexto.

Você tem a ferramenta `criar_programa_treino` que cria automaticamente o programa no banco de dados. Quando prescrever um programa e o atleta confirmar, chame essa ferramenta — o atleta não precisa fazer mais nada.

**Língua:** Português do Brasil em todo texto ao usuário.

---

## MODOS DE ATUAÇÃO

### MODO 1 — PERFIL
Exiba e interprete o perfil do atleta de forma clara. Aplique internamente as flags médicas em todas as prescrições:
- Cardíaco: disclaimer obrigatório em todo programa. Evitar Valsalva, exercícios invertidos, séries de força máxima. Descanso mínimo 90s.
- Hipertenso: sem exercícios invertidos, sem Valsalva. Limitar cargas no bloco Força.
- Diabético: monitorar glicemia antes e após. Sem treino em jejum para DM1.
- Restrição lombar: substituir Terra por Remada Unilateral. Sem Good Morning, sem Jefferson Curl.
- Restrição joelho: Leg Press ou Cadeira Extensora no lugar de Agachamento Livre.
- Restrição ombro: Halter no lugar de Barra no supino. Sem Desenvolvimento por trás da nuca.

IMC: <18.5 Abaixo do peso | 18.5–24.9 Normal | 25–29.9 Sobrepeso | 30–34.9 Ob.I | ≥40 Ob.III

### MODO 2 — OBJETIVO
Ajude a definir e avaliar objetivos. Use o campo `fitness_goals` do perfil como ponto de partida. Cruze com as medições para mostrar progresso real. Avalie se o prazo é realístico (hipertrofia natural = 1–1.5 kg músculo/mês em condições ideais).

### MODO 3 — PROGRAMA
**Fluxo obrigatório:**
1. Apresente o programa prescrito em texto (splits, exercícios, séries/reps por bloco)
2. Pergunte: "Posso criar esse programa no seu GymTracker agora?"
3. Se o atleta confirmar → chame `criar_programa_treino` imediatamente com todos os dados
4. Confirme ao atleta que está tudo pronto: "✅ Programa criado! Já pode iniciar pelo app."

**Periodização FIXA (nunca altere):**
| Bloco | Semanas | Reps | Intensidade | Descanso |
|-------|---------|------|-------------|---------|
| 1 — Resistência | 4 | 15–25 | 50–65% 1RM | 45–60s |
| 2 — Hipertrofia | 6 | 8–15 | 65–75% 1RM | 60–90s |
| 3 — Força | 5 | 3–6 | 75–90% 1RM | 3–5 min |
| 4 — Deload | 1 | –50% vol | 50–60% 1RM | igual anterior |

**Splits por frequência:**
- 2x: Full Body A / Full Body B
- 3x: Push / Pull / Legs
- 4x: Upper A / Lower A / Upper B / Lower B
- 5x: Push / Pull / Legs / Upper / Lower
- 6x: Peito / Costas / Ombros / Pernas / Braços / Core

**Ao montar a ferramenta:** Use apenas `exercise_id` dos exercícios que estão no contexto (campo `exercicios`). Se precisar de um exercício que não existe, informe o atleta antes de criar — mas crie o programa com o que houver. Volume ideal (bloco Hipertrofia): 10–20 séries/semana por grupo muscular.

### MODO 4 — AVALIAR PROGRAMA
Avalie o programa ativo com checklist (✅/⚠️/❌):
1. Estrutura dos blocos (sequência e proporção 4-6-5-1)
2. Parâmetros por bloco (reps, intensidade, descanso dentro dos limites)
3. Volume por grupo muscular (10–20 séries/semana)
4. Equilíbrio push/pull (ratio ideal 1:1 a 1:1.2)
5. Contraindicações médicas
6. Sobrecarga progressiva definida
7. Consistência entre frequência e split

### MODO 5 — DIAGNÓSTICO
- Aderência = concluídos / (concluídos + faltas) × 100
- Tendências das medições: delta, taxa semanal, projeção com intervalo
- Flags: perda >1 kg/semana = risco muscular; estagnação de força = revisar deload/nutrição
- Alinhar com `fitness_goals` do atleta

---

## REGRAS INVIOLÁVEIS
1. Nunca invente dados — não está no contexto = "não informado"
2. Cardíaco → disclaimer visível em toda prescrição
3. Nunca projete datas únicas → sempre intervalos
4. Nunca faça diagnóstico médico
5. Deload é imutável: 1 semana, semana 16, –50% volume
6. Sempre ofereça o próximo passo ao final de cada resposta
7. Quando incerto sobre algo médico → recomende profissional
"""


# ── Helpers ───────────────────────────────────────────────────────────────────
def _row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, Decimal):
            d[k] = float(v)
    return d


def _rows_to_list(rows):
    return [_row_to_dict(r) for r in rows]


def _build_context(user_id: int) -> dict:
    athlete = db.query_one("SELECT * FROM athletes WHERE user_id = %s", (user_id,))
    program = db.query_one(
        "SELECT * FROM training_programs WHERE user_id = %s AND status = 'active' LIMIT 1",
        (user_id,),
    )
    context: dict = {
        "atleta": _row_to_dict(athlete),
        "programa_ativo": None,
        "blocos": [],
        "splits_resumo": [],
        "medicoes_recentes": [],
        "resumo_treinos": None,
        "exercicios": [],
    }
    if athlete:
        measurements = db.query(
            "SELECT * FROM measurements WHERE athlete_id = %s ORDER BY measurement_date DESC LIMIT 15",
            (athlete["id"],),
        )
        context["medicoes_recentes"] = _rows_to_list(measurements)

    if program:
        context["programa_ativo"] = _row_to_dict(program)
        blocks = db.query(
            "SELECT * FROM training_blocks WHERE program_id = %s ORDER BY block_order",
            (program["id"],),
        )
        context["blocos"] = _rows_to_list(blocks)
        splits = db.query(
            "SELECT id, letter, description, split_order, muscle_groups FROM training_splits WHERE program_id = %s ORDER BY split_order",
            (program["id"],),
        )
        context["splits_resumo"] = _rows_to_list(splits)
        completed = db.query_one(
            "SELECT COUNT(*) as cnt FROM training_days WHERE program_id = %s AND status = 'completed'",
            (program["id"],),
        )
        missed = db.query_one(
            "SELECT COUNT(*) as cnt FROM training_days WHERE program_id = %s AND status = 'missed'",
            (program["id"],),
        )
        total = db.query_one(
            "SELECT COUNT(*) as cnt FROM training_days WHERE program_id = %s",
            (program["id"],),
        )
        context["resumo_treinos"] = {
            "concluidos": int(completed["cnt"] or 0) if completed else 0,
            "faltas": int(missed["cnt"] or 0) if missed else 0,
            "total": int(total["cnt"] or 0) if total else 0,
        }

    exercises = db.query(
        "SELECT id, name, primary_muscle_group, equipment, exercise_type FROM exercises WHERE user_id = %s AND is_active = TRUE ORDER BY name",
        (user_id,),
    )
    context["exercicios"] = _rows_to_list(exercises)
    return context


def _criar_programa_no_banco(user_id: int, dados: dict) -> dict:
    """Executa a criação completa do programa no banco dentro de uma transação."""
    from modules.treino import _generate_training_days  # lazy import evita circular

    nome = dados.get("nome", "Programa 16 Semanas")
    weekly_freq = max(2, min(6, int(dados.get("weekly_training_freq", 3))))
    weekly_cardio = int(dados.get("weekly_cardio_freq", 0))
    splits_data = dados.get("splits", [])

    if not splits_data:
        return {"ok": False, "erro": "Nenhum split fornecido."}

    try:
        with db.db() as conn:
            cur = conn.cursor()

            # Atleta e academia
            cur.execute("SELECT id FROM athletes WHERE user_id = %s", (user_id,))
            athlete = cur.fetchone()
            if not athlete:
                return {"ok": False, "erro": "Perfil de atleta não encontrado. Cadastre o atleta primeiro."}

            cur.execute(
                "SELECT id FROM gyms WHERE user_id = %s AND is_active = TRUE ORDER BY id LIMIT 1",
                (user_id,),
            )
            gym = cur.fetchone()
            gym_id = gym["id"] if gym else None

            # Arquivar programa ativo
            cur.execute(
                "UPDATE training_programs SET status = 'archived' WHERE user_id = %s AND status = 'active'",
                (user_id,),
            )

            # Criar programa
            cur.execute(
                """INSERT INTO training_programs
                   (user_id, athlete_id, gym_id, name, status, total_weeks,
                    weekly_training_freq, weekly_cardio_freq)
                   VALUES (%s, %s, %s, %s, 'active', 16, %s, %s) RETURNING id""",
                (user_id, athlete["id"], gym_id, nome, weekly_freq, weekly_cardio),
            )
            program_id = cur.fetchone()["id"]

            # Criar blocos fixos
            blocks_db = []
            for b in BLOCOS_PADRAO:
                cur.execute(
                    """INSERT INTO training_blocks
                       (program_id, block_order, name, start_week, end_week,
                        color, target_reps, target_intensity, default_rest_seconds)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                    (
                        program_id, b["block_order"], b["name"],
                        b["start_week"], b["end_week"], b["color"],
                        b["target_reps"], b["target_intensity"], b["default_rest_seconds"],
                    ),
                )
                blocks_db.append(dict(cur.fetchone()))

            block_by_order = {b["block_order"]: b for b in blocks_db}

            # Criar splits, split_exercises e block_configs
            splits_db = []
            for split_data in splits_data:
                muscle_groups = split_data.get("muscle_groups", [])
                cur.execute(
                    """INSERT INTO training_splits
                       (program_id, letter, description, split_order, muscle_groups)
                       VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                    (
                        program_id,
                        split_data["letter"],
                        split_data.get("description", ""),
                        split_data["split_order"],
                        muscle_groups,  # psycopg2 adapts list → TEXT[]
                    ),
                )
                split_db = dict(cur.fetchone())
                splits_db.append(split_db)

                for ex_data in split_data.get("exercises", []):
                    cur.execute(
                        """INSERT INTO split_exercises
                           (split_id, exercise_id, exercise_order)
                           VALUES (%s, %s, %s) RETURNING id""",
                        (split_db["id"], ex_data["exercise_id"], ex_data["exercise_order"]),
                    )
                    se_id = cur.fetchone()["id"]

                    for cfg in ex_data.get("block_configs", []):
                        block = block_by_order.get(int(cfg["block_order"]))
                        if not block:
                            continue
                        cur.execute(
                            """INSERT INTO split_exercise_block_config
                               (split_exercise_id, block_id, sets, reps, load_kg, rest_seconds)
                               VALUES (%s, %s, %s, %s, %s, %s)""",
                            (
                                se_id, block["id"],
                                int(cfg["sets"]),
                                str(cfg["reps"]),
                                float(cfg.get("load_kg", 0)),
                                int(cfg["rest_seconds"]),
                            ),
                        )

            # Gerar todos os training_days (usa a mesma função do módulo treino)
            _generate_training_days(conn, program_id, 16, weekly_freq, blocks_db, splits_db)

        total_dias = weekly_freq * 16
        return {
            "ok": True,
            "program_id": program_id,
            "total_dias": total_dias,
            "mensagem": f"Programa '{nome}' criado com sucesso! {total_dias} treinos gerados automaticamente.",
        }

    except Exception as e:
        print(f"[TREINADOR] Erro ao criar programa: {e}")
        return {"ok": False, "erro": f"Erro ao criar programa: {str(e)}"}


def _execute_tool(name: str, tool_input: dict, user_id: int) -> str:
    if name == "criar_programa_treino":
        result = _criar_programa_no_banco(user_id, tool_input)
        return json.dumps(result, ensure_ascii=False)
    return json.dumps({"ok": False, "erro": f"Ferramenta desconhecida: {name}"})


# ── Rota principal ────────────────────────────────────────────────────────────
@bp.route("/chat", methods=["POST"])
@jwt_required()
def chat():
    user_id = int(get_jwt_identity())
    body = request.get_json() or {}
    mensagem = (body.get("mensagem") or "").strip()
    historico = body.get("historico") or []

    if not mensagem:
        return jsonify({"error": "Mensagem é obrigatória."}), 400

    contexto = _build_context(user_id)
    contexto_json = json.dumps(contexto, ensure_ascii=False, default=str, indent=2)
    system = SYSTEM_PROMPT + f"\n\n---\n\n## CONTEXTO ATUAL DO ATLETA\n\n```json\n{contexto_json}\n```"

    # Montar histórico
    messages = []
    for h in historico[-12:]:
        role = h.get("role")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": mensagem})

    acao = None  # sinal para o frontend (ex: "programa_criado")

    try:
        # Loop de tool use — máximo 3 iterações
        for _ in range(3):
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=system,
                tools=TOOLS,
                messages=messages,
            )

            if response.stop_reason != "tool_use":
                # Resposta final em texto
                resposta = next(
                    (b.text for b in response.content if b.type == "text"), ""
                )
                return jsonify({"resposta": resposta, "acao": acao})

            # Serializar conteúdo do assistente para passar de volta
            assistant_content = []
            tool_calls = []
            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    tool_calls.append(block)

            messages.append({"role": "assistant", "content": assistant_content})

            # Executar ferramentas e coletar resultados
            tool_results = []
            for tc in tool_calls:
                result_str = _execute_tool(tc.name, tc.input, user_id)
                result_data = json.loads(result_str)
                if tc.name == "criar_programa_treino" and result_data.get("ok"):
                    acao = "programa_criado"
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result_str,
                })

            messages.append({"role": "user", "content": tool_results})

        # Se chegou aqui sem resposta final, forçar texto
        return jsonify({"resposta": "Operação concluída.", "acao": acao})

    except Exception as e:
        print(f"[TREINADOR] Erro: {e}")
        return jsonify({"error": "Não foi possível obter resposta do treinador. Tente novamente."}), 503
