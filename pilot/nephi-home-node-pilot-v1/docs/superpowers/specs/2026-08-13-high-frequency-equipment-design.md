# High-frequency equipment formal facts design

Approved design: reuse existing `propertyFacts` JSON/JSONB for the 15 system-controlled equipment presets. Status maps `有 / 沒有 / 未知` to `allowed / not_allowed / unknown`; scope remains `whole_property / room_only / both`; `publicName` is system-controlled; `allowed` requires official guest-facing text, `not_allowed` may omit it, and `unknown` provides no answer. Existing bundle entertainment amenities remain separate. No migration, Planner, evidence, 113-case, keyword, regex, classifier, case-ID, or property-specific change is allowed.
