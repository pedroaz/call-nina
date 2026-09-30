# Optional offline artifacts

These artifacts are downloaded only on explicit request. They are separate from learner data and credentials. No weights or runtime executables are included in the ordinary app download.

## Provisional Qwen model

- Original model: [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a).
- Quantized distribution: [Unsloth Qwen3.5-4B-GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523). Unsloth identifies Qwen/Qwen3.5-4B as its base model; this is a third-party quantization, not an independently reproduced conversion.
- File: Qwen3.5-4B-Q4_K_M.gguf, 2,740,937,888 bytes, SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` (pinned Hugging Face LFS metadata).
- License: Apache-2.0, as declared by both pinned model cards. The upstream [license text](offline-model-license.txt) is reproduced without changes. Quantization is the distributor's modification; Nina does not modify the model file.

## Embedded inference runtime

- [llama.cpp b11273](https://github.com/ggml-org/llama.cpp/releases/tag/b11273), source revision `48de2a1bcb5b8fdbc8dc41b4c562850ab8d528d2`.
- Ubuntu x64 CPU archive, 17,409,397 bytes, SHA-256 `90cc40d42b1c49bcf48db28208ea68c11877cf0059ad34a0f8981a2152bef4c1` (GitHub release asset digest, also checked against downloaded bytes).
- [MIT license](offline-runtime-license.txt), copyright 2023–2026 The ggml authors. Only the server, required libraries and generic x64 CPU backend are installed. Library SONAME aliases are copied as regular files, not symbolic links. Unused tools and RPC executables are not installed.
- The Linux payload dynamically requires glibc 2.34 or newer, libstdc++ with GLIBCXX_3.4.30, OpenSSL 3, OpenMP and normal system runtime libraries according to non-executing ELF inspection. These host libraries are not redistributed by this download. No macOS, Windows, ARM, GPU, or universal Linux compatibility is claimed by this configuration.

The pinned sources and archive establish provenance and integrity, not absence of defects or teaching quality. No model inference, latency measurement, native execution or empirical hardware acceptance was performed for this configuration. The 8 GiB total / 4 GiB available RAM admission guards and 8,192-token context are provisional engineering limits, not measured minimum requirements. Candidate availability does not constitute approval of a production model.
