-- ============================================================
-- GymTracker 16W — PostgreSQL 16 Schema
-- Gerado em 2026-06-25
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSÕES
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() se necessário no futuro

-- ------------------------------------------------------------
-- FUNÇÃO GLOBAL: atualiza updated_at automaticamente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABELA 1: users
-- Conta de acesso ao sistema. Single-user por instância, mas
-- a estrutura suporta múltiplos usuários com dados isolados.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL          PRIMARY KEY,
    email           VARCHAR(200)    NOT NULL UNIQUE,
    password_hash   VARCHAR(300)    NOT NULL,
    full_name       VARCHAR(200)    NOT NULL,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 2: athletes
-- Perfil físico do atleta. 1 atleta por usuário (UNIQUE user_id).
-- body_restrictions: array de objetos { region, has_restriction, notes }
-- ============================================================
CREATE TABLE IF NOT EXISTS athletes (
    id                  SERIAL          PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name           VARCHAR(200)    NOT NULL,
    birth_date          DATE            NOT NULL,
    sex                 CHAR(1)         NOT NULL CHECK (sex IN ('M', 'F')),
    weight_kg           NUMERIC(5,2)    NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
    height_cm           SMALLINT        NOT NULL CHECK (height_cm > 0 AND height_cm < 300),
    is_diabetic         BOOLEAN         NOT NULL DEFAULT FALSE,
    is_hypertensive     BOOLEAN         NOT NULL DEFAULT FALSE,
    is_cardiac          BOOLEAN         NOT NULL DEFAULT FALSE,
    health_notes        TEXT,
    fitness_goals       TEXT,
    body_restrictions   JSONB           NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE OR REPLACE TRIGGER trg_athletes_updated_at
    BEFORE UPDATE ON athletes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 3: exercises
-- Banco de exercícios por usuário (soft delete via is_active).
-- ============================================================
CREATE TABLE IF NOT EXISTS exercises (
    id                      SERIAL          PRIMARY KEY,
    user_id                 INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                    VARCHAR(100)    NOT NULL,
    primary_muscle_group    VARCHAR(50)     NOT NULL,
    secondary_muscle_group  VARCHAR(50),
    equipment               VARCHAR(50)     NOT NULL,
    exercise_type           VARCHAR(20)     NOT NULL
        CHECK (exercise_type IN ('compound', 'isolation', 'cardio', 'isometric')),
    notes                   VARCHAR(500),
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_exercises_updated_at
    BEFORE UPDATE ON exercises
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 4: gyms
-- Academia(s) associadas ao usuário.
-- ============================================================
CREATE TABLE IF NOT EXISTS gyms (
    id                  SERIAL          PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(100)    NOT NULL,
    address             TEXT,
    phone               VARCHAR(20),
    monthly_fee         NUMERIC(8,2)    CHECK (monthly_fee >= 0),
    payment_due_day     SMALLINT        CHECK (payment_due_day BETWEEN 1 AND 31),
    preferred_schedule  VARCHAR(50),
    notes               TEXT,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_gyms_updated_at
    BEFORE UPDATE ON gyms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 5: training_programs
-- Ciclo de treinamento. Apenas um pode estar 'active' por vez;
-- o anterior é arquivado automaticamente no backend.
-- ============================================================
CREATE TABLE IF NOT EXISTS training_programs (
    id                      SERIAL          PRIMARY KEY,
    user_id                 INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    athlete_id              INTEGER         NOT NULL REFERENCES athletes(id),
    gym_id                  INTEGER         REFERENCES gyms(id) ON DELETE SET NULL,
    name                    VARCHAR(200)    NOT NULL,
    total_weeks             SMALLINT        NOT NULL DEFAULT 16
        CHECK (total_weeks BETWEEN 1 AND 52),
    weekly_training_freq    SMALLINT        NOT NULL
        CHECK (weekly_training_freq BETWEEN 1 AND 7),
    weekly_cardio_freq      SMALLINT        NOT NULL DEFAULT 0
        CHECK (weekly_cardio_freq BETWEEN 0 AND 7),
    status                  VARCHAR(20)     NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'archived')),
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_training_programs_updated_at
    BEFORE UPDATE ON training_programs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 6: training_blocks
-- Fases do ciclo (ex: Resistência S1-4, Hipertrofia S5-10).
-- A soma de (end_week - start_week + 1) de todos os blocos
-- deve igualar total_weeks (validado no backend).
-- ============================================================
CREATE TABLE IF NOT EXISTS training_blocks (
    id                      SERIAL          PRIMARY KEY,
    program_id              INTEGER         NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    block_order             SMALLINT        NOT NULL CHECK (block_order > 0),
    name                    VARCHAR(50)     NOT NULL,
    start_week              SMALLINT        NOT NULL CHECK (start_week > 0),
    end_week                SMALLINT        NOT NULL CHECK (end_week > 0),
    color                   VARCHAR(20)     NOT NULL DEFAULT 'blue',
    target_reps             VARCHAR(20)     NOT NULL,
    target_intensity        VARCHAR(30)     NOT NULL,
    default_rest_seconds    SMALLINT        NOT NULL DEFAULT 60 CHECK (default_rest_seconds > 0),
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_block_week_range CHECK (end_week >= start_week),
    UNIQUE (program_id, block_order)
);

-- ============================================================
-- TABELA 7: training_splits
-- Divisão de grupos musculares por dia (A, B, C...).
-- muscle_groups: TEXT[] — ex: '{Peito,Tríceps}'
-- ============================================================
CREATE TABLE IF NOT EXISTS training_splits (
    id              SERIAL          PRIMARY KEY,
    program_id      INTEGER         NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    letter          VARCHAR(5)      NOT NULL,
    description     VARCHAR(200)    NOT NULL,
    muscle_groups   TEXT[]          NOT NULL DEFAULT '{}',
    split_order     SMALLINT        NOT NULL CHECK (split_order > 0),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, split_order)
);

-- ============================================================
-- TABELA 8: split_exercises
-- Exercícios de cada split (ordem fixa por split_order).
-- ============================================================
CREATE TABLE IF NOT EXISTS split_exercises (
    id              SERIAL      PRIMARY KEY,
    split_id        INTEGER     NOT NULL REFERENCES training_splits(id) ON DELETE CASCADE,
    exercise_id     INTEGER     NOT NULL REFERENCES exercises(id),
    exercise_order  SMALLINT    NOT NULL CHECK (exercise_order > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (split_id, exercise_order)
);

-- ============================================================
-- TABELA 9: split_exercise_block_config
-- Prescrição por exercício × bloco: séries, reps, carga, descanso.
-- UNIQUE (split_exercise_id, block_id) garante 1 config por par.
-- ============================================================
CREATE TABLE IF NOT EXISTS split_exercise_block_config (
    id                  SERIAL          PRIMARY KEY,
    split_exercise_id   INTEGER         NOT NULL REFERENCES split_exercises(id) ON DELETE CASCADE,
    block_id            INTEGER         NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    sets                SMALLINT        NOT NULL CHECK (sets > 0),
    reps                VARCHAR(20)     NOT NULL,      -- ex: '8-12' ou '10'
    load_kg             NUMERIC(6,2)    NOT NULL DEFAULT 0 CHECK (load_kg >= 0),
    rest_seconds        SMALLINT        NOT NULL DEFAULT 60 CHECK (rest_seconds > 0),
    is_included         BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (split_exercise_id, block_id)
);

-- ============================================================
-- TABELA 10: training_days
-- Cada dia gerado automaticamente ao criar o programa.
-- day_number: sequencial global (1 = primeiro treino do ciclo).
-- week_number: baseado no bloco, não em calendário.
-- ============================================================
CREATE TABLE IF NOT EXISTS training_days (
    id              SERIAL          PRIMARY KEY,
    program_id      INTEGER         NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    split_id        INTEGER         NOT NULL REFERENCES training_splits(id),
    block_id        INTEGER         NOT NULL REFERENCES training_blocks(id),
    week_number     SMALLINT        NOT NULL CHECK (week_number > 0),
    day_number      INTEGER         NOT NULL CHECK (day_number > 0),
    status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'missed')),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, day_number)
);

