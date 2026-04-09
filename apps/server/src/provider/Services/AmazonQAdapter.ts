import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface AmazonQAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "amazonQ";
}

export class AmazonQAdapter extends ServiceMap.Service<AmazonQAdapter, AmazonQAdapterShape>()(
  "t3/provider/Services/AmazonQAdapter",
) {}
