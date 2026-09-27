export {};

// @ts-expect-error Domain rules must remain portable and Node-independent.
export type DomainNodeProcessLeak = typeof process;
