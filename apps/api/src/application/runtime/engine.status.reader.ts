import type { EngineStatusResponse } from "@antidetect/contracts";

export abstract class EngineStatusReader {
  abstract read(): Promise<EngineStatusResponse>;
}
