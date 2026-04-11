import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_thread_created_message
    ON projection_thread_messages(thread_id, created_at DESC, message_id DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_proposed_plans_thread_created_plan
    ON projection_thread_proposed_plans(thread_id, created_at DESC, plan_id DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_sequence_created
    ON projection_thread_activities(thread_id, sequence DESC, created_at DESC, activity_id DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_checkpoint_turn_count_desc
    ON projection_turns(thread_id, checkpoint_turn_count DESC)
  `;
});
