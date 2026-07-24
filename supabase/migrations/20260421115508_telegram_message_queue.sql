CREATE TABLE telegram_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  message_id INTEGER NOT NULL,
  from_user JSONB,
  text TEXT,
  media_type TEXT,
  media_file_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(chat_id, message_id)
);

CREATE INDEX idx_telegram_queue_pending ON telegram_message_queue (status, created_at) WHERE status = 'pending';
ALTER TABLE telegram_message_queue ENABLE ROW LEVEL SECURITY;;
