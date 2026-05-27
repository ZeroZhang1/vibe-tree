UPDATE tree_events
SET source = CASE
  WHEN event_id LIKE 'codex-session:%' THEN 'codex-session'
  WHEN event_id LIKE 'claude-session:%' THEN 'claude-session'
  WHEN event_id LIKE 'openclaw-session:%' THEN 'openclaw-session'
  WHEN event_id LIKE 'pi-session:%' THEN 'pi-session'
  WHEN event_id LIKE 'opencode-session:%' THEN 'opencode-session'
  WHEN event_id LIKE 'gemini-session:%' THEN 'gemini-session'
  WHEN event_id LIKE 'hermes-session:%' THEN 'hermes-session'
  WHEN event_id LIKE 'manual:%' THEN 'manual'
  ELSE source
END
WHERE source = 'cloud-sync';
