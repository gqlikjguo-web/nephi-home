-- Independent optional guest text; old feedback remains NULL without backfill.
ALTER TABLE guest_feedback
 ADD COLUMN positive_other_text text,
 ADD COLUMN improvement_other_text text,
 ADD CONSTRAINT guest_feedback_positive_other_valid CHECK (
  positive_other_text IS NULL OR (char_length(positive_other_text) BETWEEN 1 AND 500 AND 'other'=ANY(positives))),
 ADD CONSTRAINT guest_feedback_improvement_other_valid CHECK (
  improvement_other_text IS NULL OR (char_length(improvement_other_text) BETWEEN 1 AND 500 AND 'other'=ANY(improvements)));
