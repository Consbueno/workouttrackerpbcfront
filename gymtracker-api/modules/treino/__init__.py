import json
import math
from decimal import Decimal
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from marshmallow import ValidationError

import db
from utils.validators import ProgramSchema, DayCompleteSchema, ExerciseExecutionSchema, ProgressaoSchema

bp = Blueprint("treino", __name__)
program_schema = ProgramSchema()
day_complete_schema = DayCompleteSchema()
ex_exec_schema = ExerciseExecutionSchema()
progressao_schema = ProgressaoSchema()


def _serialize(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    return obj


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


# ── GERAÇÃO DE TRAINING_DAYS ────────────────────────────────────────────────

def _get_block_for_week(blocks, week_number):
    for block in blocks:
        if block["start_week"] <= week_number <= block["end_week"]:
            return block
    return blocks[-1]


def _generate_training_days(conn, program_id, total_weeks, weekly_freq, blocks, splits):
    cur = conn.cursor()
    day_number = 0
    split_count = len(splits)

    for week in range(1, total_weeks + 1):
        block = _get_block_for_week(blocks, week)
        block_id = block["id"]

        for day_in_week in range(1, weekly_freq + 1):
            day_number += 1
            split = splits[(day_number - 1) % split_count]
            split_id = split["id"]

            cur.execute(
                """INSERT INTO training_days
                   (program_id, split_id, block_id, week_number, day_number, status)
                   VALUES (%s, %s, %s, %s, %s, 'pending') RETURNING id""",
                (program_id, split_id, block_id, week, day_number),
            )
            day_id = cur.fetchone()["id"]

            # buscar exercícios do split com config do bloco ativo
            cur.execute(
                """SELECT se.id as split_exercise_id, se.exercise_id, se.exercise_order,
                          sebc.sets, sebc.reps, sebc.load_kg, sebc.rest_seconds
                   FROM split_exercises se
                   LEFT JOIN split_exercise_block_config sebc
                     ON sebc.split_exercise_id = se.id AND sebc.block_id = %s
                   WHERE se.split_id = %s
                   ORDER BY se.exercise_order""",
                (block_id, split_id),
            )
            exercises = cur.fetchall()

            for ex in exercises:
                cur.execute(
                    """INSERT INTO training_day_exercises
                       (training_day_id, split_exercise_id, exercise_id,
                        planned_sets, planned_reps, planned_load_kg, planned_rest_seconds)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (
                        day_id,
                        ex["split_exercise_id"],
                        ex["exercise_id"],
                        ex["sets"] or 3,
                        ex["reps"] or "10",
                        float(ex["load_kg"]) if ex["load_kg"] is not None else 0,
                        ex["rest_seconds"] or 60,
                    ),
                )


# ── PROGRAMAS ───────────────────────────────────────────────────────────────

@bp.route("/programas", methods=["GET"])
@jwt_required()
def list_programs():
    user_id = int(get_jwt_identity())
    status = request.args.get("status")
    sql = "SELECT * FROM training_programs WHERE user_id = %s"
    params = [user_id]
    if status:
        sql += " AND status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    rows = db.query(sql, params)
    return jsonify({"data": _rows_to_list(rows)})


@bp.route("/programas/ativo", methods=["GET"])
@jwt_required()
def get_active_program():
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT * FROM training_programs WHERE user_id = %s AND status = 'active' LIMIT 1",
        (user_id,),
    )
    if not program:
        return jsonify({"data": None})
    return _get_program_detail(dict(program)["id"], user_id)


@bp.route("/programas/<int:program_id>", methods=["GET"])
@jwt_required()
def get_program(program_id):
    user_id = int(get_jwt_identity())
    return _get_program_detail(program_id, user_id)


def _get_program_detail(program_id, user_id):
    program = db.query_one(
        "SELECT * FROM training_programs WHERE id = %s AND user_id = %s",
        (program_id, user_id),
    )
    if not program:
        return jsonify({"error": "Programa não encontrado."}), 404

    blocks = db.query(
        "SELECT * FROM training_blocks WHERE program_id = %s ORDER BY block_order",
        (program_id,),
    )
    splits = db.query(
        "SELECT * FROM training_splits WHERE program_id = %s ORDER BY split_order",
        (program_id,),
    )

    splits_with_exercises = []
    for split in splits:
        split_id = split["id"]
        exercises = db.query(
            """SELECT se.*, e.name as exercise_name, e.primary_muscle_group, e.equipment
               FROM split_exercises se
               JOIN exercises e ON e.id = se.exercise_id
               WHERE se.split_id = %s ORDER BY se.exercise_order""",
            (split_id,),
        )
        exercises_with_configs = []
        for ex in exercises:
            configs = db.query(
                """SELECT sebc.*, tb.name as block_name, tb.block_order
                   FROM split_exercise_block_config sebc
                   JOIN training_blocks tb ON tb.id = sebc.block_id
                   WHERE sebc.split_exercise_id = %s ORDER BY tb.block_order""",
                (ex["id"],),
            )
            ex_dict = _row_to_dict(ex)
            ex_dict["block_configs"] = _rows_to_list(configs)
            exercises_with_configs.append(ex_dict)

        split_dict = _row_to_dict(split)
        split_dict["exercises"] = exercises_with_configs
        splits_with_exercises.append(split_dict)

    result = _row_to_dict(program)
    result["blocks"] = _rows_to_list(blocks)
    result["splits"] = splits_with_exercises
    return jsonify({"data": result})


@bp.route("/programas", methods=["POST"])
@jwt_required()
def create_program():
    user_id = int(get_jwt_identity())
    try:
        data = program_schema.load(request.get_json() or {})
    except ValidationError as e:
        return jsonify({"error": "Dados inválidos.", "details": e.messages}), 400

    # arquivar programa ativo existente
    db.execute(
        "UPDATE training_programs SET status='archived', updated_at=NOW() WHERE user_id=%s AND status='active'",
        (user_id,),
    )

    with db.db() as conn:
        cur = conn.cursor()

        cur.execute(
            """INSERT INTO training_programs
               (user_id, athlete_id, gym_id, name, total_weeks, weekly_training_freq, weekly_cardio_freq, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'active') RETURNING id""",
            (
                user_id,
                data["athlete_id"],
                data.get("gym_id"),
                data["name"],
                data["total_weeks"],
                data["weekly_training_freq"],
                data.get("weekly_cardio_freq", 0),
            ),
        )
        program_id = cur.fetchone()["id"]

        # inserir blocos
        block_ids = {}
        for block in data["blocks"]:
            cur.execute(
                """INSERT INTO training_blocks
                   (program_id, block_order, name, start_week, end_week, color,
                    target_reps, target_intensity, default_rest_seconds)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    program_id,
                    block["block_order"],
                    block["name"],
                    block["start_week"],
                    block["end_week"],
                    block["color"],
                    block["target_reps"],
                    block["target_intensity"],
                    block.get("default_rest_seconds", 60),
                ),
            )
            block_ids[block["block_order"]] = cur.fetchone()["id"]

        # inserir splits e exercícios
        split_db_list = []
        for split in data["splits"]:
            cur.execute(
                """INSERT INTO training_splits
                   (program_id, letter, description, muscle_groups, split_order)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (
                    program_id,
                    split["letter"],
                    split["description"],
                    split["muscle_groups"],
                    split["split_order"],
                ),
            )
            split_id = cur.fetchone()["id"]
            split_db_list.append({"id": split_id, "split_order": split["split_order"]})

            for ex in split["exercises"]:
                cur.execute(
                    """INSERT INTO split_exercises (split_id, exercise_id, exercise_order)
                       VALUES (%s, %s, %s) RETURNING id""",
                    (split_id, ex["exercise_id"], ex["exercise_order"]),
                )
                split_exercise_id = cur.fetchone()["id"]

                for cfg in ex["block_configs"]:
                    block_db_id = block_ids.get(cfg["block_order"])
                    if block_db_id:
                        cur.execute(
                            """INSERT INTO split_exercise_block_config
                               (split_exercise_id, block_id, sets, reps, load_kg, rest_seconds, is_included)
                               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                            (
                                split_exercise_id,
                                block_db_id,
                                cfg["sets"],
                                cfg["reps"],
                                float(cfg.get("load_kg", 0)),
                                cfg.get("rest_seconds", 60),
                                cfg.get("is_included", True),
                            ),
                        )

        # buscar dados para gerar training_days
        cur.execute(
            "SELECT * FROM training_blocks WHERE program_id = %s ORDER BY block_order",
            (program_id,),
        )
        blocks_db = cur.fetchall()

        cur.execute(
            "SELECT * FROM training_splits WHERE program_id = %s ORDER BY split_order",
            (program_id,),
        )
        splits_db = cur.fetchall()

        _generate_training_days(
            conn,
            program_id,
            data["total_weeks"],
            data["weekly_training_freq"],
            blocks_db,
            splits_db,
        )

    program = db.query_one("SELECT * FROM training_programs WHERE id = %s", (program_id,))
    return jsonify(
        {"data": _row_to_dict(program), "message": "Programa criado com sucesso! Bom treino! 💪"}
    ), 201


