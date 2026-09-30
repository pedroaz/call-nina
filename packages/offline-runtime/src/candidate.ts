// Upstream metadata and release archive inspected 2026-09-30. No inference evidence.
export const offlineCandidate = Object.freeze({
  id: "qwen3.5-4b-q4-k-m-b11273",
  modelId: "qwen3.5-4b-q4-k-m",
  label: "Qwen3.5 4B (provisional)",
  license: "Apache-2.0",
  quality: "unverified" as const,
  platform: "linux-x64" as const,
  contextTokens: 8192,
  outputTokens: 2048,
  // Conservative admission limits, NOT measured minimum hardware requirements.
  minimumMemoryBytes: 8 * 1024 ** 3,
  minimumFreeMemoryBytes: 4 * 1024 ** 3,
  diskReserveBytes: 512 * 1024 ** 2,
  upstream: "https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a",
  quantization:
    "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523",
  runtimeSource:
    "https://github.com/ggml-org/llama.cpp/tree/48de2a1bcb5b8fdbc8dc41b4c562850ab8d528d2",
});
export const artifacts = Object.freeze({
  model: {
    file: "model.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
    bytes: 2740937888,
    sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
  },
  runtime: {
    file: "runtime.tar.gz",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b11273/llama-b11273-bin-ubuntu-x64.tar.gz",
    bytes: 17409397,
    sha256: "90cc40d42b1c49bcf48db28208ea68c11877cf0059ad34a0f8981a2152bef4c1",
  },
});
export type Artifact = (typeof artifacts)[keyof typeof artifacts];
// Only these regular archive members are installed. SONAME aliases are copies,
// never archive-controlled links; no CLI, RPC server or optional backend is staged.
export const runtimeFiles = Object.freeze([
  {
    source: "llama-server",
    file: "llama-server",
    bytes: 17864,
    sha256: "1e8e0c643801fd784b5ff1ea1c0c6ac31b9111dce08c59addc2453c34bc0fd9b",
  },
  {
    source: "libllama-server-impl.so",
    file: "libllama-server-impl.so",
    bytes: 7223552,
    sha256: "9bb6e41b1eb2a1b4d3f1fb30bb41a1601ed1ea2fc87c5718f2d919d98e95e4b8",
  },
  {
    source: "libllama.so.0.5.0",
    file: "libllama.so.0",
    bytes: 4661032,
    sha256: "76f5e61626cc60cf19d1081678f7359bd26380120801da7e824d36bbe4ea4332",
  },
  {
    source: "libllama-common.so.0.5.0",
    file: "libllama-common.so.0",
    bytes: 6345632,
    sha256: "d9f30943fa0d1fe8c1a7aaeaa0e60a65b2861c1957b40804dca8857300a92997",
  },
  {
    source: "libggml.so.0.25.3",
    file: "libggml.so.0",
    bytes: 55184,
    sha256: "569c53469aceca5dd357d2c3e1570014ed73e676abb08d44971be4cb784d855c",
  },
  {
    source: "libggml-base.so.0.25.3",
    file: "libggml-base.so.0",
    bytes: 930392,
    sha256: "4f136077e1bc9a0f51c7a040e7919d314729b8ed99e967f3705e02b7c868cb64",
  },
  {
    source: "libggml-cpu-x64.so",
    file: "libggml-cpu-x64.so",
    bytes: 934032,
    sha256: "f5b2b815695683770e85ee018bf2f246f74643b88e0dd03bf836a92f3cd59cb2",
  },
  {
    source: "libmtmd.so.0.5.0",
    file: "libmtmd.so.0",
    bytes: 1883608,
    sha256: "b3d595da8a27cc058b5e90176c12e34ea885aeba3593f3ad1f2e8f35e99f73f9",
  },
  {
    source: "LICENSE",
    file: "LICENSE",
    bytes: 1078,
    sha256: "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d",
  },
]);
export const downloadBytes = artifacts.model.bytes + artifacts.runtime.bytes;
export const installedBytes =
  downloadBytes + runtimeFiles.reduce((sum, file) => sum + file.bytes, 0);
