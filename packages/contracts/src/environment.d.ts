export {};

// @ts-expect-error Shared contracts must not inherit Node.js ambient globals.
export type ContractsNodeProcessLeak = typeof process;
