import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

function isDuplicateColumnError(cause: unknown): boolean {
  return String(cause).toLowerCase().includes("duplicate column name: repository_identity_json");
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN repository_identity_json TEXT
  `.pipe(
    Effect.catchTag("SqlError", (cause) =>
      isDuplicateColumnError(cause) ? Effect.void : Effect.fail(cause),
    ),
  );
});