@bp.route("/programas/<int:program_id>", methods=["PUT"])
@jwt_required()
def update_program(program_id):
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT * FROM training_programs WHERE id=%s AND user_id=%s", (program_id, user_id)
    )
    if not program:
        return jsonify({"error": "Programa não encontrado."}), 404

    data = request.get_json() or {}
    name = data.get("name", program["name"])
    gym_id = data.get("gym_id", program["gym_id"])

    row = db.execute(
        "UPDATE training_programs SET name=%s, gym_id=%s, updated_at=NOW() WHERE id=%s RETURNING *",
        (name, gym_id, program_id),
    )
    return jsonify({"data": _row_to_dict(row), "message": "Programa atualizado com sucesso."})


# ── RESUMO E FIM DE CICLO ───────────────────────────────────────────────────

@bp.route("/programas/<int:program_id>/resumo", methods=["GET"])
@jwt_required()
def program_summary(program_id):
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT * FROM training_programs WHERE id=%s AND user_id=%s", (program_id, user_id)
    )
    if not program:
        return jsonify({"error": "Programa não encontrado."}), 404

    stats = db.query_one(
        """SELECT
             COUNT(*) FILTER (WHERE status = 'completed') as completed,
             COUNT(*) FILTER (WHERE status = 'missed') as missed,
             COUNT(*) as total,
             MIN(started_at) FILTER (WHERE status = 'completed') as first_started,
             MAX(completed_at) FILTER (WHERE status = 'completed') as last_completed
           FROM training_days WHERE program_id = %s""",
        (program_id,),
    )
    stats_dict = _row_to_dict(stats)

    completed = stats_dict["completed"] or 0
    total = stats_dict["total"] or 1
    missed = stats_dict["missed"] or 0
    adherence = round((completed / max(completed + missed, 1)) * 100, 1)

    calendar_days = None
    if stats_dict.get("first_started") and stats_dict.get("last_completed"):
        delta = stats_dict["last_completed"] - stats_dict["first_started"]
        calendar_days = delta.days + 1

    # aderência por semana
    week_stats = db.query(
        """SELECT week_number,
             COUNT(*) FILTER (WHERE status = 'completed') as completed,
             COUNT(*) as total
           FROM training_days WHERE program_id = %s
           GROUP BY week_number ORDER BY week_number""",
        (program_id,),
    )

    return jsonify(
        {
            "data": {
                "completed": completed,
                "missed": missed,
                "total": total,
                "adherence_pct": adherence,
                "calendar_days": calendar_days,
                "by_week": _rows_to_list(week_stats),
            }
        }
    )


