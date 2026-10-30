# Optional speech artifacts and licenses

Speech weights and runtimes are not included in the application installer. The catalog
in `packages/speech-runtime/src/catalog.json` pins voice files by upstream revision,
byte count and SHA-256. The Piper and Pocket TTS presets are approved for local use. Local playback requires
a validated installed runtime and voice files. This notice does not declare public
redistribution complete.

- [Piper](https://github.com/OHF-Voice/piper1-gpl), version 1.8.0: GPL-3.0.
  Redistributed runtime bundles must include applicable license/copyright notices and
  complete corresponding source for Piper and bundled GPL components, including
  eSpeak NG, under their actual licenses. The manual runtime preparer retains installed
  notices but does not complete the corresponding-source review/publication obligation.
- [Piper voices](https://huggingface.co/rhasspy/piper-voices/tree/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd):
  Thorsten (German), Cadu (Brazilian Portuguese), and Davefx (Spain Spanish) model cards
  identify CC0 datasets and disclose fine-tuning from Lessac. The Lessac US-English
  model card links a [research dataset license](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).
  Do not assume this grants commercial model redistribution. Voice-model and derivative
  provenance need review before availability is enabled.
- Additional downloadable Piper selections use the same pinned upstream revision: Kerstin
  (German, CC0 dataset, Ryan fine-tuning), Hi-Fi Captain male (US English,
  CC BY-NC-SA 4.0 dataset, Lessac fine-tuning), Faber (Brazilian Portuguese,
  CC0 dataset, Lessac fine-tuning), and MLS 10246 (Spanish, CC BY 4.0 dataset,
  Ryan fine-tuning). Each installation retains its upstream MODEL_CARD. The
  noncommercial and attribution/share-alike terms still apply; local availability
  does not grant unrestricted commercial use or redistribution.
- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts), version 4.0.1:
  engine code MIT; the [non-cloning model distribution](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)
  identifies CC BY 4.0. Attribute Kyutai, retain its model card and license references,
  identify any changes, and review preset voice attribution. Nina uses supplied preset
  embeddings only and does not accept voice recordings or user-supplied model URLs.
  The existing Alba preset is approved for local use with the English learning profile.
  The small downloadable selection additionally uses the pinned, language-specific
  supplied Anna (German), Marius (English), Lola (Portuguese), and Rafael (Spanish)
  embeddings from revision `a7056f505a4a8ca72d8b5fb1440071d6f1a35739`.
  Model weights, tokenizer and model card retain their existing pins; changing the
  voice never enables recording uploads or voice cloning.
- CPython standalone builds, ONNX Runtime, PyTorch CPU, NumPy, SciPy, SoundFile,
  libsndfile, Opus and other transitive dependencies retain their own terms. Exact
  versions and hashes are in the engine dependency locks; review the bundle's installed
  notices and corresponding-source obligations before publication. An engine's license
  does not override its dependencies' or voice assets' licenses.

Prepared curriculum recordings will use the pinned Google Cloud WaveNet voices.
Generation and distribution require the operator's applicable Google Cloud agreement.
Generated audio must be auditioned before publishing; no curriculum audio was generated
or published as part of local feature implementation.

Local bundles prepared by `make speech prepare` include dependency version inventories,
the pinned requirements lock, and installed dependency notices. Normal launches can
install these bundles into the selected learner root; installed runtime descriptors
keep playback independent of the preparation files. Legacy candidate installations
are migrated into normal model storage without changing their pinned artifacts.

No runtime binaries, voice files or corresponding source bundles are published by
this workflow. Lessac and derivative-model redistribution provenance, Piper/eSpeak
corresponding-source materials, and preset attribution remain publication work.
Model approval and local operation do not claim those distribution tasks are complete.
