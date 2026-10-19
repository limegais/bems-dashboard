-- ============================================================================
-- BEMS LIVING LAB -- POSTGRESQL SCHEMA v2.0.0
-- ============================================================================
-- Target  : PostgreSQL 16/17 on Ubuntu 26.04 LTS (Ryzen 9 7900X, 32 GiB RAM)
-- Opsional: TimescaleDB untuk performa time-series optimal
--
-- 7 Schema | 20 Tabel | 20+ Index | 7 View | 2 Fungsi (PMV/PPD)
-- [1] bems_core      : users, buildings, rooms, workstations (6 SHT31), devices
-- [2] bems_telemetry : sht31_readings, nnzn_weather, pzem_readings, occupancy, mqtt_raw_log
-- [3] bems_energy    : hourly_summary, daily_summary, monthly_summary, tarif_history
-- [4] bems_feedback  : comfort_votes, user_preferences
-- [5] bems_ai        : model_registry, forecast_records, optimization_runs,
--                      pareto_solutions, model_evaluations, inference_inputs
-- [6] bems_control   : actuation_logs, operation_sessions, safety_rules
-- [7] bems_audit     : change_log
-- ============================================================================

-- 0. EKSTENSI & SKEMA
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
-- CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

CREATE SCHEMA IF NOT EXISTS bems_core;
CREATE SCHEMA IF NOT EXISTS bems_telemetry;
CREATE SCHEMA IF NOT EXISTS bems_energy;
CREATE SCHEMA IF NOT EXISTS bems_feedback;
CREATE SCHEMA IF NOT EXISTS bems_ai;
CREATE SCHEMA IF NOT EXISTS bems_control;
CREATE SCHEMA IF NOT EXISTS bems_audit;

