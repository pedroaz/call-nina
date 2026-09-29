import { migrateAttemptEvidence } from "./attempt-evidence.js";
import { migrateVersionedContent } from "./content.js";
import type { DataRootGeneration } from "@call-nina/contracts";

import { openDataRootDatabase, type DatabaseMigration } from "./sqlite.js";

export const callNinaMigrations = [
  {
    version: 1,
    name: "learner-settings-model-preferences",
    sql: `
      CREATE TABLE learner_profiles (
        learner_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
        current_level TEXT NOT NULL CHECK (current_level IN ('a1', 'a2', 'b1', 'b2')),
        target_level TEXT NOT NULL CHECK (target_level IN ('a1', 'a2', 'b1', 'b2')),
        level_basis TEXT NOT NULL CHECK (level_basis IN ('self-reported', 'diagnostic', 'inferred')),
        optional_diagnostic_completed_on TEXT,
        level_updated_at TEXT NOT NULL CHECK (level_updated_at GLOB '????-??-??T??:??:??.???Z'),
        everyday_germany_goal TEXT NOT NULL CHECK (length(everyday_germany_goal) BETWEEN 1 AND 500),
        motivation TEXT NOT NULL CHECK (length(motivation) BETWEEN 1 AND 500),
        available_study_minutes_per_week INTEGER NOT NULL
          CHECK (available_study_minutes_per_week BETWEEN 15 AND 10080),
        onboarding_state TEXT NOT NULL CHECK (onboarding_state IN ('not-started', 'in-progress', 'complete')),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        CHECK (
          (level_basis = 'diagnostic' AND optional_diagnostic_completed_on IS NOT NULL AND
            optional_diagnostic_completed_on GLOB '????-??-??') OR
          (level_basis <> 'diagnostic' AND (
            optional_diagnostic_completed_on IS NULL OR
            (optional_diagnostic_completed_on IS NOT NULL AND
              optional_diagnostic_completed_on GLOB '????-??-??')
          ))
        )
      ) STRICT;

      CREATE TABLE learner_settings (
        learner_id TEXT PRIMARY KEY REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
        ui_locale TEXT NOT NULL DEFAULT 'en' CHECK (ui_locale IN ('en', 'de')),
        teaching_language TEXT NOT NULL CHECK (teaching_language IN ('en', 'de')),
        correction_timing TEXT NOT NULL
          CHECK (correction_timing IN ('immediate', 'end-of-activity', 'adaptive')),
        correction_coverage TEXT NOT NULL
          CHECK (correction_coverage IN ('priority-only', 'all-meaningful')),
        show_concise_explanation INTEGER NOT NULL CHECK (show_concise_explanation IN (0, 1)),
        show_natural_alternative INTEGER NOT NULL CHECK (show_natural_alternative IN (0, 1)),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TABLE learner_interests (
        learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
        value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 80),
        PRIMARY KEY (learner_id, position)
      ) STRICT;

      CREATE TABLE learner_preferred_topics (
        learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
        value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 120),
        PRIMARY KEY (learner_id, position)
      ) STRICT;

      CREATE TABLE learner_profile_insights (
        learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
        insight_group TEXT NOT NULL CHECK (insight_group IN ('strength', 'weakness')),
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
        curriculum_topic_id TEXT,
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
        note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        source TEXT NOT NULL CHECK (source IN ('inferred', 'learner')),
        learner_edited INTEGER NOT NULL CHECK (learner_edited IN (0, 1)),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (learner_id, insight_group, position)
      ) STRICT;

      CREATE TABLE model_preference_defaults (
        workload TEXT PRIMARY KEY CHECK (workload IN ('correction', 'generation', 'helper', 'research')),
        source TEXT NOT NULL DEFAULT 'repository-default' CHECK (source = 'repository-default'),
        model_mode TEXT NOT NULL CHECK (model_mode IN ('automatic', 'exact')),
        model_id TEXT,
        effort_mode TEXT NOT NULL CHECK (effort_mode IN ('semantic', 'exact')),
        semantic_effort TEXT,
        effort_id TEXT,
        CHECK (
          (model_mode = 'automatic' AND model_id IS NULL) OR
          (model_mode = 'exact' AND model_id IS NOT NULL AND length(model_id) BETWEEN 1 AND 128)
        ),
        CHECK (
          (effort_mode = 'semantic' AND semantic_effort IS NOT NULL AND
            semantic_effort IN ('fast', 'balanced', 'deep') AND effort_id IS NULL) OR
          (effort_mode = 'exact' AND semantic_effort IS NULL AND effort_id IS NOT NULL AND
            length(effort_id) BETWEEN 1 AND 64)
        )
      ) STRICT;

      INSERT INTO model_preference_defaults
        (workload, model_mode, effort_mode, semantic_effort)
      VALUES
        ('correction', 'automatic', 'semantic', 'balanced'),
        ('generation', 'automatic', 'semantic', 'balanced'),
        ('helper', 'automatic', 'semantic', 'fast'),
        ('research', 'automatic', 'semantic', 'deep');

      CREATE TRIGGER model_preference_defaults_immutable_update
      BEFORE UPDATE ON model_preference_defaults
      BEGIN
        SELECT RAISE(ABORT, 'OD_MODEL_DEFAULT_IMMUTABLE');
      END;

      CREATE TRIGGER model_preference_defaults_immutable_delete
      BEFORE DELETE ON model_preference_defaults
      BEGIN
        SELECT RAISE(ABORT, 'OD_MODEL_DEFAULT_IMMUTABLE');
      END;

      CREATE TABLE model_preference_overrides (
        learner_id TEXT NOT NULL REFERENCES learner_profiles(learner_id) ON DELETE CASCADE,
        workload TEXT NOT NULL CHECK (workload IN ('correction', 'generation', 'helper', 'research')),
        model_mode TEXT NOT NULL CHECK (model_mode IN ('automatic', 'exact')),
        model_id TEXT,
        effort_mode TEXT NOT NULL CHECK (effort_mode IN ('semantic', 'exact')),
        semantic_effort TEXT,
        effort_id TEXT,
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (learner_id, workload),
        CHECK (
          (model_mode = 'automatic' AND model_id IS NULL) OR
          (model_mode = 'exact' AND model_id IS NOT NULL AND length(model_id) BETWEEN 1 AND 128)
        ),
        CHECK (
          (effort_mode = 'semantic' AND semantic_effort IS NOT NULL AND
            semantic_effort IN ('fast', 'balanced', 'deep') AND effort_id IS NULL) OR
          (effort_mode = 'exact' AND semantic_effort IS NULL AND effort_id IS NOT NULL AND
            length(effort_id) BETWEEN 1 AND 64)
        )
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "started-lessons-exercises-attempts-answers",
    sql: `
      CREATE TABLE lessons (
        activity_id TEXT PRIMARY KEY,
        lifecycle TEXT NOT NULL DEFAULT 'started' CHECK (lifecycle = 'started'),
        kind TEXT NOT NULL CHECK (kind IN ('custom', 'curriculum-topic', 'vocabulary-set')),
        cefr_band TEXT NOT NULL CHECK (cefr_band IN ('a1', 'a2', 'b1', 'b2')),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        started_at TEXT NOT NULL CHECK (started_at GLOB '????-??-??T??:??:??.???Z'),
        objectives_json TEXT NOT NULL CHECK (json_valid(objectives_json)),
        explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 4000),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        intent_json TEXT NOT NULL CHECK (json_valid(intent_json)),
        ai_provenance_json TEXT NOT NULL CHECK (json_valid(ai_provenance_json)),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
      ) STRICT;

      CREATE TRIGGER lessons_snapshot_immutable
      BEFORE UPDATE OF snapshot_json, objectives_json, explanation, content_json, intent_json
      ON lessons
      BEGIN
        SELECT RAISE(ABORT, 'OD_LESSON_SNAPSHOT_IMMUTABLE');
      END;

      CREATE TABLE exercises (
        exercise_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        lesson_activity_id TEXT REFERENCES lessons(activity_id) ON DELETE SET NULL,
        lifecycle TEXT NOT NULL DEFAULT 'started' CHECK (lifecycle = 'started'),
        kind TEXT NOT NULL CHECK (kind IN (
          'free-writing', 'short-answer', 'fill-in-the-blank',
          'sentence-correction', 'multiple-choice', 'vocabulary-recall'
        )),
        cefr_band TEXT NOT NULL CHECK (cefr_band IN ('a1', 'a2', 'b1', 'b2')),
        started_at TEXT NOT NULL CHECK (started_at GLOB '????-??-??T??:??:??.???Z'),
        objectives_json TEXT NOT NULL CHECK (json_valid(objectives_json)),
        instructions TEXT NOT NULL CHECK (length(instructions) BETWEEN 1 AND 4000),
        explanation TEXT CHECK (explanation IS NULL OR length(explanation) BETWEEN 1 AND 4000),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        answer_contract_json TEXT NOT NULL CHECK (json_valid(answer_contract_json)),
        ai_provenance_json TEXT NOT NULL CHECK (json_valid(ai_provenance_json)),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
      ) STRICT;

      CREATE INDEX exercises_by_activity ON exercises(activity_id);
      CREATE INDEX exercises_by_lesson ON exercises(lesson_activity_id);

      CREATE TRIGGER exercises_snapshot_immutable
      BEFORE UPDATE OF snapshot_json, objectives_json, instructions, explanation, content_json,
        answer_contract_json, ai_provenance_json
      ON exercises
      BEGIN
        SELECT RAISE(ABORT, 'OD_EXERCISE_SNAPSHOT_IMMUTABLE');
      END;

      CREATE TABLE attempts (
        attempt_id TEXT PRIMARY KEY,
        exercise_id TEXT NOT NULL REFERENCES exercises(exercise_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed', 'abandoned')),
        started_at TEXT NOT NULL CHECK (started_at GLOB '????-??-??T??:??:??.???Z'),
        exercise_snapshot_json TEXT NOT NULL CHECK (json_valid(exercise_snapshot_json)),
        terminal_after_previous_event_ms INTEGER
          CHECK (terminal_after_previous_event_ms IS NULL OR terminal_after_previous_event_ms >= 0),
        objective_evaluations_json TEXT CHECK (
          objective_evaluations_json IS NULL OR json_valid(objective_evaluations_json)
        ),
        feedback_json TEXT CHECK (feedback_json IS NULL OR json_valid(feedback_json)),
        CHECK (
          (status = 'in-progress' AND terminal_after_previous_event_ms IS NULL AND
            objective_evaluations_json IS NULL AND feedback_json IS NULL) OR
          (status = 'completed' AND terminal_after_previous_event_ms IS NOT NULL AND
            objective_evaluations_json IS NOT NULL AND feedback_json IS NOT NULL) OR
          (status = 'abandoned' AND terminal_after_previous_event_ms IS NOT NULL AND
            objective_evaluations_json IS NULL AND feedback_json IS NULL)
        )
      ) STRICT;

      CREATE INDEX attempts_by_exercise_started ON attempts(exercise_id, started_at);

      CREATE TRIGGER attempts_must_start_in_progress
      BEFORE INSERT ON attempts
      WHEN NEW.status <> 'in-progress'
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_MUST_START_IN_PROGRESS');
      END;

      CREATE TRIGGER attempts_exercise_snapshot_immutable
      BEFORE UPDATE OF exercise_snapshot_json, exercise_id, started_at
      ON attempts
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_SNAPSHOT_IMMUTABLE');
      END;

      CREATE TRIGGER attempts_terminal_immutable
      BEFORE UPDATE ON attempts
      WHEN OLD.status <> 'in-progress'
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_TERMINAL_IMMUTABLE');
      END;

      CREATE TRIGGER attempts_completion_requires_answer
      BEFORE UPDATE OF status ON attempts
      WHEN NEW.status = 'completed' AND NOT EXISTS (
        SELECT 1 FROM answers WHERE attempt_id = OLD.attempt_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_COMPLETION_REQUIRES_ANSWER');
      END;

      CREATE TABLE answers (
        attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 99),
        submitted_after_previous_event_ms INTEGER NOT NULL
          CHECK (submitted_after_previous_event_ms >= 0),
        answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
        PRIMARY KEY (attempt_id, position)
      ) STRICT;

      CREATE TRIGGER answers_immutable
      BEFORE UPDATE ON answers
      BEGIN
        SELECT RAISE(ABORT, 'OD_ANSWER_IMMUTABLE');
      END;

      CREATE TRIGGER answers_delete_immutable
      BEFORE DELETE ON answers
      WHEN NOT EXISTS (
        SELECT 1 FROM attempt_deletions WHERE attempt_id = OLD.attempt_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_ANSWER_IMMUTABLE');
      END;

      CREATE TRIGGER answers_require_in_progress_attempt
      BEFORE INSERT ON answers
      WHEN NOT EXISTS (
        SELECT 1 FROM attempts
        WHERE attempt_id = NEW.attempt_id AND status = 'in-progress'
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_ANSWER_ATTEMPT_NOT_IN_PROGRESS');
      END;
    `,
  },
  {
    version: 3,
    name: "corrections-changes-mistakes",
    sql: `
      CREATE TABLE corrections (
        correction_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'final')),
        original_text TEXT CHECK (original_text IS NULL OR length(original_text) BETWEEN 1 AND 12000),
        corrected_text TEXT CHECK (corrected_text IS NULL OR length(corrected_text) BETWEEN 1 AND 12000),
        ai_provenance_json TEXT NOT NULL CHECK (json_valid(ai_provenance_json)),
        natural_alternative_json TEXT NOT NULL CHECK (json_valid(natural_alternative_json)),
        follow_up_json TEXT NOT NULL CHECK (json_valid(follow_up_json)),
        overall_uncertainty_json TEXT NOT NULL CHECK (json_valid(overall_uncertainty_json)),
        CHECK (
          (state = 'draft' AND original_text IS NULL AND corrected_text IS NULL) OR
          (state = 'final' AND original_text IS NOT NULL AND corrected_text IS NOT NULL)
        ),
        UNIQUE (correction_id, attempt_id)
      ) STRICT;

      CREATE INDEX corrections_by_attempt ON corrections(attempt_id, created_at);

      CREATE TRIGGER corrections_must_start_draft
      BEFORE INSERT ON corrections
      WHEN NEW.state <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_MUST_START_DRAFT');
      END;

      CREATE TABLE correction_changes (
        correction_id TEXT NOT NULL REFERENCES corrections(correction_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 499),
        kind TEXT NOT NULL CHECK (kind IN ('unchanged', 'replacement', 'insertion', 'deletion')),
        original_text TEXT NOT NULL CHECK (length(original_text) <= 12000),
        corrected_text TEXT NOT NULL CHECK (length(corrected_text) <= 12000),
        category TEXT CHECK (category IS NULL OR category IN (
          'grammar', 'spelling', 'punctuation', 'word-choice',
          'word-order', 'register', 'idiom', 'clarity'
        )),
        severity TEXT CHECK (severity IS NULL OR severity IN ('minor', 'meaning-affecting')),
        priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
        explanation TEXT CHECK (explanation IS NULL OR length(explanation) BETWEEN 1 AND 800),
        grammar_topic_ids_json TEXT CHECK (
          grammar_topic_ids_json IS NULL OR json_valid(grammar_topic_ids_json)
        ),
        uncertainty_json TEXT CHECK (uncertainty_json IS NULL OR json_valid(uncertainty_json)),
        PRIMARY KEY (correction_id, position),
        CHECK (
          (kind = 'unchanged' AND length(original_text) > 0 AND original_text = corrected_text AND
            category IS NULL AND severity IS NULL AND priority IS NULL AND explanation IS NULL AND
            grammar_topic_ids_json IS NULL AND uncertainty_json IS NULL) OR
          (kind = 'replacement' AND length(original_text) > 0 AND length(corrected_text) > 0 AND
            original_text <> corrected_text AND category IS NOT NULL AND severity IS NOT NULL AND
            priority IS NOT NULL AND explanation IS NOT NULL AND grammar_topic_ids_json IS NOT NULL AND
            uncertainty_json IS NOT NULL) OR
          (kind = 'insertion' AND original_text = '' AND length(corrected_text) > 0 AND
            category IS NOT NULL AND severity IS NOT NULL AND priority IS NOT NULL AND
            explanation IS NOT NULL AND grammar_topic_ids_json IS NOT NULL AND uncertainty_json IS NOT NULL) OR
          (kind = 'deletion' AND length(original_text) > 0 AND corrected_text = '' AND
            category IS NOT NULL AND severity IS NOT NULL AND priority IS NOT NULL AND
            explanation IS NOT NULL AND grammar_topic_ids_json IS NOT NULL AND uncertainty_json IS NOT NULL)
        )
      ) STRICT;

      CREATE TRIGGER correction_finalize_valid
      BEFORE UPDATE OF state ON corrections
      WHEN NEW.state = 'final' AND (
        OLD.state <> 'draft' OR
        (SELECT count(*) FROM correction_changes WHERE correction_id = OLD.correction_id) = 0 OR
        (SELECT min(position) FROM correction_changes WHERE correction_id = OLD.correction_id) <> 0 OR
        (SELECT max(position) + 1 FROM correction_changes WHERE correction_id = OLD.correction_id) <>
          (SELECT count(*) FROM correction_changes WHERE correction_id = OLD.correction_id) OR
        NEW.original_text <> (
          SELECT group_concat(original_text, '') FROM (
            SELECT original_text FROM correction_changes
            WHERE correction_id = OLD.correction_id ORDER BY position
          )
        ) OR
        NEW.corrected_text <> (
          SELECT group_concat(corrected_text, '') FROM (
            SELECT corrected_text FROM correction_changes
            WHERE correction_id = OLD.correction_id ORDER BY position
          )
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_ALIGNMENT_INVALID');
      END;

      CREATE TRIGGER corrections_evidence_immutable
      BEFORE UPDATE ON corrections
      WHEN NOT (
        OLD.state = 'draft' AND NEW.state = 'final' AND
        OLD.correction_id = NEW.correction_id AND OLD.attempt_id = NEW.attempt_id AND
        OLD.created_at = NEW.created_at AND OLD.ai_provenance_json = NEW.ai_provenance_json AND
        OLD.natural_alternative_json = NEW.natural_alternative_json AND
        OLD.follow_up_json = NEW.follow_up_json AND
        OLD.overall_uncertainty_json = NEW.overall_uncertainty_json
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_EVIDENCE_IMMUTABLE');
      END;

      CREATE TRIGGER corrections_final_delete_immutable
      BEFORE DELETE ON corrections
      WHEN OLD.state = 'final' AND NOT EXISTS (
        SELECT 1 FROM attempt_deletions WHERE attempt_id = OLD.attempt_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_EVIDENCE_IMMUTABLE');
      END;

      CREATE TRIGGER correction_changes_final_insert_immutable
      BEFORE INSERT ON correction_changes
      WHEN EXISTS (
        SELECT 1 FROM corrections WHERE correction_id = NEW.correction_id AND state = 'final'
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_CHANGE_IMMUTABLE');
      END;

      CREATE TRIGGER correction_changes_final_update_immutable
      BEFORE UPDATE ON correction_changes
      WHEN EXISTS (
        SELECT 1 FROM corrections WHERE correction_id = OLD.correction_id AND state = 'final'
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_CHANGE_IMMUTABLE');
      END;

      CREATE TRIGGER correction_changes_final_delete_immutable
      BEFORE DELETE ON correction_changes
      WHEN EXISTS (
        SELECT 1 FROM corrections WHERE correction_id = OLD.correction_id AND state = 'final'
      ) AND NOT EXISTS (
        SELECT 1 FROM corrections c JOIN attempt_deletions d ON d.attempt_id = c.attempt_id
        WHERE c.correction_id = OLD.correction_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_CORRECTION_CHANGE_IMMUTABLE');
      END;

      CREATE TABLE mistakes (
        mistake_id TEXT PRIMARY KEY,
        inferred_category_json TEXT NOT NULL CHECK (json_valid(inferred_category_json)),
        effective_category_json TEXT NOT NULL CHECK (json_valid(effective_category_json)),
        classification_source TEXT NOT NULL CHECK (classification_source IN ('inferred', 'learner-amended')),
        learner_amended_at TEXT CHECK (
          learner_amended_at IS NULL OR learner_amended_at GLOB '????-??-??T??:??:??.???Z'
        ),
        learner_amendment_note TEXT CHECK (
          learner_amendment_note IS NULL OR length(learner_amendment_note) BETWEEN 1 AND 500
        ),
        disposition TEXT NOT NULL CHECK (disposition IN ('active', 'dismissed')),
        dismissed_at TEXT CHECK (dismissed_at IS NULL OR dismissed_at GLOB '????-??-??T??:??:??.???Z'),
        dismissal_reason TEXT CHECK (
          dismissal_reason IS NULL OR dismissal_reason IN ('not-a-mistake', 'not-useful', 'duplicate', 'other')
        ),
        targeted_activity_id TEXT,
        targeted_activity_created_at TEXT CHECK (
          targeted_activity_created_at IS NULL OR targeted_activity_created_at GLOB '????-??-??T??:??:??.???Z'
        ),
        CHECK (
          (classification_source = 'inferred' AND learner_amended_at IS NULL AND
            learner_amendment_note IS NULL AND inferred_category_json = effective_category_json) OR
          (classification_source = 'learner-amended' AND learner_amended_at IS NOT NULL AND
            inferred_category_json <> effective_category_json)
        ),
        CHECK (
          (disposition = 'active' AND dismissed_at IS NULL AND dismissal_reason IS NULL) OR
          (disposition = 'dismissed' AND dismissed_at IS NOT NULL AND dismissal_reason IS NOT NULL)
        ),
        CHECK (
          (targeted_activity_id IS NULL AND targeted_activity_created_at IS NULL) OR
          (targeted_activity_id IS NOT NULL AND targeted_activity_created_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE mistake_occurrences (
        mistake_id TEXT NOT NULL REFERENCES mistakes(mistake_id) ON DELETE CASCADE,
        correction_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        alignment_segment_position INTEGER NOT NULL CHECK (alignment_segment_position BETWEEN 0 AND 499),
        observed_on TEXT NOT NULL CHECK (observed_on GLOB '????-??-??'),
        before_context TEXT NOT NULL CHECK (length(before_context) <= 500),
        evidence_text TEXT NOT NULL CHECK (length(evidence_text) BETWEEN 1 AND 1000),
        after_context TEXT NOT NULL CHECK (length(after_context) <= 500),
        explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 800),
        PRIMARY KEY (mistake_id, correction_id, alignment_segment_position),
        FOREIGN KEY (correction_id, attempt_id)
          REFERENCES corrections(correction_id, attempt_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX mistake_occurrences_by_date ON mistake_occurrences(mistake_id, observed_on);

      CREATE TABLE mistake_amendments (
        amendment_id TEXT PRIMARY KEY,
        mistake_id TEXT NOT NULL REFERENCES mistakes(mistake_id) ON DELETE CASCADE,
        previous_category_json TEXT NOT NULL CHECK (json_valid(previous_category_json)),
        amended_category_json TEXT NOT NULL CHECK (json_valid(amended_category_json)),
        note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
        amended_at TEXT NOT NULL CHECK (amended_at GLOB '????-??-??T??:??:??.???Z'),
        CHECK (previous_category_json <> amended_category_json)
      ) STRICT;

      CREATE TABLE mistake_deletions (
        mistake_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL CHECK (deleted_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TRIGGER mistake_deletion_requires_absent_record
      BEFORE INSERT ON mistake_deletions
      WHEN EXISTS (SELECT 1 FROM mistakes WHERE mistake_id = NEW.mistake_id)
      BEGIN
        SELECT RAISE(ABORT, 'OD_MISTAKE_DELETE_REQUIRES_REMOVAL');
      END;

      CREATE TRIGGER deleted_mistake_cannot_reappear
      BEFORE INSERT ON mistakes
      WHEN EXISTS (SELECT 1 FROM mistake_deletions WHERE mistake_id = NEW.mistake_id)
      BEGIN
        SELECT RAISE(ABORT, 'OD_MISTAKE_ALREADY_DELETED');
      END;
    `,
  },
  {
    version: 4,
    name: "vocabulary-and-reviews",
    sql: `
      CREATE TABLE vocabulary_entries (
        vocabulary_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
        lemma TEXT NOT NULL CHECK (length(lemma) BETWEEN 1 AND 160),
        meaning TEXT NOT NULL CHECK (length(meaning) BETWEEN 1 AND 500),
        lexeme_json TEXT NOT NULL CHECK (json_valid(lexeme_json)),
        examples_json TEXT NOT NULL CHECK (json_valid(examples_json)),
        source_json TEXT NOT NULL CHECK (json_valid(source_json)),
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate', 'active', 'suspended')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        confirmed_at TEXT CHECK (
          confirmed_at IS NULL OR confirmed_at GLOB '????-??-??T??:??:??.???Z'
        ),
        due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '????-??-??'),
        stage INTEGER CHECK (stage IS NULL OR stage BETWEEN 1 AND 5),
        last_review_id TEXT,
        last_reviewed_at TEXT CHECK (
          last_reviewed_at IS NULL OR last_reviewed_at GLOB '????-??-??T??:??:??.???Z'
        ),
        last_grade TEXT CHECK (last_grade IS NULL OR last_grade IN ('again', 'hard', 'good', 'easy')),
        suspended_at TEXT CHECK (
          suspended_at IS NULL OR suspended_at GLOB '????-??-??T??:??:??.???Z'
        ),
        suspension_reason TEXT CHECK (
          suspension_reason IS NULL OR
          suspension_reason IN ('learner-paused', 'duplicate', 'not-useful', 'other')
        ),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        CHECK (
          (status = 'candidate' AND revision = 0 AND confirmed_at IS NULL AND due_on IS NULL AND
            stage IS NULL AND last_review_id IS NULL AND last_reviewed_at IS NULL AND
            last_grade IS NULL AND suspended_at IS NULL AND suspension_reason IS NULL) OR
          (status = 'active' AND confirmed_at IS NOT NULL AND due_on IS NOT NULL AND
            stage IS NOT NULL AND suspended_at IS NULL AND suspension_reason IS NULL) OR
          (status = 'suspended' AND confirmed_at IS NOT NULL AND due_on IS NOT NULL AND
            stage IS NOT NULL AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)
        ),
        CHECK (
          (last_review_id IS NULL AND last_reviewed_at IS NULL AND last_grade IS NULL) OR
          (last_review_id IS NOT NULL AND last_reviewed_at IS NOT NULL AND last_grade IS NOT NULL)
        ),
        CHECK (confirmed_at IS NULL OR due_on >= substr(confirmed_at, 1, 10)),
        CHECK (last_reviewed_at IS NULL OR last_reviewed_at >= confirmed_at),
        CHECK (last_reviewed_at IS NULL OR due_on >= substr(last_reviewed_at, 1, 10)),
        CHECK (suspended_at IS NULL OR suspended_at >= confirmed_at),
        CHECK (suspended_at IS NULL OR last_reviewed_at IS NULL OR suspended_at >= last_reviewed_at)
      ) STRICT;

      CREATE INDEX vocabulary_due_active ON vocabulary_entries(status, due_on, vocabulary_id);
      CREATE INDEX vocabulary_by_lemma ON vocabulary_entries(lemma, vocabulary_id);

      CREATE TABLE vocabulary_reviews (
        review_id TEXT PRIMARY KEY,
        vocabulary_id TEXT NOT NULL
          REFERENCES vocabulary_entries(vocabulary_id) ON DELETE CASCADE,
        expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
        reviewed_at TEXT NOT NULL CHECK (reviewed_at GLOB '????-??-??T??:??:??.???Z'),
        grade TEXT NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
        next_due_on TEXT NOT NULL CHECK (next_due_on GLOB '????-??-??'),
        next_stage INTEGER NOT NULL CHECK (next_stage BETWEEN 1 AND 5),
        CHECK (next_due_on >= substr(reviewed_at, 1, 10)),
        UNIQUE (vocabulary_id, expected_revision)
      ) STRICT;

      CREATE TRIGGER vocabulary_review_requires_current_active_state
      BEFORE INSERT ON vocabulary_reviews
      WHEN NOT EXISTS (
        SELECT 1 FROM vocabulary_entries
        WHERE vocabulary_id = NEW.vocabulary_id AND status = 'active' AND
          revision = NEW.expected_revision AND confirmed_at <= NEW.reviewed_at AND
          (last_reviewed_at IS NULL OR last_reviewed_at <= NEW.reviewed_at)
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_REVIEW_STATE_CONFLICT');
      END;

      CREATE TRIGGER vocabulary_review_applies_schedule
      AFTER INSERT ON vocabulary_reviews
      BEGIN
        UPDATE vocabulary_entries SET
          revision = revision + 1,
          due_on = NEW.next_due_on,
          stage = NEW.next_stage,
          last_review_id = NEW.review_id,
          last_reviewed_at = NEW.reviewed_at,
          last_grade = NEW.grade,
          updated_at = NEW.reviewed_at
        WHERE vocabulary_id = NEW.vocabulary_id;
      END;

      CREATE TRIGGER vocabulary_reviews_immutable_update
      BEFORE UPDATE ON vocabulary_reviews
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_REVIEW_IMMUTABLE');
      END;

      CREATE TABLE vocabulary_deletions (
        vocabulary_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL CHECK (deleted_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TRIGGER vocabulary_delete_requires_tombstone
      BEFORE DELETE ON vocabulary_entries
      WHEN NOT EXISTS (
        SELECT 1 FROM vocabulary_deletions WHERE vocabulary_id = OLD.vocabulary_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_DELETE_REQUIRES_TOMBSTONE');
      END;

      CREATE TRIGGER vocabulary_reviews_immutable_delete
      BEFORE DELETE ON vocabulary_reviews
      WHEN NOT EXISTS (
        SELECT 1 FROM vocabulary_deletions WHERE vocabulary_id = OLD.vocabulary_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_REVIEW_IMMUTABLE');
      END;

      CREATE TRIGGER deleted_vocabulary_cannot_reappear
      BEFORE INSERT ON vocabulary_entries
      WHEN EXISTS (
        SELECT 1 FROM vocabulary_deletions WHERE vocabulary_id = NEW.vocabulary_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_ALREADY_DELETED');
      END;

    `,
  },
  {
    version: 5,
    name: "weekly-plans-and-voice-summaries",
    sql: `
      CREATE TABLE weekly_plans (
        plan_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
        role TEXT NOT NULL DEFAULT 'advisory' CHECK (role = 'advisory'),
        week_starts_on TEXT NOT NULL CHECK (week_starts_on GLOB '????-??-??'),
        requested_from TEXT NOT NULL CHECK (requested_from IN ('desktop', 'codex')),
        plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1))
      ) STRICT;

      CREATE UNIQUE INDEX weekly_plans_one_current
      ON weekly_plans(is_current) WHERE is_current = 1;
      CREATE INDEX weekly_plans_by_week ON weekly_plans(week_starts_on DESC, created_at DESC);

      CREATE TRIGGER weekly_plan_replace_current
      BEFORE INSERT ON weekly_plans
      WHEN NEW.is_current = 1
      BEGIN
        UPDATE weekly_plans SET is_current = 0 WHERE is_current = 1;
      END;

      CREATE TRIGGER weekly_plan_content_immutable
      BEFORE UPDATE OF plan_id, schema_version, role, week_starts_on, requested_from, plan_json, created_at
      ON weekly_plans
      BEGIN
        SELECT RAISE(ABORT, 'OD_WEEKLY_PLAN_IMMUTABLE');
      END;

      CREATE TABLE voice_summaries (
        voice_session_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
        summarized_at TEXT NOT NULL CHECK (summarized_at GLOB '????-??-??T??:??:??.???Z'),
        scenario_title TEXT NOT NULL CHECK (length(scenario_title) BETWEEN 1 AND 160),
        target_level TEXT NOT NULL CHECK (target_level IN ('a1', 'a2', 'b1', 'b2')),
        summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
        CHECK (length(summary_json) <= 262144)
      ) STRICT;

      CREATE INDEX voice_summaries_by_time ON voice_summaries(summarized_at DESC);

      CREATE TRIGGER voice_summary_immutable
      BEFORE UPDATE ON voice_summaries
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOICE_SUMMARY_IMMUTABLE');
      END;
    `,
  },
  {
    version: 6,
    name: "activity-history-handoff-attachments",
    sql: `
      CREATE TABLE prepared_activities (
        activity_id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL CHECK (activity_type IN (
          'writing', 'grammar', 'vocabulary-review', 'reading',
          'codex-listening', 'voice-speaking', 'placement', 'custom-lesson'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        origin_surface TEXT NOT NULL CHECK (origin_surface IN ('desktop', 'codex')),
        status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'completed')),
        context_json TEXT NOT NULL CHECK (json_valid(context_json)),
        prepared_at TEXT NOT NULL CHECK (prepared_at GLOB '????-??-??T??:??:??.???Z'),
        completed_at TEXT CHECK (
          completed_at IS NULL OR completed_at GLOB '????-??-??T??:??:??.???Z'
        ),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        CHECK (
          (status = 'prepared' AND completed_at IS NULL) OR
          (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= prepared_at)
        )
      ) STRICT;

      CREATE INDEX prepared_activities_dashboard
      ON prepared_activities(status, prepared_at DESC);

      CREATE TABLE activity_context_references (
        activity_id TEXT NOT NULL REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        reference_kind TEXT NOT NULL CHECK (
          reference_kind IN ('curriculum-topic', 'mistake', 'vocabulary')
        ),
        reference_id TEXT NOT NULL CHECK (length(reference_id) BETWEEN 18 AND 96),
        PRIMARY KEY (activity_id, reference_kind, reference_id)
      ) STRICT;

      CREATE TABLE persistent_handoffs (
        handoff_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        origin_surface TEXT NOT NULL CHECK (origin_surface IN ('desktop', 'codex')),
        destination_surface TEXT NOT NULL CHECK (destination_surface IN ('desktop', 'codex', 'voice')),
        target_kind TEXT NOT NULL CHECK (
          target_kind IN ('desktop-activity', 'codex-task', 'voice-session')
        ),
        target_reference TEXT CHECK (
          target_reference IS NULL OR length(target_reference) BETWEEN 1 AND 256
        ),
        status TEXT NOT NULL CHECK (status IN ('prepared', 'opened', 'completed', 'failed')),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        CHECK (origin_surface <> destination_surface),
        CHECK (
          (status = 'prepared' AND target_reference IS NULL) OR
          (status IN ('opened', 'completed') AND target_reference IS NOT NULL) OR
          status = 'failed'
        )
      ) STRICT;

      CREATE INDEX handoffs_by_activity ON persistent_handoffs(activity_id, created_at DESC);

      CREATE TABLE history_entries (
        history_entry_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN (
          'attempt', 'correction', 'vocabulary-review', 'voice-summary', 'placement', 'plan'
        )),
        entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 18 AND 96),
        skill TEXT NOT NULL CHECK (skill IN ('writing', 'reading', 'listening', 'speaking')),
        activity_type TEXT NOT NULL CHECK (activity_type IN (
          'writing', 'grammar', 'vocabulary-review', 'reading',
          'codex-listening', 'voice-speaking', 'placement', 'custom-lesson'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
        reconstruction_json TEXT NOT NULL CHECK (json_valid(reconstruction_json)),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        UNIQUE (entity_kind, entity_id)
      ) STRICT;

      CREATE INDEX history_by_time ON history_entries(occurred_at DESC, history_entry_id);
      CREATE INDEX history_by_skill ON history_entries(skill, occurred_at DESC);
      CREATE INDEX history_by_activity_type ON history_entries(activity_type, occurred_at DESC);

      CREATE TABLE history_curriculum_topics (
        history_entry_id TEXT NOT NULL REFERENCES history_entries(history_entry_id) ON DELETE CASCADE,
        curriculum_topic_id TEXT NOT NULL,
        PRIMARY KEY (history_entry_id, curriculum_topic_id)
      ) STRICT;

      CREATE TABLE history_mistake_categories (
        history_entry_id TEXT NOT NULL REFERENCES history_entries(history_entry_id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 120),
        PRIMARY KEY (history_entry_id, category)
      ) STRICT;

      CREATE TABLE attachment_metadata (
        attachment_id TEXT PRIMARY KEY CHECK (length(attachment_id) BETWEEN 18 AND 96),
        owner_kind TEXT NOT NULL CHECK (owner_kind IN ('activity', 'history')),
        owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 18 AND 96),
        kind TEXT NOT NULL CHECK (kind IN ('image', 'document', 'imported-text')),
        media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 3 AND 100),
        relative_path TEXT NOT NULL CHECK (
          length(relative_path) BETWEEN 1 AND 512 AND
          relative_path NOT LIKE '/%' AND relative_path NOT LIKE '../%' AND
          relative_path NOT LIKE '%/../%' AND relative_path NOT LIKE '%/..' AND
          relative_path <> '..' AND instr(relative_path, char(92)) = 0
        ),
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 52428800),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        UNIQUE (relative_path),
        UNIQUE (owner_kind, owner_id, attachment_id)
      ) STRICT;

      CREATE TRIGGER attachment_owner_must_match_generation
      BEFORE INSERT ON attachment_metadata
      WHEN
        (NEW.owner_kind = 'activity' AND NOT EXISTS (
          SELECT 1 FROM prepared_activities
          WHERE activity_id = NEW.owner_id AND root_generation = NEW.root_generation
        )) OR
        (NEW.owner_kind = 'history' AND NOT EXISTS (
          SELECT 1 FROM history_entries
          WHERE history_entry_id = NEW.owner_id AND root_generation = NEW.root_generation
        ))
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTACHMENT_OWNER_INVALID');
      END;
    `,
  },
  {
    version: 7,
    name: "idempotent-write-ledger",
    sql: `
      CREATE TABLE idempotent_writes (
        operation TEXT NOT NULL CHECK (operation IN (
          'vocabulary-candidate', 'vocabulary-confirmation', 'vocabulary-review',
          'weekly-plan', 'voice-summary', 'prepared-activity', 'attempt-completion'
        )),
        idempotency_key TEXT NOT NULL CHECK (
          length(idempotency_key) BETWEEN 8 AND 128 AND
          idempotency_key NOT GLOB '*[^0-9A-Za-z._:-]*'
        ),
        request_sha256 TEXT NOT NULL CHECK (
          length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 18 AND 128),
        recorded_at TEXT NOT NULL CHECK (recorded_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (operation, idempotency_key)
      ) STRICT;

      CREATE TRIGGER idempotent_writes_immutable_update
      BEFORE UPDATE ON idempotent_writes
      BEGIN
        SELECT RAISE(ABORT, 'OD_IDEMPOTENCY_LEDGER_IMMUTABLE');
      END;

      CREATE TRIGGER idempotent_writes_immutable_delete
      BEFORE DELETE ON idempotent_writes
      BEGIN
        SELECT RAISE(ABORT, 'OD_IDEMPOTENCY_LEDGER_IMMUTABLE');
      END;
    `,
  },
  {
    version: 8,
    name: "audited-attempt-deletion",
    sql: `
      CREATE TABLE attempt_deletions (
        attempt_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL CHECK (deleted_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TRIGGER attempt_delete_requires_tombstone
      BEFORE DELETE ON attempts
      WHEN NOT EXISTS (
        SELECT 1 FROM attempt_deletions WHERE attempt_id = OLD.attempt_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_DELETE_REQUIRES_TOMBSTONE');
      END;

      CREATE TRIGGER deleted_attempt_cannot_reappear
      BEFORE INSERT ON attempts
      WHEN EXISTS (
        SELECT 1 FROM attempt_deletions WHERE attempt_id = NEW.attempt_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTEMPT_ALREADY_DELETED');
      END;
    `,
  },
  {
    version: 9,
    name: "portable-privacy-acknowledgement",
    sql: `
      CREATE TABLE privacy_acknowledgements (
        disclosure TEXT PRIMARY KEY CHECK (disclosure = 'first-ai-action'),
        acknowledged_at TEXT NOT NULL CHECK (acknowledged_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TRIGGER privacy_acknowledgements_immutable_update
      BEFORE UPDATE ON privacy_acknowledgements
      BEGIN
        SELECT RAISE(ABORT, 'OD_PRIVACY_ACKNOWLEDGEMENT_IMMUTABLE');
      END;

      CREATE TRIGGER privacy_acknowledgements_immutable_delete
      BEFORE DELETE ON privacy_acknowledgements
      BEGIN
        SELECT RAISE(ABORT, 'OD_PRIVACY_ACKNOWLEDGEMENT_IMMUTABLE');
      END;
    `,
  },
  {
    version: 10,
    name: "default-teaching-profile-setting",
    sql: `
      ALTER TABLE learner_settings
      ADD COLUMN teaching_profile_id TEXT NOT NULL DEFAULT 'conversation-partner'
        CHECK (teaching_profile_id IN ('conversation-partner', 'strict-corrector'));
    `,
  },
  {
    version: 11,
    name: "history-plan-generation",
    sql: `
      DROP TRIGGER attachment_owner_must_match_generation;

      ALTER TABLE history_curriculum_topics RENAME TO history_curriculum_topics_old;
      ALTER TABLE history_mistake_categories RENAME TO history_mistake_categories_old;
      ALTER TABLE history_entries RENAME TO history_entries_old;

      CREATE TABLE history_entries (
        history_entry_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN (
          'attempt', 'correction', 'vocabulary-review', 'voice-summary', 'placement', 'plan'
        )),
        entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 18 AND 96),
        skill TEXT NOT NULL CHECK (skill IN ('writing', 'reading', 'listening', 'speaking')),
        activity_type TEXT NOT NULL CHECK (activity_type IN (
          'writing', 'grammar', 'vocabulary-review', 'reading',
          'codex-listening', 'voice-speaking', 'placement', 'custom-lesson', 'plan-generation'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
        reconstruction_json TEXT NOT NULL CHECK (json_valid(reconstruction_json)),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        UNIQUE (entity_kind, entity_id)
      ) STRICT;

      INSERT INTO history_entries (
        history_entry_id, entity_kind, entity_id, skill, activity_type, title,
        occurred_at, reconstruction_json, root_generation
      )
      SELECT history_entry_id, entity_kind, entity_id, skill, activity_type, title,
        occurred_at, reconstruction_json, root_generation
      FROM history_entries_old;

      CREATE TABLE history_curriculum_topics (
        history_entry_id TEXT NOT NULL REFERENCES history_entries(history_entry_id) ON DELETE CASCADE,
        curriculum_topic_id TEXT NOT NULL,
        PRIMARY KEY (history_entry_id, curriculum_topic_id)
      ) STRICT;

      INSERT INTO history_curriculum_topics (history_entry_id, curriculum_topic_id)
      SELECT history_entry_id, curriculum_topic_id FROM history_curriculum_topics_old;

      CREATE TABLE history_mistake_categories (
        history_entry_id TEXT NOT NULL REFERENCES history_entries(history_entry_id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 120),
        PRIMARY KEY (history_entry_id, category)
      ) STRICT;

      INSERT INTO history_mistake_categories (history_entry_id, category)
      SELECT history_entry_id, category FROM history_mistake_categories_old;

      DROP TABLE history_curriculum_topics_old;
      DROP TABLE history_mistake_categories_old;
      DROP TABLE history_entries_old;

      CREATE INDEX history_by_time ON history_entries(occurred_at DESC, history_entry_id);
      CREATE INDEX history_by_skill ON history_entries(skill, occurred_at DESC);
      CREATE INDEX history_by_activity_type ON history_entries(activity_type, occurred_at DESC);

      CREATE TRIGGER attachment_owner_must_match_generation
      BEFORE INSERT ON attachment_metadata
      WHEN
        (NEW.owner_kind = 'activity' AND NOT EXISTS (
          SELECT 1 FROM prepared_activities
          WHERE activity_id = NEW.owner_id AND root_generation = NEW.root_generation
        )) OR
        (NEW.owner_kind = 'history' AND NOT EXISTS (
          SELECT 1 FROM history_entries
          WHERE history_entry_id = NEW.owner_id AND root_generation = NEW.root_generation
        ))
      BEGIN
        SELECT RAISE(ABORT, 'OD_ATTACHMENT_OWNER_INVALID');
      END;
    `,
  },
  {
    version: 12,
    name: "targeted-mistake-practice",
    sql: `
      CREATE TABLE generated_activity_payloads (
        activity_id TEXT PRIMARY KEY REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        workload TEXT NOT NULL CHECK (workload = 'exercise-generation'),
        model_request_id TEXT NOT NULL CHECK (length(model_request_id) BETWEEN 18 AND 200),
        model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
        effort_id TEXT NOT NULL CHECK (length(effort_id) BETWEEN 1 AND 120),
        generated_at TEXT NOT NULL CHECK (generated_at GLOB '????-??-??T??:??:??.???Z'),
        output_json TEXT NOT NULL CHECK (json_valid(output_json))
      ) STRICT;

      CREATE TABLE targeted_practice_links (
        activity_id TEXT NOT NULL REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        mistake_id TEXT NOT NULL REFERENCES mistakes(mistake_id) ON DELETE RESTRICT,
        category_json TEXT NOT NULL CHECK (json_valid(category_json)),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (activity_id, mistake_id)
      ) STRICT;

      CREATE INDEX targeted_practice_by_category
      ON targeted_practice_links(category_json, created_at DESC, activity_id);

      CREATE TRIGGER generated_activity_payload_immutable
      BEFORE UPDATE ON generated_activity_payloads
      BEGIN
        SELECT RAISE(ABORT, 'OD_GENERATED_ACTIVITY_IMMUTABLE');
      END;

      CREATE TRIGGER targeted_practice_link_immutable
      BEFORE UPDATE ON targeted_practice_links
      BEGIN
        SELECT RAISE(ABORT, 'OD_TARGETED_PRACTICE_LINK_IMMUTABLE');
      END;
    `,
  },
  {
    version: 13,
    name: "correction-vocabulary-candidates",
    sql: `
      ALTER TABLE corrections
      ADD COLUMN vocabulary_candidates_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(vocabulary_candidates_json));
    `,
  },
  {
    version: 14,
    name: "vocabulary-lesson-sets",
    sql: `
      CREATE TABLE vocabulary_lesson_sets (
        set_id TEXT PRIMARY KEY CHECK (
          length(set_id) BETWEEN 18 AND 96 AND set_id GLOB 'activity_[0-9a-z]*'
        ),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        requested_from TEXT NOT NULL CHECK (requested_from IN ('desktop', 'codex')),
        natural_request TEXT NOT NULL CHECK (length(natural_request) BETWEEN 1 AND 1000),
        source_json TEXT NOT NULL CHECK (json_valid(source_json)),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TABLE vocabulary_lesson_set_items (
        set_id TEXT NOT NULL REFERENCES vocabulary_lesson_sets(set_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
        vocabulary_id TEXT NOT NULL REFERENCES vocabulary_entries(vocabulary_id) ON DELETE RESTRICT,
        PRIMARY KEY (set_id, position),
        UNIQUE (set_id, vocabulary_id)
      ) STRICT;

      CREATE INDEX vocabulary_lesson_sets_by_date
      ON vocabulary_lesson_sets(created_at DESC, set_id);

      CREATE TRIGGER vocabulary_lesson_sets_immutable_update
      BEFORE UPDATE ON vocabulary_lesson_sets
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_LESSON_SET_IMMUTABLE');
      END;

      CREATE TRIGGER vocabulary_lesson_set_items_immutable_update
      BEFORE UPDATE ON vocabulary_lesson_set_items
      BEGIN
        SELECT RAISE(ABORT, 'OD_VOCABULARY_LESSON_SET_ITEM_IMMUTABLE');
      END;
    `,
  },
  {
    version: 15,
    name: "mcp-attempt-feedback",
    sql: `
      CREATE TABLE mcp_attempt_feedback (
        attempt_id TEXT PRIMARY KEY CHECK (
          length(attempt_id) BETWEEN 18 AND 96 AND attempt_id GLOB 'attempt_[0-9a-z]*'
        ),
        activity_id TEXT NOT NULL REFERENCES prepared_activities(activity_id) ON DELETE RESTRICT,
        expected_activity_revision INTEGER NOT NULL CHECK (expected_activity_revision > 0),
        feedback_json TEXT NOT NULL CHECK (json_valid(feedback_json)),
        saved_at TEXT NOT NULL CHECK (saved_at GLOB '????-??-??T??:??:??.???Z'),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0)
      ) STRICT;

      CREATE INDEX mcp_attempt_feedback_by_activity
      ON mcp_attempt_feedback(activity_id, saved_at DESC);

      CREATE TRIGGER mcp_attempt_feedback_immutable_update
      BEFORE UPDATE ON mcp_attempt_feedback
      BEGIN
        SELECT RAISE(ABORT, 'OD_MCP_ATTEMPT_FEEDBACK_IMMUTABLE');
      END;
    `,
  },
  {
    version: 16,
    name: "persistent-handoff-payload",
    sql: `
      ALTER TABLE persistent_handoffs
      ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 1 CHECK (payload_version = 1);

      ALTER TABLE persistent_handoffs
      ADD COLUMN continuation_summary TEXT NOT NULL DEFAULT 'Continue the prepared Call Nina activity.'
      CHECK (length(continuation_summary) BETWEEN 1 AND 2000);
    `,
  },
  {
    version: 17,
    name: "self-paced-learning-path",
    sql: `
      CREATE TABLE course_selection (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), selected_stage TEXT NOT NULL CHECK(selected_stage IN ('a1-1','a1-2')), current_json TEXT CHECK(current_json IS NULL OR json_valid(current_json))) STRICT;
      CREATE TABLE course_marks (version TEXT NOT NULL, unit_id TEXT NOT NULL, step TEXT NOT NULL CHECK(step IN ('learn','practice','reading','writing','listening','speaking')), status TEXT NOT NULL CHECK(status IN ('completed','skipped','not-started')), updated_at TEXT NOT NULL, PRIMARY KEY(version, unit_id, step)) STRICT;
      CREATE TABLE course_results (history_entry_id TEXT PRIMARY KEY REFERENCES history_entries(history_entry_id) ON DELETE CASCADE, activity_id TEXT NOT NULL REFERENCES prepared_activities(activity_id) ON DELETE CASCADE, occurred_at TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json))) STRICT;
      CREATE INDEX course_results_by_activity ON course_results(activity_id, occurred_at);
    `,
  },
  {
    version: 18,
    name: "current-learning-contract-development-reset",
    sql: `
      CREATE TABLE development_notices (
        version INTEGER PRIMARY KEY, dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1))
      ) STRICT;
      INSERT INTO development_notices(version)
      SELECT 18 WHERE EXISTS (SELECT 1 FROM prepared_activities)
        OR EXISTS (SELECT 1 FROM exercises) OR EXISTS (SELECT 1 FROM history_entries)
        OR EXISTS (SELECT 1 FROM weekly_plans) OR EXISTS (SELECT 1 FROM vocabulary_entries)
        OR EXISTS (SELECT 1 FROM voice_summaries) OR EXISTS (SELECT 1 FROM course_marks)
        OR EXISTS (SELECT 1 FROM lessons) OR EXISTS (SELECT 1 FROM mistakes)
        OR EXISTS (SELECT 1 FROM learner_profile_insights) OR EXISTS (SELECT 1 FROM attachment_metadata);
      -- This version explicitly resets development learning data, never arbitrary files.
      INSERT OR IGNORE INTO attempt_deletions SELECT attempt_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM attempts;
      INSERT OR IGNORE INTO vocabulary_deletions SELECT vocabulary_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM vocabulary_entries;
      DELETE FROM course_results;
      DELETE FROM course_marks;
      DELETE FROM course_selection;
      DELETE FROM attachment_metadata;
      DELETE FROM history_entries;
      DELETE FROM mcp_attempt_feedback;
      DELETE FROM vocabulary_lesson_sets;
      DELETE FROM vocabulary_entries;
      DELETE FROM attempts;
      DELETE FROM exercises;
      DELETE FROM lessons;
      DELETE FROM prepared_activities;
      DELETE FROM mistakes;
      DELETE FROM voice_summaries;
      DELETE FROM learner_profile_insights;
      UPDATE learner_profiles SET level_basis = 'self-reported', optional_diagnostic_completed_on = NULL;
      DROP TABLE history_entries;
      CREATE TABLE history_entries (
        history_entry_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN (
          'attempt', 'correction', 'vocabulary-review', 'voice-summary', 'placement'
        )),
        entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 18 AND 96),
        skill TEXT NOT NULL CHECK (skill IN ('writing', 'reading', 'listening', 'speaking')),
        activity_type TEXT NOT NULL CHECK (activity_type IN (
          'writing', 'grammar', 'vocabulary-review', 'reading',
          'codex-listening', 'voice-speaking', 'placement', 'custom-lesson'
        )),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
        reconstruction_json TEXT NOT NULL CHECK (json_valid(reconstruction_json)),
        root_generation INTEGER NOT NULL CHECK (root_generation > 0),
        UNIQUE (entity_kind, entity_id)
      ) STRICT;

      CREATE INDEX history_by_time ON history_entries(occurred_at DESC, history_entry_id);
      CREATE INDEX history_by_skill ON history_entries(skill, occurred_at DESC);
      CREATE INDEX history_by_activity_type ON history_entries(activity_type, occurred_at DESC);
      ALTER TABLE learner_profiles DROP COLUMN available_study_minutes_per_week;
      DROP TABLE weekly_plans;
      DROP TABLE persistent_handoffs;
      DROP TABLE idempotent_writes;
      CREATE TABLE idempotent_writes (
        operation TEXT NOT NULL CHECK (operation IN (
          'vocabulary-candidate', 'vocabulary-confirmation', 'vocabulary-review',
          'voice-summary', 'prepared-activity', 'attempt-completion'
        )),
        idempotency_key TEXT NOT NULL CHECK (
          length(idempotency_key) BETWEEN 8 AND 128 AND
          idempotency_key NOT GLOB '*[^0-9A-Za-z._:-]*'
        ),
        request_sha256 TEXT NOT NULL CHECK (
          length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 18 AND 128),
        recorded_at TEXT NOT NULL CHECK (recorded_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (operation, idempotency_key)
      ) STRICT;

      CREATE TRIGGER idempotent_writes_immutable_update
      BEFORE UPDATE ON idempotent_writes
      BEGIN
        SELECT RAISE(ABORT, 'OD_IDEMPOTENCY_LEDGER_IMMUTABLE');
      END;

      CREATE TRIGGER idempotent_writes_immutable_delete
      BEFORE DELETE ON idempotent_writes
      BEGIN
        SELECT RAISE(ABORT, 'OD_IDEMPOTENCY_LEDGER_IMMUTABLE');
      END;
      DELETE FROM attempt_deletions;
      DELETE FROM mistake_deletions;
      DELETE FROM vocabulary_deletions;
    `,
  },
  {
    version: 19,
    name: "mission-course-format",
    sql: `
      INSERT INTO development_notices(version)
      SELECT 19 WHERE EXISTS (SELECT 1 FROM course_marks) OR EXISTS (SELECT 1 FROM prepared_activities WHERE json_type(context_json, '$.learningPath') = 'object');
      CREATE TEMP TABLE superseded_course_activities AS SELECT activity_id FROM prepared_activities WHERE json_type(context_json, '$.learningPath') = 'object';
      DELETE FROM history_entries WHERE history_entry_id IN (SELECT history_entry_id FROM course_results)
        OR (entity_kind = 'attempt' AND entity_id IN (SELECT attempt_id FROM attempts WHERE exercise_id IN (SELECT exercise_id FROM exercises WHERE activity_id IN (SELECT activity_id FROM superseded_course_activities))));
      DELETE FROM voice_summaries WHERE json_extract(summary_json, '$.activity.activityId') IN (SELECT activity_id FROM superseded_course_activities);
      DELETE FROM mcp_attempt_feedback WHERE activity_id IN (SELECT activity_id FROM superseded_course_activities);
      INSERT OR IGNORE INTO attempt_deletions SELECT a.attempt_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id WHERE e.activity_id IN (SELECT activity_id FROM superseded_course_activities);
      DELETE FROM exercises WHERE activity_id IN (SELECT activity_id FROM superseded_course_activities);
      DELETE FROM lessons WHERE activity_id IN (SELECT activity_id FROM superseded_course_activities);
      DELETE FROM prepared_activities WHERE activity_id IN (SELECT activity_id FROM superseded_course_activities);
      DROP TABLE superseded_course_activities;
      DELETE FROM course_selection;
      DROP TABLE course_marks;
      CREATE TABLE course_marks (version TEXT NOT NULL, unit_id TEXT NOT NULL, activity_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('completed','skipped','not-started')), updated_at TEXT NOT NULL, PRIMARY KEY(version, unit_id, activity_key)) STRICT;
      CREATE TABLE course_missions (mission_id TEXT PRIMARY KEY, version TEXT NOT NULL, unit_id TEXT NOT NULL, variant_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('course','review')), started_at TEXT NOT NULL, facts TEXT NOT NULL) STRICT;
      CREATE INDEX course_missions_by_unit ON course_missions(version, unit_id, started_at);
      CREATE TABLE exercise_support (attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE, hints_used INTEGER NOT NULL DEFAULT 0 CHECK(hints_used >= 0)) STRICT;
      ALTER TABLE vocabulary_reviews ADD COLUMN retrieval TEXT CHECK(retrieval IN ('recognition','recall','use'));
      CREATE TABLE course_vocabulary_links (target_id TEXT PRIMARY KEY, vocabulary_id TEXT NOT NULL REFERENCES vocabulary_entries(vocabulary_id) ON DELETE CASCADE) STRICT;
    `,
  },
  {
    version: 20,
    name: "course-helper-support",
    sql: `ALTER TABLE exercise_support ADD COLUMN helper_used INTEGER NOT NULL DEFAULT 0 CHECK(helper_used IN (0,1));
          ALTER TABLE exercise_support ADD COLUMN translation_used INTEGER NOT NULL DEFAULT 0 CHECK(translation_used IN (0,1));
          DROP TRIGGER vocabulary_review_applies_schedule;
          CREATE TRIGGER vocabulary_review_applies_schedule AFTER INSERT ON vocabulary_reviews BEGIN
            UPDATE vocabulary_entries SET revision = revision + 1,
              due_on = max(substr(NEW.reviewed_at,1,10), (
                SELECT min(coalesce((SELECT r.next_due_on FROM vocabulary_reviews r WHERE r.vocabulary_id = NEW.vocabulary_id AND r.retrieval = modes.mode ORDER BY r.expected_revision DESC LIMIT 1), substr(confirmed_at,1,10)))
                FROM (SELECT 'recognition' AS mode UNION ALL SELECT 'recall' UNION ALL SELECT 'use') modes)),
              stage = NEW.next_stage, last_review_id = NEW.review_id, last_reviewed_at = NEW.reviewed_at,
              last_grade = NEW.grade, updated_at = NEW.reviewed_at
            WHERE vocabulary_id = NEW.vocabulary_id;
          END;
          UPDATE vocabulary_entries SET due_on = max(substr(last_reviewed_at,1,10), substr(confirmed_at,1,10))
            WHERE status = 'active' AND last_reviewed_at IS NOT NULL;
`,
  },
  {
    version: 21,
    name: "vocabulary-retrieval-due-projection",
    sql: `UPDATE vocabulary_entries SET due_on = max(substr(coalesce(last_reviewed_at, confirmed_at),1,10), (
      SELECT min(coalesce((SELECT r.next_due_on FROM vocabulary_reviews r
        WHERE r.vocabulary_id = vocabulary_entries.vocabulary_id AND r.retrieval = modes.mode
        ORDER BY r.expected_revision DESC LIMIT 1), substr(confirmed_at,1,10)))
      FROM (SELECT 'recognition' AS mode UNION ALL SELECT 'recall' UNION ALL SELECT 'use') modes))
      WHERE status = 'active';`,
  },
  {
    version: 22,
    name: "persistent-course-activity-support",
    sql: `CREATE TABLE course_activity_support (
      activity_id TEXT PRIMARY KEY REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
      hints_used INTEGER NOT NULL DEFAULT 0 CHECK(hints_used IN (0,1)),
      helper_used INTEGER NOT NULL DEFAULT 0 CHECK(helper_used IN (0,1)),
      translation_used INTEGER NOT NULL DEFAULT 0 CHECK(translation_used IN (0,1))
    ) STRICT;
    INSERT INTO course_activity_support
      SELECT e.activity_id, max(s.hints_used > 0), max(s.helper_used), max(s.translation_used)
      FROM exercise_support s JOIN attempts a ON a.attempt_id = s.attempt_id JOIN exercises e ON e.exercise_id = a.exercise_id
      JOIN prepared_activities p ON p.activity_id = e.activity_id
      WHERE json_type(p.context_json, '$.learningPath') = 'object' GROUP BY e.activity_id;`,
  },
  {
    version: 23,
    name: "saved-flashcard-decks",
    sql: `
      ALTER TABLE prepared_activities ADD COLUMN activity_type_v23 TEXT NOT NULL DEFAULT 'custom-lesson'
        CHECK (activity_type_v23 IN ('writing','grammar','vocabulary-review','reading','codex-listening','voice-speaking','placement','custom-lesson','flashcards'));
      UPDATE prepared_activities SET activity_type_v23 = activity_type;
      ALTER TABLE prepared_activities DROP COLUMN activity_type;
      ALTER TABLE prepared_activities RENAME COLUMN activity_type_v23 TO activity_type;
      CREATE TABLE flashcard_decks (
        activity_id TEXT PRIMARY KEY REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('generated','vocabulary')),
        cards_json TEXT NOT NULL CHECK(json_valid(cards_json)),
        provenance_json TEXT CHECK(provenance_json IS NULL OR json_valid(provenance_json)),
        position INTEGER NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 29),
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      ) STRICT;
      CREATE TABLE flashcard_vocabulary_links (
        activity_id TEXT NOT NULL REFERENCES flashcard_decks(activity_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 29),
        vocabulary_id TEXT NOT NULL REFERENCES vocabulary_entries(vocabulary_id) ON DELETE CASCADE,
        PRIMARY KEY(activity_id, position)
      ) STRICT;
    `,
  },
  {
    version: 24,
    name: "explicit-local-learning-context",
    sql: `
      -- No identity guessing, resets or deletes: ambiguous/orphaned roots roll back this migration.
      CREATE TEMP TABLE learning_owner_guard (valid INTEGER NOT NULL CHECK(valid = 1));
      INSERT INTO learning_owner_guard SELECT CASE WHEN
        (SELECT count(*) FROM learner_profiles) > 1 OR
        ((SELECT count(*) FROM learner_profiles) = 0 AND (EXISTS (SELECT 1 FROM lessons) OR EXISTS (SELECT 1 FROM exercises) OR EXISTS (SELECT 1 FROM mistakes) OR EXISTS (SELECT 1 FROM vocabulary_entries) OR EXISTS (SELECT 1 FROM voice_summaries) OR EXISTS (SELECT 1 FROM prepared_activities) OR EXISTS (SELECT 1 FROM history_entries) OR EXISTS (SELECT 1 FROM vocabulary_lesson_sets) OR EXISTS (SELECT 1 FROM course_selection) OR EXISTS (SELECT 1 FROM course_marks) OR EXISTS (SELECT 1 FROM course_missions)))
        THEN 0 ELSE 1 END;
      DROP TABLE learning_owner_guard;
      ALTER TABLE learner_profiles RENAME COLUMN everyday_germany_goal TO everyday_life_goal;
      ALTER TABLE learner_settings RENAME COLUMN teaching_language TO explanation_language;
      CREATE TABLE local_learning_scope (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        learner_id TEXT NOT NULL UNIQUE REFERENCES learner_profiles(learner_id) ON DELETE RESTRICT,
        course_id TEXT NOT NULL CHECK(course_id = 'german-foundations'),
        target_language TEXT NOT NULL CHECK(target_language = 'de')
      ) STRICT;
      INSERT INTO local_learning_scope SELECT 1, learner_id, 'german-foundations', 'de' FROM learner_profiles;
      CREATE TRIGGER local_learning_scope_immutable_update BEFORE UPDATE ON local_learning_scope
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_SCOPE_IMMUTABLE'); END;
      CREATE TRIGGER local_learning_scope_immutable_delete BEFORE DELETE ON local_learning_scope
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_SCOPE_IMMUTABLE'); END;
      CREATE TRIGGER single_local_learner BEFORE INSERT ON learner_profiles
        WHEN EXISTS (SELECT 1 FROM learner_profiles)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_SCOPE_ALREADY_EXISTS'); END;
      UPDATE prepared_activities SET context_json = json_set(context_json, '$.learningScope',
        json((SELECT json_object('learnerId', learner_id, 'courseId', course_id, 'targetLanguage', target_language) FROM local_learning_scope)));

      CREATE TRIGGER prepared_activity_scope_insert BEFORE INSERT ON prepared_activities
        WHEN json_extract(NEW.context_json, '$.learningScope.learnerId') IS NOT (SELECT learner_id FROM local_learning_scope WHERE singleton = 1)
          OR json_extract(NEW.context_json, '$.learningScope.courseId') IS NOT (SELECT course_id FROM local_learning_scope WHERE singleton = 1)
          OR json_extract(NEW.context_json, '$.learningScope.targetLanguage') IS NOT (SELECT target_language FROM local_learning_scope WHERE singleton = 1)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_MISMATCH'); END;
      CREATE TRIGGER prepared_activity_scope_update BEFORE UPDATE OF context_json ON prepared_activities
        WHEN json_extract(NEW.context_json, '$.learningScope.learnerId') IS NOT (SELECT learner_id FROM local_learning_scope WHERE singleton = 1)
          OR json_extract(NEW.context_json, '$.learningScope.courseId') IS NOT (SELECT course_id FROM local_learning_scope WHERE singleton = 1)
          OR json_extract(NEW.context_json, '$.learningScope.targetLanguage') IS NOT (SELECT target_language FROM local_learning_scope WHERE singleton = 1)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_MISMATCH'); END;
      ALTER TABLE lessons ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER lessons_requires_learning_scope BEFORE INSERT ON lessons
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE exercises ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER exercises_requires_learning_scope BEFORE INSERT ON exercises
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE mistakes ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER mistakes_requires_learning_scope BEFORE INSERT ON mistakes
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE vocabulary_entries ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER vocabulary_entries_requires_learning_scope BEFORE INSERT ON vocabulary_entries
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE voice_summaries ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER voice_summaries_requires_learning_scope BEFORE INSERT ON voice_summaries
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE prepared_activities ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER prepared_activities_requires_learning_scope BEFORE INSERT ON prepared_activities
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE history_entries ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER history_entries_requires_learning_scope BEFORE INSERT ON history_entries
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE vocabulary_lesson_sets ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER vocabulary_lesson_sets_requires_learning_scope BEFORE INSERT ON vocabulary_lesson_sets
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE course_selection ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER course_selection_requires_learning_scope BEFORE INSERT ON course_selection
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE course_marks ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER course_marks_requires_learning_scope BEFORE INSERT ON course_marks
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;

      ALTER TABLE course_missions ADD COLUMN learning_scope_id INTEGER NOT NULL DEFAULT 1 CHECK(learning_scope_id = 1);
      CREATE TRIGGER course_missions_requires_learning_scope BEFORE INSERT ON course_missions
        WHEN NOT EXISTS (SELECT 1 FROM local_learning_scope WHERE singleton = NEW.learning_scope_id)
        BEGIN SELECT RAISE(ABORT, 'OD_LEARNING_CONTEXT_REQUIRED'); END;
    `,
  },
  {
    version: 25,
    name: "versioned-materials-portable-content",
    sql: `
      CREATE TABLE material_revisions (
        material_id TEXT NOT NULL,
        revision_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK(revision > 0),
        revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
        learning_scope_id INTEGER NOT NULL DEFAULT 1 REFERENCES local_learning_scope(singleton),
        UNIQUE(material_id, revision)
      ) STRICT;
      CREATE TRIGGER material_revision_immutable BEFORE UPDATE ON material_revisions
        BEGIN SELECT RAISE(ABORT, 'OD_MATERIAL_REVISION_IMMUTABLE'); END;
      CREATE TABLE activity_content_revisions (
        activity_id TEXT PRIMARY KEY REFERENCES prepared_activities(activity_id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL UNIQUE,
        material_revision_id TEXT NOT NULL REFERENCES material_revisions(revision_id) ON DELETE RESTRICT
      ) STRICT;
      CREATE TRIGGER activity_content_revision_immutable BEFORE UPDATE ON activity_content_revisions
        BEGIN SELECT RAISE(ABORT, 'OD_CONTENT_REVISION_IMMUTABLE'); END;
      CREATE TABLE attempt_content_revisions (
        attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE,
        content_revision_id TEXT NOT NULL REFERENCES activity_content_revisions(revision_id) ON DELETE RESTRICT
      ) STRICT;
      CREATE TRIGGER attempt_content_revision_immutable BEFORE UPDATE ON attempt_content_revisions
        BEGIN SELECT RAISE(ABORT, 'OD_CONTENT_REVISION_IMMUTABLE'); END;
      DROP TRIGGER generated_activity_payload_immutable;
      ALTER TABLE flashcard_decks RENAME COLUMN cards_json TO content_json;
    `,
    migrate: migrateVersionedContent,
  },
  {
    version: 26,
    name: "attempt-ownership-and-evidence-events",
    sql: `
      CREATE TABLE learning_attempts (
        attempt_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('exercise', 'vocabulary-review', 'external', 'listening')), source_id TEXT NOT NULL,
        ownership_json TEXT NOT NULL CHECK(json_valid(ownership_json) AND json_extract(ownership_json, '$.attemptId') = attempt_id),
        UNIQUE(source_kind, source_id)
      ) STRICT;
      CREATE TABLE learning_attempt_events (
        event_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES learning_attempts(attempt_id) ON DELETE CASCADE,
        event_json TEXT NOT NULL CHECK(json_valid(event_json) AND json_extract(event_json, '$.attemptId') = attempt_id AND json_extract(event_json, '$.eventId') = event_id)
      ) STRICT;
      CREATE INDEX learning_attempt_events_by_attempt ON learning_attempt_events(attempt_id);
      CREATE TRIGGER learning_attempt_immutable BEFORE UPDATE ON learning_attempts
        BEGIN SELECT RAISE(ABORT, 'OD_ATTEMPT_OWNERSHIP_IMMUTABLE'); END;
      CREATE TRIGGER learning_attempt_event_immutable BEFORE UPDATE ON learning_attempt_events
        BEGIN SELECT RAISE(ABORT, 'OD_ATTEMPT_EVENT_IMMUTABLE'); END;
      ALTER TABLE mcp_attempt_feedback RENAME TO previous_attempt_feedback;
      DROP TRIGGER mcp_attempt_feedback_immutable_update;
      DROP INDEX mcp_attempt_feedback_by_activity;
      CREATE TABLE mcp_attempt_feedback (
        attempt_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        expected_activity_revision INTEGER NOT NULL CHECK(expected_activity_revision = 1),
        feedback_json TEXT NOT NULL CHECK(json_valid(feedback_json)),
        saved_at TEXT NOT NULL CHECK(saved_at GLOB '????-??-??T??:??:??.???Z'),
        root_generation INTEGER NOT NULL CHECK(root_generation > 0),
        target_attempt_id TEXT REFERENCES learning_attempts(attempt_id) ON DELETE CASCADE
      ) STRICT;
      INSERT INTO mcp_attempt_feedback SELECT *, NULL FROM previous_attempt_feedback;
      DROP TABLE previous_attempt_feedback;
      CREATE INDEX mcp_attempt_feedback_by_activity ON mcp_attempt_feedback(activity_id, saved_at DESC);
      CREATE TRIGGER mcp_attempt_feedback_immutable_update BEFORE UPDATE ON mcp_attempt_feedback
        BEGIN SELECT RAISE(ABORT, 'OD_MCP_ATTEMPT_FEEDBACK_IMMUTABLE'); END;
      CREATE TRIGGER mcp_feedback_requires_owner BEFORE INSERT ON mcp_attempt_feedback
        WHEN NOT EXISTS (SELECT 1 FROM prepared_activities WHERE activity_id = NEW.activity_id)
          AND NOT EXISTS (SELECT 1 FROM learning_attempts WHERE attempt_id = NEW.target_attempt_id
            AND json_extract(ownership_json, '$.source.activityId') = NEW.activity_id)
        BEGIN SELECT RAISE(ABORT, 'OD_ATTEMPT_REVISION_MISMATCH'); END;
      CREATE TRIGGER activity_feedback_delete AFTER DELETE ON prepared_activities BEGIN
        DELETE FROM mcp_attempt_feedback WHERE activity_id = OLD.activity_id;
      END;
      CREATE TRIGGER exercise_attempt_evidence_delete AFTER DELETE ON attempts BEGIN
        DELETE FROM learning_attempts WHERE source_kind = 'exercise' AND source_id = OLD.attempt_id;
      END;
      CREATE TRIGGER vocabulary_attempt_evidence_delete AFTER DELETE ON vocabulary_reviews BEGIN
        DELETE FROM learning_attempts WHERE source_kind = 'vocabulary-review' AND source_id = OLD.review_id;
      END;
      CREATE TRIGGER external_attempt_evidence_delete AFTER DELETE ON mcp_attempt_feedback BEGIN
        DELETE FROM learning_attempt_events WHERE json_extract(event_json, '$.detail.kind') = 'feedback'
          AND json_extract(event_json, '$.detail.recordId') = OLD.attempt_id;
        DELETE FROM learning_attempts WHERE source_kind = 'external' AND source_id = OLD.attempt_id;
        DELETE FROM history_entries WHERE entity_id = OLD.attempt_id;
      END;
      CREATE TRIGGER listening_attempt_evidence_delete AFTER DELETE ON history_entries BEGIN
        DELETE FROM learning_attempts WHERE source_kind = 'listening' AND source_id = OLD.entity_id;
      END;
    `,
    migrate: migrateAttemptEvidence,
  },
  {
    version: 27,
    name: "codex-route-model-preferences",
    sql: `
      ALTER TABLE model_preference_defaults
        ADD COLUMN route_id TEXT NOT NULL DEFAULT 'codex' CHECK(route_id = 'codex');
      ALTER TABLE model_preference_overrides
        ADD COLUMN route_id TEXT NOT NULL DEFAULT 'codex' CHECK(route_id = 'codex');
    `,
  },
] as const satisfies readonly DatabaseMigration[];

export function openCallNinaDatabase(options: {
  bootstrapFile: string;
  dataRoot: string;
  rootGeneration: DataRootGeneration;
  busyTimeoutMilliseconds?: number;
}) {
  return openDataRootDatabase({ ...options, migrations: callNinaMigrations });
}
