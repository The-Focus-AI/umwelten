import { MemoryStore } from "./memory-store.js";
import { runExchangeStoreConformance } from "./conformance.js";

runExchangeStoreConformance("MemoryStore", async () => new MemoryStore());
