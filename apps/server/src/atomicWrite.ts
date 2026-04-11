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
  let createdBackup = false;

  const retryDelay = (attempt: number) => Effect.sleep(Duration.millis(25 * (attempt + 1)));

  const renameWithTransientRetry = (
    sourcePath: string,
    targetPath: string,
    attempt = 0,
  ): Effect.Effect<void, PlatformError.PlatformError> =>
    input.fileSystem
      .rename(sourcePath, targetPath)
      .pipe(
        Effect.catchIf(isTransientWindowsRenameError, (cause) =>
          attempt >= 4
            ? Effect.fail(cause as PlatformError.PlatformError)
            : retryDelay(attempt).pipe(
                Effect.andThen(renameWithTransientRetry(sourcePath, targetPath, attempt + 1)),
              ),
        ),
      );

  const restoreBackup = () =>
    createdBackup
      ? input.fileSystem.exists(backupPath).pipe(
          Effect.flatMap((exists) =>
            exists ? renameWithTransientRetry(backupPath, input.filePath) : Effect.void,
          ),
          Effect.tap(() => Effect.sync(() => void (createdBackup = false))),
          Effect.ignore,
        )
      : Effect.void;

  const failWithRestore = (cause: PlatformError.PlatformError) =>
    restoreBackup().pipe(Effect.andThen(Effect.fail(cause)));

  const swapIntoPlace: Effect.Effect<void, PlatformError.PlatformError> = Effect.gen(function* () {
    const existingFile = yield* input.fileSystem.exists(input.filePath);
    if (!existingFile) {
      yield* renameWithTransientRetry(tempPath, input.filePath);
      return;
    }

    yield* input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore);
    yield* renameWithTransientRetry(input.filePath, backupPath);
    createdBackup = true;

    yield* renameWithTransientRetry(tempPath, input.filePath).pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          createdBackup = false;
          yield* input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore);
        }),
      ),
      Effect.catch((cause) => failWithRestore(cause)),
    );
  });

  const renameIntoPlace = (attempt = 0): Effect.Effect<void, PlatformError.PlatformError> =>
    swapIntoPlace.pipe(
      Effect.catchIf(isTransientWindowsRenameError, (cause) =>
        attempt >= 4
          ? Effect.fail(cause as PlatformError.PlatformError)
          : retryDelay(attempt).pipe(Effect.andThen(renameIntoPlace(attempt + 1))),
      ),
    );

  return Effect.void.pipe(
    Effect.tap(() =>
      input.fileSystem.makeDirectory(input.path.dirname(input.filePath), { recursive: true }),
    ),
    Effect.tap(() => input.fileSystem.remove(backupPath, { force: true }).pipe(Effect.ignore)),
    Effect.tap(() => input.fileSystem.writeFileString(tempPath, input.contents)),
    Effect.flatMap(() => renameIntoPlace()),
    Effect.catch((cause) => failWithRestore(cause)),
    Effect.ensuring(
      input.fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true })),
    ),
  );
}
