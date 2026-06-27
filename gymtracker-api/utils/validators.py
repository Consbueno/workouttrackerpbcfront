from marshmallow import Schema, fields, validate, validates_schema, ValidationError

MUSCLE_GROUPS = [
    "Peito", "Costas", "Ombros", "Bíceps", "Tríceps", "Antebraço",
    "Quadríceps", "Posterior", "Glúteos", "Panturrilha",
    "Abdômen", "Trapézio", "Lombar", "Core (Geral)",
]

EQUIPMENT = ["Barra", "Halter", "Máquina", "Polia/Cabo", "Peso Corporal", "Elástico", "Kettlebell", "Smith", "Outro"]
EXERCISE_TYPES = ["compound", "isolation", "cardio", "isometric"]
BLOCK_COLORS = ["blue", "yellow", "red", "gray", "green", "purple"]


class RegisterSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=6))
    full_name = fields.Str(required=True, validate=validate.Length(min=1, max=200))


class LoginSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(required=True)


class ExerciseSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    primary_muscle_group = fields.Str(required=True, validate=validate.OneOf(MUSCLE_GROUPS))
    secondary_muscle_group = fields.Str(allow_none=True, validate=validate.OneOf(MUSCLE_GROUPS + [None]))
    equipment = fields.Str(required=True, validate=validate.OneOf(EQUIPMENT))
    exercise_type = fields.Str(required=True, validate=validate.OneOf(EXERCISE_TYPES))
    notes = fields.Str(allow_none=True, validate=validate.Length(max=500))
    is_active = fields.Bool(load_default=True)


class BodyRestrictionSchema(Schema):
    region = fields.Str(required=True)
    has_restriction = fields.Bool(required=True)
    notes = fields.Str(allow_none=True)


class AthleteSchema(Schema):
    full_name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    birth_date = fields.Date(required=True)
    sex = fields.Str(required=True, validate=validate.OneOf(["M", "F"]))
    weight_kg = fields.Decimal(required=True, places=2)
    height_cm = fields.Int(required=True)
    is_diabetic = fields.Bool(load_default=False)
    is_hypertensive = fields.Bool(load_default=False)
    is_cardiac = fields.Bool(load_default=False)
    health_notes = fields.Str(allow_none=True)
    fitness_goals = fields.Str(allow_none=True)
    body_restrictions = fields.List(fields.Dict(), load_default=[])


class GymSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    address = fields.Str(allow_none=True)
    phone = fields.Str(allow_none=True, validate=validate.Length(max=20))
    monthly_fee = fields.Decimal(allow_none=True, places=2)
    payment_due_day = fields.Int(allow_none=True, validate=validate.Range(min=1, max=31))
    preferred_schedule = fields.Str(allow_none=True)
    notes = fields.Str(allow_none=True)
    is_active = fields.Bool(load_default=True)


class BlockConfigSchema(Schema):
    block_order = fields.Int(required=True)
    name = fields.Str(required=True)
    start_week = fields.Int(required=True)
    end_week = fields.Int(required=True)
    color = fields.Str(required=True, validate=validate.OneOf(BLOCK_COLORS))
    target_reps = fields.Str(required=True)
    target_intensity = fields.Str(required=True)
    default_rest_seconds = fields.Int(load_default=60)


class SplitExerciseBlockConfigSchema(Schema):
    block_order = fields.Int(required=True)
    sets = fields.Int(required=True)
    reps = fields.Str(required=True)
    load_kg = fields.Decimal(load_default=0, places=2)
    rest_seconds = fields.Int(load_default=60)
    is_included = fields.Bool(load_default=True)


class SplitExerciseSchema(Schema):
    exercise_id = fields.Int(required=True)
    exercise_order = fields.Int(required=True)
    block_configs = fields.List(fields.Nested(SplitExerciseBlockConfigSchema), required=True)


class SplitSchema(Schema):
    letter = fields.Str(required=True, validate=validate.Length(max=5))
    description = fields.Str(required=True)
    muscle_groups = fields.List(fields.Str(), required=True)
    split_order = fields.Int(required=True)
    exercises = fields.List(fields.Nested(SplitExerciseSchema), required=True)


class ProgramSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    athlete_id = fields.Int(required=True)
    gym_id = fields.Int(allow_none=True)
    total_weeks = fields.Int(load_default=16, validate=validate.Range(min=8, max=24))
    weekly_training_freq = fields.Int(required=True, validate=validate.Range(min=2, max=6))
    weekly_cardio_freq = fields.Int(load_default=0, validate=validate.Range(min=0, max=6))
    blocks = fields.List(fields.Nested(BlockConfigSchema), required=True)
    splits = fields.List(fields.Nested(SplitSchema), required=True)

    @validates_schema
    def validate_blocks_sum(self, data, **kwargs):
        if "blocks" in data and "total_weeks" in data:
            total = sum(b["end_week"] - b["start_week"] + 1 for b in data["blocks"])
            if total != data["total_weeks"]:
                raise ValidationError(
                    f"A soma dos blocos ({total} semanas) é diferente do total do ciclo ({data['total_weeks']} semanas)."
                )


class MeasurementSchema(Schema):
    measurement_date = fields.Date(required=True)
    weight_kg = fields.Decimal(allow_none=True, places=2)
    body_fat_pct = fields.Decimal(allow_none=True, places=1)
    neck_cm = fields.Decimal(allow_none=True, places=1)
    shoulders_cm = fields.Decimal(allow_none=True, places=1)
    chest_cm = fields.Decimal(allow_none=True, places=1)
    right_arm_relaxed_cm = fields.Decimal(allow_none=True, places=1)
    right_arm_flexed_cm = fields.Decimal(allow_none=True, places=1)
    left_arm_relaxed_cm = fields.Decimal(allow_none=True, places=1)
    left_arm_flexed_cm = fields.Decimal(allow_none=True, places=1)
    right_forearm_cm = fields.Decimal(allow_none=True, places=1)
    left_forearm_cm = fields.Decimal(allow_none=True, places=1)
    waist_cm = fields.Decimal(allow_none=True, places=1)
    hip_cm = fields.Decimal(allow_none=True, places=1)
    right_thigh_cm = fields.Decimal(allow_none=True, places=1)
    left_thigh_cm = fields.Decimal(allow_none=True, places=1)
    right_calf_cm = fields.Decimal(allow_none=True, places=1)
    left_calf_cm = fields.Decimal(allow_none=True, places=1)
    fasting_glucose = fields.Int(allow_none=True)
    systolic_bp = fields.Int(allow_none=True)
    diastolic_bp = fields.Int(allow_none=True)
    resting_hr = fields.Int(allow_none=True)
    notes = fields.Str(allow_none=True)


class ExerciseExecutionSchema(Schema):
    actual_load_kg = fields.Decimal(allow_none=True, places=2)
    actual_reps = fields.Raw(allow_none=True)
    is_completed = fields.Bool(load_default=False)
    exercise_notes = fields.Str(allow_none=True)


class DayCompleteSchema(Schema):
    notes = fields.Str(allow_none=True)
    exercises = fields.List(fields.Dict(), load_default=[])


class ProgressaoSchema(Schema):
    percentual = fields.Decimal(required=True)
