DELETE FROM tree_events
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM tree_events
  GROUP BY
    user_id,
    source,
    created_at,
    tokens,
    COALESCE(input_tokens, -1),
    COALESCE(output_tokens, -1),
    COALESCE(cache_read_tokens, -1),
    COALESCE(cache_write_tokens, -1)
);
