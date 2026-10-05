export type Burn = Record<string, Array<[number, number]>>;
export declare function burnPath(home?: string): string;
export declare function readBurn(file?: string): Promise<Burn>;
export declare function writeBurn(burn: Burn, file?: string): Promise<void>;
/** Append one sample (30d prune / 1000-per-model cap via appendBurn); returns the new ledger. */
export declare function appendBurnStored(model: string, tokens: number, now?: number, file?: string): Promise<Burn>;
/** One-time migration: if burn.json is absent and legacy config.burn is non-empty, seed the file. */
export declare function migrateBurn(legacy: Burn | undefined, file?: string): Promise<Burn>;