CREATE OR REPLACE TRIGGER trg_training_days_updated_at
    BEFORE UPDATE ON training_days
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABELA 11: training_day_exercises
-- Exercícios planejados e executados de cada treino.
-- planned_* preservado; actual_* preenchido durante execução.
-- actual_reps: JSONB — ex: [10, 10, 8] (uma entrada por série)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_day_exercises (
    id                      SERIAL          PRIMARY KEY,
    training_day_id         INTEGER         NOT NULL REFERENCES training_days(id) ON DELETE CASCADE,
    split_exercise_id       INTEGER         NOT NULL REFERENCES split_exercises(id),
    exercise_id             INTEGER         NOT NULL REFERENCES exercises(id),
    exercise_order          SMALLINT        NOT NULL CHECK (exercise_order > 0),
    -- Prescrição (snapshot do bloco no momento da geração)
    planned_sets            SMALLINT        NOT NULL CHECK (planned_sets > 0),
    planned_reps            VARCHAR(20)     NOT NULL,
    planned_load_kg         NUMERIC(6,2)    NOT NULL DEFAULT 0 CHECK (planned_load_kg >= 0),
    planned_rest_seconds    SMALLINT        NOT NULL CHECK (planned_rest_seconds > 0),
    -- Execução real
    actual_load_kg          NUMERIC(6,2)    CHECK (actual_load_kg >= 0),
    actual_reps             JSONB,          -- array de inteiros, um por série executada
    is_completed            BOOLEAN         NOT NULL DEFAULT FALSE,
    exercise_notes          TEXT,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA 12: measurements
-- Medições corporais. Máx 1 por atleta por dia (UNIQUE).
-- Captura antropometria completa + indicadores de saúde.
-- ============================================================
CREATE TABLE IF NOT EXISTS measurements (
    id                      SERIAL          PRIMARY KEY,
    user_id                 INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    athlete_id              INTEGER         NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    measurement_date        DATE            NOT NULL,
    -- Composição corporal
    weight_kg               NUMERIC(5,2)    CHECK (weight_kg > 0),
    body_fat_pct            NUMERIC(4,1)    CHECK (body_fat_pct BETWEEN 0 AND 100),
    -- Circunferências (cm)
    neck_cm                 NUMERIC(4,1)    CHECK (neck_cm > 0),
    shoulders_cm            NUMERIC(4,1)    CHECK (shoulders_cm > 0),
    chest_cm                NUMERIC(4,1)    CHECK (chest_cm > 0),
    right_arm_relaxed_cm    NUMERIC(4,1)    CHECK (right_arm_relaxed_cm > 0),
    right_arm_flexed_cm     NUMERIC(4,1)    CHECK (right_arm_flexed_cm > 0),
    left_arm_relaxed_cm     NUMERIC(4,1)    CHECK (left_arm_relaxed_cm > 0),
    left_arm_flexed_cm      NUMERIC(4,1)    CHECK (left_arm_flexed_cm > 0),
    right_forearm_cm        NUMERIC(4,1)    CHECK (right_forearm_cm > 0),
    left_forearm_cm         NUMERIC(4,1)    CHECK (left_forearm_cm > 0),
    waist_cm                NUMERIC(4,1)    CHECK (waist_cm > 0),
    hip_cm                  NUMERIC(4,1)    CHECK (hip_cm > 0),
    right_thigh_cm          NUMERIC(4,1)    CHECK (right_thigh_cm > 0),
    left_thigh_cm           NUMERIC(4,1)    CHECK (left_thigh_cm > 0),
    right_calf_cm           NUMERIC(4,1)    CHECK (right_calf_cm > 0),
    left_calf_cm            NUMERIC(4,1)    CHECK (left_calf_cm > 0),
    -- Indicadores de saúde
    fasting_glucose         SMALLINT        CHECK (fasting_glucose > 0),
    systolic_bp             SMALLINT        CHECK (systolic_bp > 0),
    diastolic_bp            SMALLINT        CHECK (diastolic_bp > 0),
    resting_hr              SMALLINT        CHECK (resting_hr > 0),
    notes                   TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (athlete_id, measurement_date)
);

-- ============================================================
-- TABELA 13: ai_analyses
-- Histórico de análises geradas pelo Claude.
-- input_payload: snapshot completo enviado à API (para auditoria).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_analyses (
    id              SERIAL          PRIMARY KEY,
    user_id         INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id      INTEGER         NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    analysis_text   TEXT            NOT NULL,
    input_payload   JSONB           NOT NULL,
    model_used      VARCHAR(50)     NOT NULL DEFAULT 'claude-sonnet-4-6',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

-- Exercícios
CREATE INDEX IF NOT EXISTS idx_exercises_user_active
    ON exercises (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_exercises_muscle
    ON exercises (primary_muscle_group);

-- Programas
CREATE INDEX IF NOT EXISTS idx_programs_user_status
    ON training_programs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_programs_athlete
    ON training_programs (athlete_id);

-- Blocos e splits
CREATE INDEX IF NOT EXISTS idx_blocks_program
    ON training_blocks (program_id, block_order);

CREATE INDEX IF NOT EXISTS idx_splits_program
    ON training_splits (program_id, split_order);

-- Exercícios do split
CREATE INDEX IF NOT EXISTS idx_split_exercises_split
    ON split_exercises (split_id, exercise_order);

CREATE INDEX IF NOT EXISTS idx_split_block_config_exercise
    ON split_exercise_block_config (split_exercise_id);

-- Dias de treino
CREATE INDEX IF NOT EXISTS idx_training_days_program_status
    ON training_days (program_id, status);

CREATE INDEX IF NOT EXISTS idx_training_days_day_number
    ON training_days (program_id, day_number);

CREATE INDEX IF NOT EXISTS idx_training_days_week
    ON training_days (program_id, week_number);

-- Exercícios do dia
CREATE INDEX IF NOT EXISTS idx_day_exercises_day
    ON training_day_exercises (training_day_id);

CREATE INDEX IF NOT EXISTS idx_day_exercises_split_ex
    ON training_day_exercises (split_exercise_id);

-- Medições
CREATE INDEX IF NOT EXISTS idx_measurements_athlete_date
    ON measurements (athlete_id, measurement_date DESC);

CREATE INDEX IF NOT EXISTS idx_measurements_user
    ON measurements (user_id);

-- Análises IA
CREATE INDEX IF NOT EXISTS idx_ai_analyses_user
    ON ai_analyses (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_program
    ON ai_analyses (program_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Supabase
-- ============================================================
-- Mecanismo: o backend Flask injeta SET LOCAL app.current_user_id = X
-- no início de cada transação (ver db.py). As políticas abaixo
-- isolam os dados por usuário usando esse parâmetro de sessão.
--
-- Helper reutilizado nas políticas:
--   NULLIF(current_setting('app.current_user_id', true), '')::integer
--   → retorna NULL se não definido (ex: init_db como postgres)
--   → retorna o integer do usuário autenticado durante requests
--
-- Bypass para role postgres: permite que init_db/seed (sem user_id
-- definido) operem normalmente. Em produção o acesso direto ao banco
-- deve ser restrito por network/credenciais do Supabase.
-- ============================================================

-- Função auxiliar para não repetir o cast em cada política
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS integer AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::integer;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- TABELA: users
-- ------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- postgres bypassa quando app.current_user_id não está definido (init)
CREATE POLICY users_admin ON users TO postgres
    USING (current_user_id() IS NULL)
    WITH CHECK (current_user_id() IS NULL);

-- Registro: INSERT permitido sem user_id (usuário ainda não existe)
CREATE POLICY users_insert ON users FOR INSERT
    WITH CHECK (true);

-- Leitura e atualização: apenas o próprio registro
CREATE POLICY users_select ON users FOR SELECT
    USING (id = current_user_id());

CREATE POLICY users_update ON users FOR UPDATE
    USING (id = current_user_id())
    WITH CHECK (id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: athletes
-- ------------------------------------------------------------
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE athletes FORCE ROW LEVEL SECURITY;

CREATE POLICY athletes_admin ON athletes TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY athletes_isolation ON athletes
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: exercises
-- ------------------------------------------------------------
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises FORCE ROW LEVEL SECURITY;

CREATE POLICY exercises_admin ON exercises TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY exercises_isolation ON exercises
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: gyms
-- ------------------------------------------------------------
ALTER TABLE gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE gyms FORCE ROW LEVEL SECURITY;

CREATE POLICY gyms_admin ON gyms TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY gyms_isolation ON gyms
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: training_programs
-- ------------------------------------------------------------
ALTER TABLE training_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_programs FORCE ROW LEVEL SECURITY;

CREATE POLICY programs_admin ON training_programs TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY programs_isolation ON training_programs
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: training_blocks  (sem user_id — isolamento via program)
-- ------------------------------------------------------------
ALTER TABLE training_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_blocks FORCE ROW LEVEL SECURITY;

CREATE POLICY blocks_admin ON training_blocks TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY blocks_isolation ON training_blocks
    USING (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    )
    WITH CHECK (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: training_splits  (sem user_id — isolamento via program)
-- ------------------------------------------------------------
ALTER TABLE training_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_splits FORCE ROW LEVEL SECURITY;

CREATE POLICY splits_admin ON training_splits TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY splits_isolation ON training_splits
    USING (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    )
    WITH CHECK (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: split_exercises  (sem user_id — via split → program)
-- ------------------------------------------------------------
ALTER TABLE split_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_exercises FORCE ROW LEVEL SECURITY;

CREATE POLICY split_ex_admin ON split_exercises TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY split_ex_isolation ON split_exercises
    USING (
        split_id IN (
            SELECT ts.id FROM training_splits ts
            JOIN training_programs tp ON tp.id = ts.program_id
            WHERE tp.user_id = current_user_id()
        )
    )
    WITH CHECK (
        split_id IN (
            SELECT ts.id FROM training_splits ts
            JOIN training_programs tp ON tp.id = ts.program_id
            WHERE tp.user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: split_exercise_block_config  (via split_exercise → split → program)
-- ------------------------------------------------------------
ALTER TABLE split_exercise_block_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_exercise_block_config FORCE ROW LEVEL SECURITY;

CREATE POLICY sebc_admin ON split_exercise_block_config TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY sebc_isolation ON split_exercise_block_config
    USING (
        split_exercise_id IN (
            SELECT se.id FROM split_exercises se
            JOIN training_splits ts ON ts.id = se.split_id
            JOIN training_programs tp ON tp.id = ts.program_id
            WHERE tp.user_id = current_user_id()
        )
    )
    WITH CHECK (
        split_exercise_id IN (
            SELECT se.id FROM split_exercises se
            JOIN training_splits ts ON ts.id = se.split_id
            JOIN training_programs tp ON tp.id = ts.program_id
            WHERE tp.user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: training_days  (sem user_id — isolamento via program)
-- ------------------------------------------------------------
ALTER TABLE training_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_days FORCE ROW LEVEL SECURITY;

CREATE POLICY days_admin ON training_days TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY days_isolation ON training_days
    USING (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    )
    WITH CHECK (
        program_id IN (
            SELECT id FROM training_programs WHERE user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: training_day_exercises  (via training_day → program)
-- ------------------------------------------------------------
ALTER TABLE training_day_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_day_exercises FORCE ROW LEVEL SECURITY;

CREATE POLICY tde_admin ON training_day_exercises TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY tde_isolation ON training_day_exercises
    USING (
        training_day_id IN (
            SELECT td.id FROM training_days td
            JOIN training_programs tp ON tp.id = td.program_id
            WHERE tp.user_id = current_user_id()
        )
    )
    WITH CHECK (
        training_day_id IN (
            SELECT td.id FROM training_days td
            JOIN training_programs tp ON tp.id = td.program_id
            WHERE tp.user_id = current_user_id()
        )
    );

-- ------------------------------------------------------------
-- TABELA: measurements
-- ------------------------------------------------------------
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements FORCE ROW LEVEL SECURITY;

CREATE POLICY measurements_admin ON measurements TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY measurements_isolation ON measurements
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());

-- ------------------------------------------------------------
-- TABELA: ai_analyses
-- ------------------------------------------------------------
ALTER TABLE ai_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_admin ON ai_analyses TO postgres
    USING (current_user_id() IS NULL) WITH CHECK (current_user_id() IS NULL);

CREATE POLICY ai_isolation ON ai_analyses
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());
