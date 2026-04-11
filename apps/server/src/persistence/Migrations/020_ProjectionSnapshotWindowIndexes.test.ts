import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("020_ProjectionSnapshotWindowIndexes", (it) => {
  it.effect("creates indexes that support bounded per-thread replay windows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 19 });
      yield* runMigrations({ toMigrationInclusive: 20 });

      const messageIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_messages)
      `;
      assert.ok(
        messageIndexes.some(
          (index) => index.name === "idx_projection_thread_messages_thread_created_message",
        ),
      );

      const messageIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_messages_thread_created_message')
      `;
      assert.deepStrictEqual(
        messageIndexColumns.map((column) => column.name),
        ["thread_id", "created_at", "message_id"],
      );

      const planIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_proposed_plans)
      `;
      assert.ok(
        planIndexes.some(
          (index) => index.name === "idx_projection_thread_proposed_plans_thread_created_plan",
        ),
      );

      const planIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_proposed_plans_thread_created_plan')
      `;
      assert.deepStrictEqual(
        planIndexColumns.map((column) => column.name),
        ["thread_id", "created_at", "plan_id"],
      );

      const activityIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_thread_activities)
      `;
      assert.ok(
        activityIndexes.some(
          (index) => index.name === "idx_projection_thread_activities_thread_sequence_created",
        ),
      );

      const activityIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_thread_activities_thread_sequence_created')
      `;
      assert.deepStrictEqual(
        activityIndexColumns.map((column) => column.name),
        ["thread_id", "sequence", "created_at", "activity_id"],
      );

      const checkpointIndexes = yield* sql<{
        readonly seq: number;
        readonly name: string;
        readonly unique: number;
        readonly origin: string;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_turns)
      `;
      assert.ok(
        checkpointIndexes.some(
          (index) => index.name === "idx_projection_turns_thread_checkpoint_turn_count_desc",
        ),
      );

      const checkpointIndexColumns = yield* sql<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string;
      }>`
        PRAGMA index_info('idx_projection_turns_thread_checkpoint_turn_count_desc')
      `;
      assert.deepStrictEqual(
        checkpointIndexColumns.map((column) => column.name),
        ["thread_id", "checkpoint_turn_count"],
      );
    }),
  );
});
