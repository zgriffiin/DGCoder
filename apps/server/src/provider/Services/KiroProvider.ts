import { ServiceMap } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface KiroProviderShape extends ServerProviderShape {}

export class KiroProvider extends ServiceMap.Service<KiroProvider, KiroProviderShape>()(
  "t3/provider/Services/KiroProvider",
) {}
