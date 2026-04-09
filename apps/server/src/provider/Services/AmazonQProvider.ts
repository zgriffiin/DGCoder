import { ServiceMap } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface AmazonQProviderShape extends ServerProviderShape {}

export class AmazonQProvider extends ServiceMap.Service<AmazonQProvider, AmazonQProviderShape>()(
  "t3/provider/Services/AmazonQProvider",
) {}
