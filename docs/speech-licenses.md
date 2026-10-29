# Optional speech artifacts and licenses

Speech weights and runtimes are not included in the application installer. The catalog
in `packages/speech-runtime/src/catalog.json` pins candidate files by upstream revision,
byte count and SHA-256. All candidates are currently unavailable pending qualification;
this notice is not a declaration that redistribution has been approved.

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
- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts), version 4.0.1:
  engine code MIT; the [non-cloning model distribution](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)
  identifies CC BY 4.0. Attribute Kyutai, retain its model card and license references,
  identify any changes, and review preset voice attribution. Nina uses supplied preset
  embeddings only and does not accept voice recordings or user-supplied model URLs.
  Alba is an unqualified candidate for US-English pronunciation, not an approved accent.
- CPython standalone builds, ONNX Runtime, PyTorch CPU, NumPy, SciPy, SoundFile,
  libsndfile, Opus and other transitive dependencies retain their own terms. Exact
  versions and hashes are in the engine dependency locks; review the bundle's installed
  notices and corresponding-source obligations before publication. An engine's license
  does not override its dependencies' or voice assets' licenses.

Prepared curriculum recordings will use the pinned Google Cloud WaveNet voices.
Generation and distribution require the operator's applicable Google Cloud agreement.
Generated audio must be auditioned before publishing; no curriculum audio was generated
or published as part of local feature implementation.
