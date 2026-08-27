-- Hand-authored migration (not generated from src/db/schema/**, since
-- Drizzle's TypeScript schema cannot express trigger logic).
--
-- Enforces at the database level - not just application discipline - that
-- forum_post.raw_content and the source-identity columns (forum_pid,
-- forum_user_id, posted_at) can never change after insert. clean_content,
-- moderation_status, the quality/leak metadata columns, source_diverged(+at)
-- and updated_at remain freely editable (clean_content edits are
-- additionally captured in forum_post_revision by the application before
-- being overwritten).
--> statement-breakpoint
CREATE FUNCTION forum_post_prevent_immutable_field_update() RETURNS trigger AS $$
BEGIN
  IF NEW.raw_content IS DISTINCT FROM OLD.raw_content THEN
    RAISE EXCEPTION 'forum_post.raw_content is immutable and cannot be updated (post id %)', OLD.id;
  END IF;
  IF NEW.forum_pid IS DISTINCT FROM OLD.forum_pid THEN
    RAISE EXCEPTION 'forum_post.forum_pid is immutable and cannot be updated (post id %)', OLD.id;
  END IF;
  IF NEW.forum_user_id IS DISTINCT FROM OLD.forum_user_id THEN
    RAISE EXCEPTION 'forum_post.forum_user_id is immutable and cannot be updated (post id %)', OLD.id;
  END IF;
  IF NEW.posted_at IS DISTINCT FROM OLD.posted_at THEN
    RAISE EXCEPTION 'forum_post.posted_at is immutable and cannot be updated (post id %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER forum_post_immutable_fields_trigger
  BEFORE UPDATE ON "forum_post"
  FOR EACH ROW
  EXECUTE FUNCTION forum_post_prevent_immutable_field_update();