@bp.route("/programas/<int:program_id>/duplicar", methods=["POST"])
@jwt_required()
def duplicate_program(program_id):
    user_id = int(get_jwt_identity())
    return _duplicate_with_progression(program_id, user_id, 0)


@bp.route("/programas/<int:program_id>/progressao", methods=["POST"])
@jwt_required()
def program_progression(program_id):
    user_id = int(get_jwt_identity())
    try:
        data = progressao_schema.load(request.get_json() or {})
    except ValidationError as e:
        return jsonify({"error": "Dados inválidos.", "details": e.messages}), 400
    return _duplicate_with_progression(program_id, user_id, float(data["percentual"]))


def _duplicate_with_progression(program_id, user_id, pct):
    original = db.query_one(
        "SELECT * FROM training_programs WHERE id=%s AND user_id=%s", (program_id, user_id)
    )
    if not original:
        return jsonify({"error": "Programa não encontrado."}), 404

    def round_load(load_kg, pct):
        if pct == 0:
            return float(load_kg)
        new_load = float(load_kg) * (1 + pct / 100.0)
        return math.floor(new_load * 2 + 0.5) / 2

    db.execute(
        "UPDATE training_programs SET status='completed', updated_at=NOW() WHERE id=%s AND user_id=%s",
        (program_id, user_id),
    )

    with db.db() as conn:
        cur = conn.cursor()

        cur.execute(
            """INSERT INTO training_programs
               (user_id, athlete_id, gym_id, name, total_weeks, weekly_training_freq, weekly_cardio_freq, status)
               SELECT user_id, athlete_id, gym_id,
                      name || ' (Ciclo +1)',
                      total_weeks, weekly_training_freq, weekly_cardio_freq, 'active'
               FROM training_programs WHERE id=%s RETURNING id""",
            (program_id,),
        )
        new_program_id = cur.fetchone()["id"]

        cur.execute(
            "SELECT * FROM training_blocks WHERE program_id=%s ORDER BY block_order",
            (program_id,),
        )
        orig_blocks = cur.fetchall()
        block_id_map = {}

        for blk in orig_blocks:
            cur.execute(
                """INSERT INTO training_blocks
                   (program_id, block_order, name, start_week, end_week, color,
                    target_reps, target_intensity, default_rest_seconds)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    new_program_id,
                    blk["block_order"],
                    blk["name"],
                    blk["start_week"],
                    blk["end_week"],
                    blk["color"],
                    blk["target_reps"],
                    blk["target_intensity"],
                    blk["default_rest_seconds"],
                ),
            )
            block_id_map[blk["id"]] = cur.fetchone()["id"]

        cur.execute(
            "SELECT * FROM training_splits WHERE program_id=%s ORDER BY split_order",
            (program_id,),
        )
        orig_splits = cur.fetchall()
        split_id_map = {}
        new_splits_list = []

        for spl in orig_splits:
            cur.execute(
                """INSERT INTO training_splits
                   (program_id, letter, description, muscle_groups, split_order)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (
                    new_program_id,
                    spl["letter"],
                    spl["description"],
                    spl["muscle_groups"],
                    spl["split_order"],
                ),
            )
            new_split_id = cur.fetchone()["id"]
            split_id_map[spl["id"]] = new_split_id
            new_splits_list.append({"id": new_split_id, "split_order": spl["split_order"]})

            cur.execute(
                "SELECT * FROM split_exercises WHERE split_id=%s ORDER BY exercise_order",
                (spl["id"],),
            )
            orig_exs = cur.fetchall()

            for ex in orig_exs:
                cur.execute(
                    """INSERT INTO split_exercises (split_id, exercise_id, exercise_order)
                       VALUES (%s, %s, %s) RETURNING id""",
                    (new_split_id, ex["exercise_id"], ex["exercise_order"]),
                )
                new_se_id = cur.fetchone()["id"]

                cur.execute(
                    "SELECT * FROM split_exercise_block_config WHERE split_exercise_id=%s",
                    (ex["id"],),
                )
                configs = cur.fetchall()
                for cfg in configs:
                    new_block_id = block_id_map.get(cfg["block_id"])
                    if new_block_id:
                        new_load = round_load(cfg["load_kg"] or 0, pct)
                        cur.execute(
                            """INSERT INTO split_exercise_block_config
                               (split_exercise_id, block_id, sets, reps, load_kg, rest_seconds, is_included)
                               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                            (
                                new_se_id,
                                new_block_id,
                                cfg["sets"],
                                cfg["reps"],
                                new_load,
                                cfg["rest_seconds"],
                                cfg["is_included"],
                            ),
                        )

        cur.execute(
            "SELECT * FROM training_blocks WHERE program_id=%s ORDER BY block_order",
            (new_program_id,),
        )
        new_blocks_db = cur.fetchall()

        cur.execute(
            "SELECT * FROM training_splits WHERE program_id=%s ORDER BY split_order",
            (new_program_id,),
        )
        new_splits_db = cur.fetchall()

        cur.execute(
            "SELECT total_weeks, weekly_training_freq FROM training_programs WHERE id=%s",
            (new_program_id,),
        )
        prog_info = cur.fetchone()

        _generate_training_days(
            conn,
            new_program_id,
            prog_info["total_weeks"],
            prog_info["weekly_training_freq"],
            new_blocks_db,
            new_splits_db,
        )

    prog = db.query_one("SELECT * FROM training_programs WHERE id=%s", (new_program_id,))
    msg = "Ciclo duplicado com sucesso!" if pct == 0 else f"Novo ciclo criado com {pct}% de progressão de carga!"
    return jsonify({"data": _row_to_dict(prog), "message": msg}), 201


# ── DIAS DE TREINO ──────────────────────────────────────────────────────────

@bp.route("/dias", methods=["GET"])
@jwt_required()
def list_days():
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT id FROM training_programs WHERE user_id=%s AND status='active' LIMIT 1",
        (user_id,),
    )
    if not program:
        return jsonify({"data": []})

    status = request.args.get("status")
    week = request.args.get("week")
    block = request.args.get("block")

    sql = """SELECT td.*, ts.letter, ts.description as split_description,
                    tb.name as block_name, tb.color as block_color
             FROM training_days td
             JOIN training_splits ts ON ts.id = td.split_id
             JOIN training_blocks tb ON tb.id = td.block_id
             WHERE td.program_id = %s"""
    params = [program["id"]]

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            sql += " AND td.status = %s"
            params.append(statuses[0])
        elif statuses:
            placeholders = ",".join(["%s"] * len(statuses))
            sql += f" AND td.status IN ({placeholders})"
            params.extend(statuses)
    if week:
        sql += " AND td.week_number = %s"
        params.append(int(week))
    if block:
        sql += " AND tb.name = %s"
        params.append(block)

    if status and any(s in ["completed", "missed"] for s in status.split(",")):
        sql += " ORDER BY td.day_number DESC"
    else:
        sql += " ORDER BY td.day_number ASC"
    rows = db.query(sql, params)
    return jsonify({"data": _rows_to_list(rows)})


@bp.route("/dias/ultimo", methods=["GET"])
@jwt_required()
def last_day():
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT id FROM training_programs WHERE user_id=%s AND status IN ('active','completed') ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    if not program:
        return jsonify({"data": None})

    day = db.query_one(
        """SELECT td.id, td.day_number, td.week_number, td.status,
                  ts.letter, ts.description as split_description,
                  tb.name as block_name, tb.color as block_color
           FROM training_days td
           JOIN training_splits ts ON ts.id = td.split_id
           JOIN training_blocks tb ON tb.id = td.block_id
           WHERE td.program_id = %s AND td.status IN ('completed', 'missed')
           ORDER BY td.day_number DESC LIMIT 1""",
        (program["id"],),
    )
    return jsonify({"data": _row_to_dict(day)})


@bp.route("/dias/proximo", methods=["GET"])
@jwt_required()
def next_day():
    user_id = int(get_jwt_identity())
    program = db.query_one(
        "SELECT id FROM training_programs WHERE user_id=%s AND status='active' LIMIT 1",
        (user_id,),
    )
    if not program:
        return jsonify({"data": None})

    day = db.query_one(
        """SELECT td.*, ts.letter, ts.description as split_description,
                  tb.name as block_name, tb.color as block_color
           FROM training_days td
           JOIN training_splits ts ON ts.id = td.split_id
           JOIN training_blocks tb ON tb.id = td.block_id
           WHERE td.program_id = %s AND td.status IN ('pending', 'in_progress')
           ORDER BY td.day_number ASC LIMIT 1""",
        (program["id"],),
    )
    return jsonify({"data": _row_to_dict(day)})


@bp.route("/dias/<int:day_id>", methods=["GET"])
@jwt_required()
def get_day(day_id):
    user_id = int(get_jwt_identity())
    day = db.query_one(
        """SELECT td.*, ts.letter, ts.description as split_description,
                  tb.name as block_name, tb.color as block_color, tb.target_reps,
                  tp.total_weeks, tp.weekly_training_freq,
                  (SELECT COUNT(*) FROM training_days WHERE program_id=td.program_id) as total_days
           FROM training_days td
           JOIN training_splits ts ON ts.id = td.split_id
           JOIN training_blocks tb ON tb.id = td.block_id
           JOIN training_programs tp ON tp.id = td.program_id
           WHERE td.id = %s AND tp.user_id = %s""",
        (day_id, user_id),
    )
    if not day:
        return jsonify({"error": "Dia não encontrado."}), 404

    exercises = db.query(
        """SELECT tde.*, e.name as exercise_name, e.primary_muscle_group, e.equipment
           FROM training_day_exercises tde
           JOIN exercises e ON e.id = tde.exercise_id
           WHERE tde.training_day_id = %s
           ORDER BY se_order.exercise_order""".replace(
            "se_order.exercise_order",
            "(SELECT exercise_order FROM split_exercises WHERE id=tde.split_exercise_id)",
        ),
        (day_id,),
    )

    day_dict = _row_to_dict(day)
    day_dict["exercises"] = _rows_to_list(exercises)
    return jsonify({"data": day_dict})


@bp.route("/dias/<int:day_id>/iniciar", methods=["PATCH"])
@jwt_required()
def start_day(day_id):
    user_id = int(get_jwt_identity())
    row = db.execute(
        """UPDATE training_days SET status='in_progress', started_at=NOW(), updated_at=NOW()
           WHERE id=%s AND status='pending'
           AND program_id IN (SELECT id FROM training_programs WHERE user_id=%s)
           RETURNING *""",
        (day_id, user_id),
    )
    if not row:
        row = db.query_one(
            """SELECT td.* FROM training_days td
               JOIN training_programs tp ON tp.id=td.program_id
               WHERE td.id=%s AND tp.user_id=%s""",
            (day_id, user_id),
        )
        if not row:
            return jsonify({"error": "Dia não encontrado."}), 404
    return jsonify({"data": _row_to_dict(row), "message": "Treino iniciado!"})


@bp.route("/dias/<int:day_id>/concluir", methods=["PATCH"])
@jwt_required()
def complete_day(day_id):
    user_id = int(get_jwt_identity())
    try:
        data = day_complete_schema.load(request.get_json() or {})
    except ValidationError as e:
        return jsonify({"error": "Dados inválidos.", "details": e.messages}), 400

    day = db.query_one(
        """SELECT td.* FROM training_days td
           JOIN training_programs tp ON tp.id=td.program_id
           WHERE td.id=%s AND tp.user_id=%s""",
        (day_id, user_id),
    )
    if not day:
        return jsonify({"error": "Dia não encontrado."}), 404

    _save_exercise_data(day_id, data.get("exercises", []))

    db.execute(
        """UPDATE training_days SET status='completed', completed_at=NOW(),
           notes=%s, updated_at=NOW() WHERE id=%s""",
        (data.get("notes"), day_id),
    )

    # verificar se foi o último dia do ciclo
    program_id = day["program_id"]
    remaining = db.query_one(
        "SELECT COUNT(*) as cnt FROM training_days WHERE program_id=%s AND status='pending'",
        (program_id,),
    )
    if remaining and remaining["cnt"] == 0:
        db.execute(
            "UPDATE training_programs SET status='completed', updated_at=NOW() WHERE id=%s",
            (program_id,),
        )

    return jsonify({"message": "Treino concluído com sucesso! Ótimo trabalho! 💪"})


@bp.route("/dias/<int:day_id>/falta", methods=["PATCH"])
@jwt_required()
def miss_day(day_id):
    user_id = int(get_jwt_identity())
    row = db.execute(
        """UPDATE training_days SET status='missed', completed_at=NOW(), updated_at=NOW()
           WHERE id=%s
           AND program_id IN (SELECT id FROM training_programs WHERE user_id=%s)
           RETURNING *""",
        (day_id, user_id),
    )
    if not row:
        return jsonify({"error": "Dia não encontrado."}), 404

    # verificar fim de ciclo
    program_id = row["program_id"]
    remaining = db.query_one(
        "SELECT COUNT(*) as cnt FROM training_days WHERE program_id=%s AND status='pending'",
        (program_id,),
    )
    if remaining and remaining["cnt"] == 0:
        db.execute(
            "UPDATE training_programs SET status='completed', updated_at=NOW() WHERE id=%s",
            (program_id,),
        )

    return jsonify({"message": "Dia marcado como falta."})


@bp.route("/dias/<int:day_id>/rascunho", methods=["PATCH"])
@jwt_required()
def save_draft(day_id):
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}

    day = db.query_one(
        """SELECT td.id, td.program_id FROM training_days td
           JOIN training_programs tp ON tp.id=td.program_id
           WHERE td.id=%s AND tp.user_id=%s""",
        (day_id, user_id),
    )
    if not day:
        return jsonify({"error": "Dia não encontrado."}), 404

    _save_exercise_data(day_id, data.get("exercises", []))

    db.execute(
        "UPDATE training_days SET updated_at=NOW() WHERE id=%s",
        (day_id,),
    )
    return jsonify({"message": "Rascunho salvo com sucesso."})


@bp.route("/dias/<int:day_id>/reverter", methods=["PATCH"])
@jwt_required()
def revert_day(day_id):
    user_id = int(get_jwt_identity())
    row = db.query_one(
        """SELECT td.id, td.status, td.program_id FROM training_days td
           JOIN training_programs tp ON tp.id = td.program_id
           WHERE td.id = %s AND tp.user_id = %s""",
        (day_id, user_id),
    )
    if not row:
        return jsonify({"error": "Dia não encontrado."}), 404
    if row["status"] == "pending":
        return jsonify({"error": "Este dia já está pendente."}), 400

    # Reverter status e limpar timestamps
    db.execute(
        """UPDATE training_days
           SET status='pending', started_at=NULL, completed_at=NULL, notes=NULL, updated_at=NOW()
           WHERE id=%s""",
        (day_id,),
    )
    # Limpar dados de execução dos exercícios
    db.execute(
        """UPDATE training_day_exercises
           SET actual_load_kg=NULL, actual_reps=NULL, is_completed=FALSE,
               exercise_notes=NULL, completed_at=NULL
           WHERE training_day_id=%s""",
        (day_id,),
    )
    # Se o programa estava 'completed', reativar
    db.execute(
        """UPDATE training_programs SET status='active', updated_at=NOW()
           WHERE id=%s AND status='completed'""",
        (row["program_id"],),
    )
    return jsonify({"message": "Treino revertido para pendente."})


@bp.route("/dias/<int:day_id>/exercicios/<int:ex_id>", methods=["PATCH"])
@jwt_required()
def update_day_exercise(day_id, ex_id):
    user_id = int(get_jwt_identity())
    try:
        data = ex_exec_schema.load(request.get_json() or {})
    except ValidationError as e:
        return jsonify({"error": "Dados inválidos.", "details": e.messages}), 400

    day = db.query_one(
        """SELECT td.id FROM training_days td
           JOIN training_programs tp ON tp.id=td.program_id
           WHERE td.id=%s AND tp.user_id=%s""",
        (day_id, user_id),
    )
    if not day:
        return jsonify({"error": "Dia não encontrado."}), 404

    actual_reps = data.get("actual_reps")
    row = db.execute(
        """UPDATE training_day_exercises SET
           actual_load_kg=%s, actual_reps=%s, is_completed=%s,
           exercise_notes=%s, completed_at=CASE WHEN %s THEN NOW() ELSE NULL END
           WHERE id=%s AND training_day_id=%s RETURNING *""",
        (
            float(data["actual_load_kg"]) if data.get("actual_load_kg") is not None else None,
            json.dumps(actual_reps) if actual_reps is not None else None,
            data.get("is_completed", False),
            data.get("exercise_notes"),
            data.get("is_completed", False),
            ex_id,
            day_id,
        ),
    )
    if not row:
        return jsonify({"error": "Exercício não encontrado."}), 404
    return jsonify({"data": _row_to_dict(row), "message": "Exercício atualizado."})


def _save_exercise_data(day_id, exercises):
    for ex in exercises:
        ex_id = ex.get("id")
        if not ex_id:
            continue
        actual_reps = ex.get("actual_reps")
        db.execute(
            """UPDATE training_day_exercises SET
               actual_load_kg=%s, actual_reps=%s, is_completed=%s,
               exercise_notes=%s,
               completed_at=CASE WHEN %s THEN NOW() ELSE completed_at END
               WHERE id=%s AND training_day_id=%s""",
            (
                float(ex["actual_load_kg"]) if ex.get("actual_load_kg") is not None else None,
                json.dumps(actual_reps) if actual_reps is not None else None,
                ex.get("is_completed", False),
                ex.get("exercise_notes"),
                ex.get("is_completed", False),
                ex_id,
                day_id,
            ),
        )