-- ============================================================================
-- 1. BEMS_CORE -- MASTER DATA
-- ============================================================================
CREATE TABLE bems_core.users (
    id            SERIAL        PRIMARY KEY,
    username      VARCHAR(50)   UNIQUE NOT NULL,
    email         VARCHAR(120)  UNIQUE NOT NULL,
    password_hash VARCHAR(255)  NOT NULL,
    full_name     VARCHAR(120)  NOT NULL,
    role          VARCHAR(20)   NOT NULL DEFAULT 'occupant'
                  CHECK (role IN ('superadmin','researcher','operator','occupant')),
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bems_core.users IS 'User accounts RBAC 4-level';

CREATE TABLE bems_core.buildings (
    id          SERIAL           PRIMARY KEY,
    code        VARCHAR(20)      UNIQUE NOT NULL,
    name        VARCHAR(150)     NOT NULL,
    address     TEXT,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    timezone    VARCHAR(50)      NOT NULL DEFAULT 'Asia/Jakarta',
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TABLE bems_core.rooms (
    id              SERIAL       PRIMARY KEY,
    building_id     INT          NOT NULL REFERENCES bems_core.buildings(id) ON DELETE CASCADE,
    code            VARCHAR(30)  UNIQUE NOT NULL,
    name            VARCHAR(150) NOT NULL,
    floor_level     SMALLINT     NOT NULL DEFAULT 2,
    area_sqm        NUMERIC(7,2) NOT NULL DEFAULT 72.00,
    height_m        NUMERIC(4,2) NOT NULL DEFAULT 3.20,
    max_occupancy   SMALLINT     NOT NULL DEFAULT 30,
    target_temp_min REAL         NOT NULL DEFAULT 23.0,
    target_temp_max REAL         NOT NULL DEFAULT 26.0,
    target_rh_min   REAL         NOT NULL DEFAULT 40.0,
    target_rh_max   REAL         NOT NULL DEFAULT 60.0,
    target_lux_min  REAL         NOT NULL DEFAULT 350.0,
    target_lux_max  REAL         NOT NULL DEFAULT 550.0,
    target_co2_max  REAL         NOT NULL DEFAULT 1000.0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bems_core.rooms IS 'Ruangan dengan setpoint kenyamanan termal & visual';

CREATE TABLE bems_core.workstations (
    id              SERIAL       PRIMARY KEY,
    room_id         INT          NOT NULL REFERENCES bems_core.rooms(id) ON DELETE CASCADE,
    code            VARCHAR(40)  UNIQUE NOT NULL,
    label           VARCHAR(80)  NOT NULL,
    legacy_alias    VARCHAR(10),
    zone_name       VARCHAR(80),
    ip_address      INET,
    coord_x_m       REAL,
    coord_y_m       REAL,
    cal_offset_temp REAL         NOT NULL DEFAULT 0.0,
    cal_offset_rh   REAL         NOT NULL DEFAULT 0.0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    description     TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bems_core.workstations IS 'Node SHT31 sht-1..sht-6 dengan koordinat posisi spasial';

CREATE TABLE bems_core.devices (
    id                SERIAL       PRIMARY KEY,
    room_id           INT          NOT NULL REFERENCES bems_core.rooms(id) ON DELETE CASCADE,
    workstation_id    INT          REFERENCES bems_core.workstations(id) ON DELETE SET NULL,
    device_code       VARCHAR(60)  UNIQUE NOT NULL,
    device_type       VARCHAR(40)  NOT NULL CHECK (device_type IN (
        'sht31_sensor','pzem_meter','weather_station','ac_inverter',
        'lighting_dimmer','lux_meter','radar_occupancy','co2_sensor',
        'globe_thermometer','camera_yolo')),
    model_name        VARCHAR(100),
    manufacturer      VARCHAR(80),
    serial_number     VARCHAR(80)  UNIQUE,
    firmware_version  VARCHAR(30),
    mqtt_sub_topic    VARCHAR(255),
    mqtt_pub_topic    VARCHAR(255),
    ip_or_bus_addr    VARCHAR(60),
    modbus_address    SMALLINT,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    installation_date DATE,
    last_seen_at      TIMESTAMPTZ,
    metadata          JSONB        NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bems_core.devices IS 'Inventaris perangkat IoT, sensor, dan aktuator';

-- ============================================================================
-- 2. BEMS_TELEMETRY -- TIME-SERIES MQTT STREAMS
-- ============================================================================

-- 2.1 Sensor SHT31 indoor per workstation
-- MQTT: sht-{1..6}/sensor/SHT31/state  |  Interval: ~1-5 menit
CREATE TABLE bems_telemetry.sht31_readings (
    time              TIMESTAMPTZ NOT NULL,
    workstation_id    INT         NOT NULL REFERENCES bems_core.workstations(id),
    air_temperature   REAL        NOT NULL,   -- Ta (C)
    relative_humidity REAL        NOT NULL,   -- RH (%)
    dew_point_c       REAL,
    absolute_humidity REAL,
    heat_index_c      REAL,
    lux_level         REAL,
    fanger_pmv        REAL,
    fanger_ppd        REAL,
    mean_radiant_temp REAL,                   -- MRT/Tr (C) dari globe thermometer
    operative_temp    REAL,                   -- Top = (Ta+Tr)/2 (C)
    co2_ppm           REAL,
    raw_payload       JSONB,
    mqtt_topic        VARCHAR(255),
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sht31_time_ws ON bems_telemetry.sht31_readings (time DESC, workstation_id);
CREATE INDEX idx_sht31_ws_time ON bems_telemetry.sht31_readings (workstation_id, time DESC);
COMMENT ON TABLE bems_telemetry.sht31_readings IS 'Telemetri SHT31 per workstation; ~1-5 menit interval';

-- 2.2 Cuaca outdoor NNZN RS485
-- MQTT: nnzn-weather/sensor/+/state  |  Interval: ~1 menit
CREATE TABLE bems_telemetry.nnzn_weather (
    time               TIMESTAMPTZ NOT NULL,
    device_id          INT         NOT NULL REFERENCES bems_core.devices(id),
    outdoor_temp_c     REAL        NOT NULL,
    outdoor_rh_pct     REAL        NOT NULL,
    solar_irradiance   REAL,
    outdoor_lux        REAL,
    wind_speed_ms      REAL        DEFAULT 0.0,
    wind_direction_deg REAL,
    barometric_pa      REAL,
    rainfall_mm        REAL        DEFAULT 0.0,
    lux_wb1            REAL,
    lux_wb2            REAL,
    lux_wb3            REAL,
    lux_wb4            REAL,
    co2_outdoor_ppm    REAL,
    airflow_speed_ms   REAL,
    raw_payload        JSONB,
    mqtt_topic         VARCHAR(255),
    received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_nnzn_time        ON bems_telemetry.nnzn_weather (time DESC);
CREATE INDEX idx_nnzn_device_time ON bems_telemetry.nnzn_weather (device_id, time DESC);
COMMENT ON TABLE bems_telemetry.nnzn_weather IS 'Telemetri NNZN RS485 outdoor; ~1 menit interval';

-- 2.3 Sub-metering listrik PZEM-004T (ch1=AC, ch2=Socket, ch3=Lampu)
-- MQTT: bems/pzem/ch{1,2,3}/telemetry  |  Interval: ~4 detik
CREATE TABLE bems_telemetry.pzem_readings (
    time               TIMESTAMPTZ      NOT NULL,
    device_id          INT              NOT NULL REFERENCES bems_core.devices(id),
    channel_id         SMALLINT         NOT NULL CHECK (channel_id IN (1,2,3)),
    channel_label      VARCHAR(30),
    voltage_v          REAL             NOT NULL,
    current_a          REAL             NOT NULL,
    active_power_w     REAL             NOT NULL,
    apparent_power_va  REAL,
    reactive_power_var REAL,
    power_factor       REAL             CHECK (power_factor BETWEEN 0.0 AND 1.0),
    frequency_hz       REAL             NOT NULL DEFAULT 50.0,
    energy_kwh         DOUBLE PRECISION NOT NULL,
    delta_kwh          DOUBLE PRECISION,
    cost_idr           NUMERIC(12,2),
    co2_kg             REAL,
    raw_payload        JSONB,
    mqtt_topic         VARCHAR(255),
    received_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pzem_time_chan   ON bems_telemetry.pzem_readings (time DESC, channel_id);
CREATE INDEX idx_pzem_device_time ON bems_telemetry.pzem_readings (device_id, time DESC);
CREATE INDEX idx_pzem_chan_time   ON bems_telemetry.pzem_readings (channel_id, time DESC);
COMMENT ON TABLE bems_telemetry.pzem_readings IS 'Sub-metering PZEM-004T 3-channel; ~4 detik interval';

-- 2.4 Occupancy ruangan
CREATE TABLE bems_telemetry.occupancy (
    time                 TIMESTAMPTZ NOT NULL,
    room_id              INT         NOT NULL REFERENCES bems_core.rooms(id),
    device_id            INT         REFERENCES bems_core.devices(id),
    headcount            SMALLINT    NOT NULL DEFAULT 0,
    motion_detected      BOOLEAN     NOT NULL DEFAULT FALSE,
    detection_method     VARCHAR(30) DEFAULT 'mmWave_radar'
                         CHECK (detection_method IN ('mmWave_radar','camera_yolo','manual','pir')),
    avg_met_rate         REAL        DEFAULT 1.2,
    avg_clothing_clo     REAL        DEFAULT 0.5,
    detection_confidence REAL        CHECK (detection_confidence BETWEEN 0.0 AND 1.0),
    raw_payload          JSONB,
    received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_occupancy_time_room ON bems_telemetry.occupancy (time DESC, room_id);

-- 2.5 Raw MQTT archive (forensik & replay semua topik)
CREATE TABLE bems_telemetry.mqtt_raw_log (
    id           BIGSERIAL    PRIMARY KEY,
    received_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    mqtt_topic   VARCHAR(255) NOT NULL,
    qos          SMALLINT     NOT NULL DEFAULT 0,
    retain       BOOLEAN      NOT NULL DEFAULT FALSE,
    payload_raw  TEXT,
    payload_json JSONB,
    client_id    VARCHAR(100),
    broker_host  VARCHAR(100) DEFAULT '128.199.206.166',
    processed    BOOLEAN      NOT NULL DEFAULT FALSE,
    parse_error  TEXT
);
CREATE INDEX idx_mqtt_raw_time   ON bems_telemetry.mqtt_raw_log (received_at DESC);
CREATE INDEX idx_mqtt_raw_topic  ON bems_telemetry.mqtt_raw_log (mqtt_topic, received_at DESC);
CREATE INDEX idx_mqtt_raw_unproc ON bems_telemetry.mqtt_raw_log (processed, received_at DESC)
    WHERE processed = FALSE;
COMMENT ON TABLE bems_telemetry.mqtt_raw_log IS 'Archive MQTT mentah -- forensik, replay, data quality';

-- ============================================================================
-- 3. BEMS_ENERGY -- HISTORIS & AGREGASI ENERGI
-- ============================================================================

-- 3.1 Rollup per jam (scheduled job tiap 1 jam)
CREATE TABLE bems_energy.hourly_summary (
    id               BIGSERIAL        PRIMARY KEY,
    hour_start       TIMESTAMPTZ      NOT NULL,
    room_id          INT              NOT NULL REFERENCES bems_core.rooms(id),
    channel_id       SMALLINT         NOT NULL CHECK (channel_id IN (1,2,3)),
    channel_label    VARCHAR(30),
    avg_power_w      REAL             NOT NULL,
    max_power_w      REAL             NOT NULL,
    min_power_w      REAL             NOT NULL,
    energy_kwh       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    avg_voltage_v    REAL,
    avg_current_a    REAL,
    avg_pf           REAL,
    avg_freq_hz      REAL,
    cost_idr         NUMERIC(12,2),
    co2_kg           REAL,
    sample_count     INT              NOT NULL DEFAULT 0,
    data_quality_pct REAL             NOT NULL DEFAULT 100.0,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (hour_start, room_id, channel_id)
);
CREATE INDEX idx_energy_hourly_time ON bems_energy.hourly_summary (hour_start DESC);
CREATE INDEX idx_energy_hourly_room ON bems_energy.hourly_summary (room_id, hour_start DESC);

-- 3.2 Ringkasan harian (channel_id=0 = total)
CREATE TABLE bems_energy.daily_summary (
    id             BIGSERIAL        PRIMARY KEY,
    date_local     DATE             NOT NULL,
    room_id        INT              NOT NULL REFERENCES bems_core.rooms(id),
    channel_id     SMALLINT         NOT NULL CHECK (channel_id IN (0,1,2,3)),
    channel_label  VARCHAR(30),
    energy_kwh     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    peak_power_w   REAL             NOT NULL DEFAULT 0.0,
    peak_time      TIMESTAMPTZ,
    avg_power_w    REAL,
    baseline_kwh   DOUBLE PRECISION,
    savings_kwh    DOUBLE PRECISION,
    savings_pct    REAL,
    tarif_kwh_idr  NUMERIC(10,2)    NOT NULL DEFAULT 1441.70,
    cost_idr       NUMERIC(14,2)    NOT NULL DEFAULT 0.0,
    carbon_factor  REAL             NOT NULL DEFAULT 0.85,
    co2_kg         REAL             NOT NULL DEFAULT 0.0,
    occupied_hours REAL,
    avg_occupancy  REAL,
    is_finalized   BOOLEAN          NOT NULL DEFAULT FALSE,
    notes          TEXT,
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (date_local, room_id, channel_id)
);
CREATE INDEX idx_energy_daily_date ON bems_energy.daily_summary (date_local DESC);
CREATE INDEX idx_energy_daily_room ON bems_energy.daily_summary (room_id, date_local DESC);

-- 3.3 Ringkasan bulanan
CREATE TABLE bems_energy.monthly_summary (
    id            BIGSERIAL        PRIMARY KEY,
    year_month    CHAR(7)          NOT NULL,   -- '2026-10'
    room_id       INT              NOT NULL REFERENCES bems_core.rooms(id),
    channel_id    SMALLINT         NOT NULL CHECK (channel_id IN (0,1,2,3)),
    channel_label VARCHAR(30),
    energy_kwh    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    peak_power_w  REAL,
    cost_idr      NUMERIC(15,2),
    co2_kg        REAL,
    avg_daily_kwh REAL,
    working_days  SMALLINT,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (year_month, room_id, channel_id)
);

-- 3.4 Riwayat tarif listrik PLN
CREATE TABLE bems_energy.tarif_history (
    id             SERIAL        PRIMARY KEY,
    effective_date DATE          NOT NULL UNIQUE,
    tarif_kwh_idr  NUMERIC(10,4) NOT NULL,
    tarif_class    VARCHAR(20)   NOT NULL DEFAULT 'I3/TM',
    carbon_factor  REAL          NOT NULL DEFAULT 0.85,
    source_ref     TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. BEMS_FEEDBACK -- KENYAMANAN MANUSIA (ASHRAE 55 / ISO 7730)
-- ============================================================================
CREATE TABLE bems_feedback.comfort_votes (
    id                     BIGSERIAL   PRIMARY KEY,
    voted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id                INT         REFERENCES bems_core.users(id) ON DELETE SET NULL,
    room_id                INT         NOT NULL REFERENCES bems_core.rooms(id),
    workstation_id         INT         REFERENCES bems_core.workstations(id),
    session_token          UUID        DEFAULT uuid_generate_v4(),
    thermal_sensation_vote SMALLINT    NOT NULL CHECK (thermal_sensation_vote BETWEEN -3 AND 3),
    thermal_preference     VARCHAR(20) NOT NULL CHECK (thermal_preference IN ('cooler','no_change','warmer')),
    thermal_acceptance     VARCHAR(20) CHECK (thermal_acceptance IN ('acceptable','unacceptable')),
    visual_comfort_vote    VARCHAR(20) NOT NULL CHECK (visual_comfort_vote IN ('too_dim','comfortable','too_bright','glare')),
    air_quality_vote       VARCHAR(20) CHECK (air_quality_vote IN ('stuffy','neutral','fresh')),
    snap_air_temp          REAL,
    snap_mrt               REAL,
    snap_rh                REAL,
    snap_lux               REAL,
    snap_co2_ppm           REAL,
    snap_pmv               REAL,
    snap_ppd               REAL,
    clothing_clo           REAL        NOT NULL DEFAULT 0.50,
    activity_met           REAL        NOT NULL DEFAULT 1.10,
    gender                 VARCHAR(10) CHECK (gender IN ('male','female','prefer_not')),
    age_group              VARCHAR(20) CHECK (age_group IN ('17-25','26-35','36-50','51+')),
    feedback_notes         TEXT,
    client_ip              INET,
    user_agent             TEXT
);
CREATE INDEX idx_comfort_voted_at  ON bems_feedback.comfort_votes (voted_at DESC);
CREATE INDEX idx_comfort_room_date ON bems_feedback.comfort_votes (room_id, voted_at DESC);
COMMENT ON TABLE bems_feedback.comfort_votes IS 'Voting kenyamanan termal & visual (ASHRAE 55 / ISO 7730)';

CREATE TABLE bems_feedback.user_preferences (
    id             SERIAL      PRIMARY KEY,
    user_id        INT         UNIQUE NOT NULL REFERENCES bems_core.users(id) ON DELETE CASCADE,
    preferred_temp REAL,
    preferred_lux  REAL,
    typical_clo    REAL        DEFAULT 0.5,
    typical_met    REAL        DEFAULT 1.2,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. BEMS_AI -- MACHINE LEARNING, PREDIKSI & OPTIMASI
-- ============================================================================

-- 5.1 Registry model ML
CREATE TABLE bems_ai.model_registry (
    id              SERIAL       PRIMARY KEY,
    model_name      VARCHAR(100) NOT NULL,
    model_type      VARCHAR(50)  NOT NULL CHECK (model_type IN (
        'BiLSTM','LSTM','GRU','TFT','XGBoost','LightGBM',
        'RandomForest','CNN_LSTM','Transformer','rule_based')),
    target_variable VARCHAR(80)  NOT NULL,
    input_features  JSONB        NOT NULL,
    hyperparameters JSONB        NOT NULL DEFAULT '{}',
    metrics         JSONB        NOT NULL DEFAULT '{}',
    training_start  DATE,
    training_end    DATE,
    data_source     TEXT,
    artifact_path   TEXT,
    is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
    notes           TEXT,
    created_by      INT          REFERENCES bems_core.users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bems_ai.model_registry IS 'Registry model ML -- Bi-LSTM, TFT, XGBoost, dll';

-- 5.2 Rekaman prediksi per variabel
CREATE TABLE bems_ai.forecast_records (
    id                  BIGSERIAL   PRIMARY KEY,
    model_id            INT         NOT NULL REFERENCES bems_ai.model_registry(id),
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    forecast_horizon_h  REAL        NOT NULL,
    target_time         TIMESTAMPTZ NOT NULL,
    metric_type         VARCHAR(60) NOT NULL CHECK (metric_type IN (
        'electrical_load_w','ac_power_w','socket_power_w','lamp_power_w',
        'outdoor_temp_c','solar_irradiance_wm2',
        'indoor_temp_c','indoor_rh_pct','pmv_index','occupancy_count')),
    predicted_value     REAL        NOT NULL,
    confidence_lower_95 REAL,
    confidence_upper_95 REAL,
    confidence_lower_80 REAL,
    confidence_upper_80 REAL,
    actual_value        REAL,
    abs_error           REAL,
    pct_error           REAL,
    room_id             INT         REFERENCES bems_core.rooms(id),
    workstation_id      INT         REFERENCES bems_core.workstations(id)
);
CREATE INDEX idx_forecast_target ON bems_ai.forecast_records (target_time DESC);
CREATE INDEX idx_forecast_metric ON bems_ai.forecast_records (metric_type, target_time DESC);
CREATE INDEX idx_forecast_model  ON bems_ai.forecast_records (model_id, generated_at DESC);
CREATE INDEX idx_forecast_uneval ON bems_ai.forecast_records (target_time)
    WHERE actual_value IS NULL;

-- 5.3 Sesi eksekusi MOGA / MOPSO
CREATE TABLE bems_ai.optimization_runs (
    id                      BIGSERIAL   PRIMARY KEY,
    run_timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    algorithm               VARCHAR(30) NOT NULL
                            CHECK (algorithm IN ('NSGA-II_MOGA','MOPSO','RULE_BASED','MANUAL','HYBRID')),
    triggered_by            VARCHAR(20) NOT NULL DEFAULT 'scheduler'
                            CHECK (triggered_by IN ('scheduler','manual','event_co2','event_temp','api')),
    initiated_by_user_id    INT         REFERENCES bems_core.users(id),
    room_id                 INT         NOT NULL REFERENCES bems_core.rooms(id),
    population_size         INT         NOT NULL,
    max_iterations          INT         NOT NULL,
    actual_iterations       INT,
    crossover_rate          REAL,
    mutation_rate           REAL,
    inertia_weight          REAL,
    cognitive_coeff         REAL,
    social_coeff            REAL,
    archive_size            INT,
    hyperparameters         JSONB       NOT NULL DEFAULT '{}',
    input_outdoor_temp      REAL,
    input_solar_irr         REAL,
    input_occupancy         INT,
    input_forecasted_load_w REAL,
    pareto_solutions_count  INT         NOT NULL DEFAULT 0,
    hypervolume_metric      REAL,
    spread_metric           REAL,
    execution_time_ms       INT         NOT NULL,
    selected_solution_idx   INT,
    selection_method        VARCHAR(30) DEFAULT 'min_energy'
                            CHECK (selection_method IN ('min_energy','min_ppd','fuzzy_topsis','manual')),
    optimal_tset_ac         REAL        NOT NULL,
    optimal_pwm_z1_pct      SMALLINT    NOT NULL,
    optimal_pwm_z2_pct      SMALLINT    NOT NULL,
    expected_power_w        REAL,
    expected_ppd_pct        REAL,
    expected_co2_kg         REAL,
    pareto_front            JSONB       NOT NULL DEFAULT '[]',
    convergence_history     JSONB,
    run_status              VARCHAR(20) NOT NULL DEFAULT 'completed'
                            CHECK (run_status IN ('running','completed','failed','cancelled')),
    error_message           TEXT,
    notes                   TEXT
);
CREATE INDEX idx_opt_runs_time ON bems_ai.optimization_runs (run_timestamp DESC);
CREATE INDEX idx_opt_runs_algo ON bems_ai.optimization_runs (algorithm, run_timestamp DESC);
CREATE INDEX idx_opt_runs_room ON bems_ai.optimization_runs (room_id, run_timestamp DESC);
CREATE INDEX idx_opt_runs_done ON bems_ai.optimization_runs (room_id, run_timestamp DESC)
    WHERE run_status = 'completed';
COMMENT ON TABLE bems_ai.optimization_runs IS 'Riwayat MOGA/MOPSO: hyperparameter, Pareto front, solusi terpilih';

-- 5.4 Titik Pareto individual
CREATE TABLE bems_ai.pareto_solutions (
    id              BIGSERIAL PRIMARY KEY,
    run_id          BIGINT    NOT NULL REFERENCES bems_ai.optimization_runs(id) ON DELETE CASCADE,
    solution_index  INT       NOT NULL,
    tset_ac_c       REAL      NOT NULL,
    pwm_z1_pct      SMALLINT  NOT NULL,
    pwm_z2_pct      SMALLINT  NOT NULL,
    power_w         REAL      NOT NULL,
    ppd_pct         REAL      NOT NULL,
    co2_kg_day      REAL,
    domination_rank INT       NOT NULL DEFAULT 1,
    crowding_dist   REAL,
    is_selected     BOOLEAN   NOT NULL DEFAULT FALSE,
    UNIQUE (run_id, solution_index)
);
CREATE INDEX idx_pareto_run      ON bems_ai.pareto_solutions (run_id);
CREATE INDEX idx_pareto_selected ON bems_ai.pareto_solutions (run_id, is_selected)
    WHERE is_selected = TRUE;

-- 5.5 Evaluasi batch model (backtesting)
CREATE TABLE bems_ai.model_evaluations (
    id                BIGSERIAL   PRIMARY KEY,
    model_id          INT         NOT NULL REFERENCES bems_ai.model_registry(id),
    evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eval_period_start DATE        NOT NULL,
    eval_period_end   DATE        NOT NULL,
    metric_type       VARCHAR(60) NOT NULL,
    mae               REAL,
    rmse              REAL,
    mape_pct          REAL,
    r2_score          REAL,
    sample_count      INT,
    notes             TEXT
);

-- 5.6 Feature vector per inferensi (explainability)
CREATE TABLE bems_ai.inference_inputs (
    id                BIGSERIAL   PRIMARY KEY,
    forecast_id       BIGINT      NOT NULL REFERENCES bems_ai.forecast_records(id) ON DELETE CASCADE,
    feature_vector    JSONB       NOT NULL,
    lookback_window_h REAL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. BEMS_CONTROL -- AKTUASI MQTT & SESSION KONTROL
-- ============================================================================
CREATE TABLE bems_control.actuation_logs (
    id                   BIGSERIAL    PRIMARY KEY,
    actuation_time       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    device_id            INT          NOT NULL REFERENCES bems_core.devices(id),
    room_id              INT          NOT NULL REFERENCES bems_core.rooms(id),
    control_mode         VARCHAR(30)  NOT NULL
                         CHECK (control_mode IN ('manual','scheduled','moga_dispatch','mopso_dispatch','rule_based')),
    optimization_run_id  BIGINT       REFERENCES bems_ai.optimization_runs(id),
    initiated_by         INT          REFERENCES bems_core.users(id),
    command_type         VARCHAR(30)  NOT NULL
                         CHECK (command_type IN ('SET_TEMP_AC','SET_PWM_Z1','SET_PWM_Z2','SET_MODE_AC','POWER_ON','POWER_OFF')),
    command_value        REAL         NOT NULL,
    command_unit         VARCHAR(10)  NOT NULL DEFAULT 'C',
    mqtt_topic           VARCHAR(255) NOT NULL,
    mqtt_payload         JSONB        NOT NULL,
    safety_gate_passed   BOOLEAN      NOT NULL DEFAULT TRUE,
    safety_rules_applied VARCHAR(200),
    actuation_status     VARCHAR(20)  NOT NULL DEFAULT 'published'
                         CHECK (actuation_status IN ('published','acknowledged','failed','blocked_safety')),
    ack_received_at      TIMESTAMPTZ,
    round_trip_ms        INT,
    error_message        TEXT
);
CREATE INDEX idx_act_time   ON bems_control.actuation_logs (actuation_time DESC);
CREATE INDEX idx_act_device ON bems_control.actuation_logs (device_id, actuation_time DESC);
CREATE INDEX idx_act_room   ON bems_control.actuation_logs (room_id, actuation_time DESC);
COMMENT ON TABLE bems_control.actuation_logs IS 'Perintah MQTT ke aktuator (AC/dimmer) dengan safety gate';

CREATE TABLE bems_control.operation_sessions (
    id                  BIGSERIAL    PRIMARY KEY,
    room_id             INT          NOT NULL REFERENCES bems_core.rooms(id),
    session_name        VARCHAR(100) NOT NULL,
    mode                VARCHAR(30)  NOT NULL
                        CHECK (mode IN ('scheduled','experiment_moga','experiment_mopso','manual','holiday','maintenance')),
    start_time          TIMESTAMPTZ  NOT NULL,
    end_time            TIMESTAMPTZ,
    schedule_config     JSONB        NOT NULL DEFAULT '{}',
    optimization_run_id BIGINT       REFERENCES bems_ai.optimization_runs(id),
    created_by          INT          REFERENCES bems_core.users(id),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    notes               TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE bems_control.safety_rules (
    id         SERIAL       PRIMARY KEY,
    rule_code  VARCHAR(50)  UNIQUE NOT NULL,
    rule_name  VARCHAR(150) NOT NULL,
    rule_logic TEXT         NOT NULL,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
    priority   SMALLINT     NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 7. BEMS_AUDIT -- AUDIT TRAIL
-- ============================================================================
CREATE TABLE bems_audit.change_log (
    id           BIGSERIAL   PRIMARY KEY,
    logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id      INT         REFERENCES bems_core.users(id),
    action       VARCHAR(30) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT')),
    table_schema VARCHAR(50) NOT NULL,
    table_name   VARCHAR(80) NOT NULL,
    record_id    TEXT,
    old_values   JSONB,
    new_values   JSONB,
    client_ip    INET,
    session_id   UUID
);
CREATE INDEX idx_audit_time  ON bems_audit.change_log (logged_at DESC);
CREATE INDEX idx_audit_user  ON bems_audit.change_log (user_id, logged_at DESC);
CREATE INDEX idx_audit_table ON bems_audit.change_log (table_schema, table_name, logged_at DESC);
COMMENT ON TABLE bems_audit.change_log IS 'Audit trail perubahan data kritis & event autentikasi';

-- ============================================================================
-- 8. TIMESCALEDB HYPERTABLES (graceful fallback jika tidak terinstall)
-- ============================================================================
DO 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('bems_telemetry.sht31_readings','time',
            if_not_exists=>TRUE, chunk_time_interval=>INTERVAL '1 day');
        PERFORM create_hypertable('bems_telemetry.nnzn_weather','time',
            if_not_exists=>TRUE, chunk_time_interval=>INTERVAL '1 day');
        PERFORM create_hypertable('bems_telemetry.pzem_readings','time',
            if_not_exists=>TRUE, chunk_time_interval=>INTERVAL '1 day');
        PERFORM create_hypertable('bems_telemetry.occupancy','time',
            if_not_exists=>TRUE, chunk_time_interval=>INTERVAL '7 days');
        PERFORM create_hypertable('bems_telemetry.mqtt_raw_log','received_at',
            if_not_exists=>TRUE, chunk_time_interval=>INTERVAL '1 day');

        ALTER TABLE bems_telemetry.pzem_readings SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'device_id,channel_id',
            timescaledb.compress_orderby = 'time DESC');
        PERFORM add_compression_policy('bems_telemetry.pzem_readings',INTERVAL '7 days',if_not_exists=>TRUE);

        ALTER TABLE bems_telemetry.sht31_readings SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'workstation_id',
            timescaledb.compress_orderby = 'time DESC');
        PERFORM add_compression_policy('bems_telemetry.sht31_readings',INTERVAL '7 days',if_not_exists=>TRUE);

        ALTER TABLE bems_telemetry.nnzn_weather SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'device_id',
            timescaledb.compress_orderby = 'time DESC');
        PERFORM add_compression_policy('bems_telemetry.nnzn_weather',INTERVAL '7 days',if_not_exists=>TRUE);

        ALTER TABLE bems_telemetry.mqtt_raw_log SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'mqtt_topic',
            timescaledb.compress_orderby = 'received_at DESC');
        PERFORM add_compression_policy('bems_telemetry.mqtt_raw_log',INTERVAL '3 days',if_not_exists=>TRUE);

        RAISE NOTICE 'TimescaleDB hypertables & compression configured.';
    ELSE
        RAISE NOTICE 'TimescaleDB not found -- standard PostgreSQL tables used.';
    END IF;
END ;

-- ============================================================================
-- 9. VIEWS DASHBOARD
-- ============================================================================

-- 9.1 SHT31 terbaru per workstation
CREATE OR REPLACE VIEW bems_telemetry.v_sht31_latest AS
SELECT DISTINCT ON (workstation_id)
    s.workstation_id, w.code AS node_code, w.label AS node_label, w.zone_name,
    s.time AS last_reading,
    s.air_temperature, s.relative_humidity,
    s.lux_level, s.co2_ppm,
    s.fanger_pmv, s.fanger_ppd, s.operative_temp,
    EXTRACT(EPOCH FROM (NOW() - s.time)) AS age_seconds
FROM bems_telemetry.sht31_readings s
JOIN bems_core.workstations w ON w.id = s.workstation_id
ORDER BY workstation_id, s.time DESC;

-- 9.2 Cuaca outdoor terkini
CREATE OR REPLACE VIEW bems_telemetry.v_nnzn_latest AS
SELECT DISTINCT ON (device_id)
    n.device_id, d.device_code, n.time AS last_reading,
    n.outdoor_temp_c, n.outdoor_rh_pct, n.solar_irradiance, n.outdoor_lux,
    n.wind_speed_ms, n.co2_outdoor_ppm, n.airflow_speed_ms,
    n.lux_wb1, n.lux_wb2, n.lux_wb3, n.lux_wb4,
    EXTRACT(EPOCH FROM (NOW() - n.time)) AS age_seconds
FROM bems_telemetry.nnzn_weather n
JOIN bems_core.devices d ON d.id = n.device_id
ORDER BY device_id, n.time DESC;

-- 9.3 PZEM terbaru per channel
CREATE OR REPLACE VIEW bems_telemetry.v_pzem_latest AS
SELECT DISTINCT ON (channel_id)
    channel_id, channel_label, time AS last_reading,
    voltage_v, current_a, active_power_w,
    power_factor, energy_kwh, delta_kwh, cost_idr, co2_kg,
    EXTRACT(EPOCH FROM (NOW() - time)) AS age_seconds
FROM bems_telemetry.pzem_readings
ORDER BY channel_id, time DESC;

-- 9.4 Daya per jam (live dari telemetri)
CREATE OR REPLACE VIEW bems_energy.v_hourly_power AS
SELECT
    date_trunc('hour', time) AS hour_bucket,
    channel_id, channel_label,
    ROUND(AVG(active_power_w)::numeric, 1)         AS avg_power_w,
    ROUND(MAX(active_power_w)::numeric, 1)         AS peak_power_w,
    ROUND(SUM(COALESCE(delta_kwh,0))::numeric, 4)  AS energy_kwh,
    ROUND(AVG(voltage_v)::numeric, 1)              AS avg_voltage,
    ROUND(AVG(power_factor)::numeric, 3)           AS avg_pf,
    COUNT(*)                                       AS sample_count
FROM bems_telemetry.pzem_readings
GROUP BY date_trunc('hour', time), channel_id, channel_label;

-- 9.5 Kenyamanan per jam
CREATE OR REPLACE VIEW bems_telemetry.v_comfort_hourly AS
SELECT
    date_trunc('hour', time) AS hour_bucket, workstation_id,
    ROUND(AVG(air_temperature)::numeric, 2)  AS avg_temp_c,
    ROUND(AVG(relative_humidity)::numeric, 1) AS avg_rh_pct,
    ROUND(AVG(mean_radiant_temp)::numeric, 2) AS avg_mrt_c,
    ROUND(AVG(operative_temp)::numeric, 2)   AS avg_top_c,
    ROUND(AVG(fanger_pmv)::numeric, 3)       AS avg_pmv,
    ROUND(AVG(fanger_ppd)::numeric, 1)       AS avg_ppd,
    ROUND(AVG(lux_level)::numeric, 0)        AS avg_lux,
    ROUND(AVG(co2_ppm)::numeric, 0)          AS avg_co2_ppm,
    COUNT(*)                                 AS sample_count
FROM bems_telemetry.sht31_readings
GROUP BY date_trunc('hour', time), workstation_id;

-- 9.6 Performa model 7 hari terakhir
CREATE OR REPLACE VIEW bems_ai.v_model_performance_7d AS
SELECT
    r.model_id, m.model_name, r.metric_type, COUNT(*) AS n_samples,
    ROUND(AVG(ABS(r.actual_value - r.predicted_value))::numeric, 3) AS mae,
    ROUND(SQRT(AVG(POWER(r.actual_value - r.predicted_value, 2)))::numeric, 3) AS rmse,
    ROUND(AVG(ABS((r.actual_value - r.predicted_value) / NULLIF(r.actual_value,0)) * 100)::numeric, 2) AS mape_pct
FROM bems_ai.forecast_records r
JOIN bems_ai.model_registry m ON m.id = r.model_id
WHERE r.actual_value IS NOT NULL
  AND r.target_time >= NOW() - INTERVAL '7 days'
GROUP BY r.model_id, m.model_name, r.metric_type;

-- 9.7 Komparasi MOGA vs MOPSO (30 hari)
CREATE OR REPLACE VIEW bems_ai.v_optimization_comparison AS
SELECT
    algorithm, COUNT(*) AS total_runs,
    ROUND(AVG(expected_power_w)::numeric, 1)       AS avg_expected_power_w,
    ROUND(AVG(expected_ppd_pct)::numeric, 2)       AS avg_expected_ppd_pct,
    ROUND(AVG(pareto_solutions_count)::numeric, 1) AS avg_pareto_size,
    ROUND(AVG(hypervolume_metric)::numeric, 4)     AS avg_hypervolume,
    ROUND(AVG(execution_time_ms)::numeric, 0)      AS avg_exec_ms
FROM bems_ai.optimization_runs
WHERE run_status = 'completed'
  AND run_timestamp >= NOW() - INTERVAL '30 days'
GROUP BY algorithm;

-- ============================================================================
-- 10. FUNGSI UTILITAS -- PMV / PPD (ISO 7730 Fanger)
-- ============================================================================
CREATE OR REPLACE FUNCTION bems_core.calc_pmv(
    ta  REAL, tr  REAL, va  REAL, rh  REAL,
    met REAL DEFAULT 1.2,
    clo REAL DEFAULT 0.5
) RETURNS REAL LANGUAGE plpgsql IMMUTABLE AS
\$\$
DECLARE
    pa REAL; icl REAL; m REAL; fcl REAL; tcl REAL;
    hcn REAL; hc REAL;
    hl1 REAL; hl2 REAL; hl3 REAL; hl4 REAL; hl5 REAL; hl6 REAL;
    ts REAL; pmv REAL;
BEGIN
    pa  := rh * 10.0 * EXP(16.6536 - 4030.183 / (ta + 235.0));
    icl := 0.155 * clo;
    m   := met * 58.15;
    IF clo < 0.5 THEN fcl := 1.0 + 0.2 * icl;
    ELSE              fcl := 1.05 + 0.1 * icl; END IF;
    tcl := ta + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
    hcn := 2.38 * POWER(ABS(tcl - ta), 0.25);
    hc  := GREATEST(hcn, 12.1 * SQRT(va));
    hl1 := 3.05e-3 * (5733.0 - 6.99 * m - pa);
    hl2 := GREATEST(0.0, 0.42 * (m - 58.15));
    hl3 := 1.7e-5  * m * (5867.0 - pa);
    hl4 := 0.0014  * m * (34.0 - ta);
    hl5 := 3.96e-8 * fcl * (POWER(tcl + 273.0, 4) - POWER(tr + 273.0, 4));
    hl6 := fcl * hc * (tcl - ta);
    ts  := 0.303 * EXP(-0.036 * m) + 0.028;
    pmv := ts * (m - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
    RETURN ROUND(pmv::numeric, 3)::real;
END;
\$\$;
COMMENT ON FUNCTION bems_core.calc_pmv IS 'ISO 7730 PMV Fanger';

CREATE OR REPLACE FUNCTION bems_core.calc_ppd(pmv REAL)
RETURNS REAL LANGUAGE sql IMMUTABLE AS
\$\$
    SELECT ROUND(
        LEAST(100.0, 100.0 - 95.0 * EXP(-0.03353 * POWER(pmv,4) - 0.2179 * POWER(pmv,2)))
        ::numeric, 1
    )::real;
\$\$;
COMMENT ON FUNCTION bems_core.calc_ppd IS 'ISO 7730 Annex B -- PPD (%) dari PMV';

-- ============================================================================
-- 11. SEED DATA AWAL
-- ============================================================================
INSERT INTO bems_core.users (username, email, password_hash, full_name, role) VALUES
('admin',      'admin@livinglab.uns.ac.id',      crypt('admin123',gen_salt('bf')),     'Super Administrator BEMS','superadmin'),
('researcher', 'researcher@livinglab.uns.ac.id', crypt('research123',gen_salt('bf')), 'Tim Riset Living Lab FT', 'researcher'),
('operator',   'operator@livinglab.uns.ac.id',   crypt('operator2024',gen_salt('bf')),'Operator Lab BEMS',       'operator')
ON CONFLICT (username) DO NOTHING;

INSERT INTO bems_core.buildings (code, name, address, latitude, longitude)
VALUES ('FT_UNS_B2','Gedung B2 Fakultas Teknik UNS',
        'Jl. Ir. Sutami 36A, Kentingan, Surakarta', -7.5594, 110.8595)
ON CONFLICT (code) DO NOTHING;

INSERT INTO bems_core.rooms (building_id, code, name, floor_level, area_sqm, height_m, max_occupancy)
SELECT b.id,'SMART_ROOM_01','BEMS Living Lab - IoT Smart Room',2,72.00,3.20,30
FROM bems_core.buildings b WHERE b.code='FT_UNS_B2'
ON CONFLICT (code) DO NOTHING;

INSERT INTO bems_core.workstations
    (room_id, code, label, legacy_alias, zone_name, ip_address, coord_x_m, coord_y_m, description)
SELECT r.id, w.code, w.lbl, w.legacy, w.zone, w.ip::inet, w.x::real, w.y::real, w.descr
FROM bems_core.rooms r,
(VALUES
    ('sht-1','SHT-1 (Window WB1)','G','Window (WB1)','10.18.13.181','2.0','1.5','Jendela fasad timur'),
    ('sht-2','SHT-2 (Middle WB2)','C','Middle (WB2)','10.18.13.154','2.0','6.0','Workstation komputasi NW'),
    ('sht-3','SHT-3 (Inner WB3)','A','Inner (WB3)','10.18.13.202','5.0','1.5','Zona tengah referensi'),
    ('sht-4','SHT-4 (Right WB4)','D','Right (WB4)','10.18.13.204','8.0','1.0','Dekat pintu'),
    ('sht-5','SHT-5 (South Wall)','H','South Wall','10.18.13.208','5.0','7.5','Bawah hembusan AC'),
    ('sht-6','SHT-6 (South Hub)','E','South Hub','10.18.13.209','8.0','7.0','Dekat rak server')
) AS w(code,lbl,legacy,zone,ip,x,y,descr)
WHERE r.code='SMART_ROOM_01'
ON CONFLICT (code) DO NOTHING;

INSERT INTO bems_core.devices
    (room_id, device_code, device_type, model_name, manufacturer, mqtt_sub_topic, mqtt_pub_topic, ip_or_bus_addr)
SELECT r.id, d.code, d.dtype, d.model, d.mfr, d.sub_t, d.pub_t, d.addr
FROM bems_core.rooms r,
(VALUES
    ('PZEM_CH1_AC','pzem_meter','PZEM-004T v3.0 Ch1 AC','Peacefair','bems/pzem/ch1/telemetry',NULL,'RS485:1'),
    ('PZEM_CH2_SOCKET','pzem_meter','PZEM-004T v3.0 Ch2 Socket','Peacefair','bems/pzem/ch2/telemetry',NULL,'RS485:2'),
    ('PZEM_CH3_LAMP','pzem_meter','PZEM-004T v3.0 Ch3 Lamp','Peacefair','bems/pzem/ch3/telemetry',NULL,'RS485:3'),
    ('NNZN_WEATHER','weather_station','NNZN RS485 Multi-Sensor','NNZN','nnzn-weather/sensor/+/state',NULL,'128.199.206.166'),
    ('AC_DAIKIN','ac_inverter','Daikin Inverter Split 2PK','Daikin','bems/ac/status','bems/ac/cmd',NULL),
    ('DIMMER_Z1','lighting_dimmer','Dimmer PWM Zona 1','Custom','bems/light/z1/status','bems/light/z1/cmd',NULL),
    ('DIMMER_Z2','lighting_dimmer','Dimmer PWM Zona 2','Custom','bems/light/z2/status','bems/light/z2/cmd',NULL),
    ('RADAR_MMWAVE_01','radar_occupancy','Seeed mmWave Radar 24GHz','Seeed','bems/occupancy/radar01/state',NULL,'10.18.13.220')
) AS d(code,dtype,model,mfr,sub_t,pub_t,addr)
WHERE r.code='SMART_ROOM_01'
ON CONFLICT (device_code) DO NOTHING;

INSERT INTO bems_energy.tarif_history (effective_date, tarif_kwh_idr, tarif_class, source_ref)
VALUES ('2024-01-01',1444.70,'I3/TM','Kepmen ESDM No. 2 Thn 2024')
ON CONFLICT DO NOTHING;

INSERT INTO bems_control.safety_rules (rule_code, rule_name, rule_logic) VALUES
('MIN_COMPRESSOR_DELAY','Min Compressor Restart Delay','Jeda minimal 3 menit antara dua perintah ON AC'),
('TEMP_RANGE_GUARD','AC Setpoint Range Guard','Setpoint AC harus dalam range 18-30 C'),
('CO2_VENTILATION','CO2 Ventilation Override','CO2 > 1000 ppm -> ventilasi paksa aktif'),
('OCCUPANCY_SETBACK','Occupancy Setback Mode','Headcount=0 selama 30 menit -> setpoint hemat energi')
ON CONFLICT DO NOTHING;

INSERT INTO bems_ai.model_registry
    (model_name, model_type, target_variable, input_features, hyperparameters, metrics, is_active, notes)
VALUES
(
    'Bi-LSTM-Energy-v1.0','BiLSTM','electrical_load_w',
    '["outdoor_temp_c","solar_irradiance","occupancy_count","hour_of_day","day_of_week","lag_1h","lag_24h"]',
    '{"units":128,"dropout":0.2,"lookback_h":24,"batch_size":32,"epochs":100}',
    '{"mae":48.3,"rmse":71.2,"mape":6.2,"r2":0.941}',
    TRUE,
    'Prediksi beban listrik total (AC+Socket+Lamp). Dataset Sep2025-Sep2026.'
),
(
    'TFT-Temp-v1.0','TFT','indoor_temp_c',
    '["outdoor_temp_c","solar_irradiance","ac_setpoint","hour_of_day","occupancy_count"]',
    '{"num_heads":4,"hidden_size":64,"dropout":0.1,"lookback_h":12,"batch_size":64}',
    '{"mae":0.31,"rmse":0.48,"mape":1.3,"r2":0.978}',
    TRUE,
    'TFT prediksi suhu indoor 1 jam ke depan dengan 95% confidence interval.'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SELESAI -- BEMS PostgreSQL Schema v2.0.0
-- Gunakan: psql -U postgres -d bems_db -f bems_schema_postgresql.sql
-- ============================================================================
