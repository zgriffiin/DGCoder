import { Duration, Effect, type FileSystem, type Path, PlatformError } from "effect";

const DEFAULT_BACKUP_SUFFIX = ".bak";

function isTransientWindowsRenameError(
  cause: unknown,
): cause is { readonly code?: string | undefined } {
  if (process.platform !== "win32" || typeof cause !== "object" || cause === null) {
    return false;
  }
  const code = "code" in cause ? cause.code : undefined;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

export function writeFileStringAtomically(input: {
  readonly filePath: string;
  readonly contents: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly backupSuffix?: string;
}): Effect.Effect<void, PlatformError.PlatformError> {
  const backupSuffix = input.backupSuffix ?? DEFAULT_BACKUP_SUFFIX;
  const tempPath = `${input.filePath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${input.filePath}${backupSuffix}`;

  const restoreBackup = input.fileSystem.exists(backupPath).pipe(
    Effect.flatMap((exists) =>
      exists ? input.fileSystem.rename(backupPath, input.filePath) : Effect.void,
    ),
    Effect.ignore,
  );

  const renameIntoPlace = (attempt = 0): Effect.Effect<void, PlatformError.PlatformError> =>
    input.fileSystem.rename(tempPath, input.filePath).pipe(
      Effect.catchIf(isTransientWindowsRenameError, (cause) => {
        if (attempt >= 4) {
          return Effect.fail(cause);
        }

        return Effect.gen(function* () {
          const existingFile = yield* input.fileSystem.exists(input.filePath);
          if (!existingFile) {
            yield* Effect.sleep(Duration.millis(25 * (attempt + 1)));
            return yield* renameIntoPlace(attempt + 1);
          }

          yield* input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore);
          yield* input.fileSystem.rename(input.filePath, backupPath);

          const renameResult = yield* Effect.result(
            input.fileSystem.rename(tempPath, input.filePath),
          );
          if (renameResult._tag === "Success") {
            yield* input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore);
            return;
          }

          yield* restoreBackup;
          if (!isTransientWindowsRenameError(renameResult.failure) || attempt >= 4) {
            return yield* renameResult.failure;
          }

          yield* Effect.sleep(Duration.millis(25 * (attempt + 1)));
          return yield* renameIntoPlace(attempt + 1);
        });
      }),
    );

  return Effect.void.pipe(
    Effect.tap(() =>
      input.fileSystem.makeDirectory(input.path.dirname(input.filePath), { recursive: true }),
    ),
    Effect.tap(() => input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore)),
    Effect.tap(() => input.fileSystem.writeFileString(tempPath, input.contents)),
    Effect.flatMap(() => renameIntoPlace()),
    Effect.ensuring(
      Effect.all(
        [
          input.fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true })),
          restoreBackup,
        ],
        { discard: true },
      ),
    ),
  );
}
