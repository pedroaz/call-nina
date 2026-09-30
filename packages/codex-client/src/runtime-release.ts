// Official release assets, reviewed at https://github.com/openai/codex/releases/tag/rust-v0.159.2.
// Update these together; runtime updates travel with Nina, never through a background updater.
export const codexRuntimeVersion = "0.159.2";
export const codexRuntimeTargets = {
  "linux-x64": {
    target: "x86_64-unknown-linux-musl",
    sha256: "07c7f808615d1ef3b04d295fbe53ba57f3391358a25c5575efdec277b2cf8d41",
  },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    sha256: "8a0f3fdcae1a745bf03be2a927e8313e3f18e43a616aabedc2cc1bff96bcbf45",
  },
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "099ef6a3c097c4612aa2d1f284ab31456bcf998a336e98711ccfccb52b44a486",
  },
  "win32-x64": {
    target: "x86_64-pc-windows-msvc",
    sha256: "9035119edd9717883f15f23704757e41e2fbff7fad3d2123f140b63a92ddc6e8",
  },
} as const;
