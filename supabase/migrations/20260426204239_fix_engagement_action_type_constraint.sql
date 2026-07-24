ALTER TABLE engagement_actions DROP CONSTRAINT IF EXISTS engagement_actions_action_type_check;
ALTER TABLE engagement_actions ADD CONSTRAINT engagement_actions_action_type_check
  CHECK (action_type IN ('like', 'comment', 'like_and_comment', 'retweet'));;
