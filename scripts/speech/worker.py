"""Offline, preset-only worker. The parent owns deadlines and process lifetime."""
import base64
import io
import json
import os
from pathlib import Path
import resource
import socket
import sys

# Library diagnostics must never become protocol messages.
protocol = sys.stdout
sys.stdout = sys.stderr
def emit(message):
    print(json.dumps(message), file=protocol, flush=True)

# Bound virtual memory and CPU parallelism before importing numerical libraries.
resource.setrlimit(resource.RLIMIT_AS, (8 * 1024**3, 8 * 1024**3))
if hasattr(os, "sched_getaffinity"):
    os.sched_setaffinity(0, set(sorted(os.sched_getaffinity(0))[:2]))
os.environ.update(OMP_NUM_THREADS="2", OPENBLAS_NUM_THREADS="2", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
def offline(*args, **kwargs):
    raise RuntimeError("OD_SPEECH_OFFLINE")
socket.create_connection = offline
socket.socket.connect = offline
root, engine, language = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
import soundfile as sf
import numpy as np
if engine == "piper":
    from piper import PiperVoice
    model = PiperVoice.load(root / "model.onnx", use_cuda=False)
    def synthesize(text):
        for chunk in model.synthesize(text):
            yield chunk.audio_float_array, model.config.sample_rate
elif engine == "pocket":
    import torch
    from pocket_tts import TTSModel
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    import yaml
    from pocket_tts.utils.config import CONFIGS_DIR
    names = {"de": "german", "en-US": "english", "pt-BR": "portuguese", "es": "spanish"}
    config = yaml.safe_load((CONFIGS_DIR / (names[language] + ".yaml")).read_text())
    config["weights_path"] = str(root / "model.safetensors")
    config["weights_path_without_voice_cloning"] = str(root / "model.safetensors")
    config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(root / "tokenizer.json")
    config_path = root / "local-config.yaml"
    temporary = root / "local-config.yaml.new"
    temporary.write_text(yaml.safe_dump(config))
    temporary.replace(config_path)
    model = TTSModel.load_model(config=str(config_path))
    model.has_voice_cloning = False
    voice = model.get_state_for_audio_prompt(str(root / "voice.safetensors"))
    def synthesize(text):
        with torch.no_grad():
            for chunk in model.generate_audio_stream(voice, text):
                yield chunk.numpy(), model.sample_rate
else:
    raise RuntimeError("OD_SPEECH_ENGINE_UNKNOWN")
def encode(samples, rate):
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all():
        raise ValueError()
    if rate not in (8000, 12000, 16000, 24000, 48000):
        samples = np.interp(np.arange(round(len(samples)*24000/rate))*rate/24000, np.arange(len(samples)), samples)
        rate = 24000
    output = io.BytesIO()
    sf.write(output, samples, rate, format="OGG", subtype="OPUS")
    return base64.b64encode(output.getvalue()).decode("ascii")
emit({"ready": True})
for line in sys.stdin:
    try:
        request = json.loads(line)
        text = request["text"]
        if not isinstance(text, str) or not 0 < len(text) <= 6000 or not text.strip():
            raise ValueError()
        completed, pending, count, rate, total = [], [], 0, None, 0
        for samples, rate in synthesize(text):
            samples = np.asarray(samples, dtype=np.float32)
            if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all():
                raise ValueError()
            total += samples.size
            if total > rate * 20 * 60:
                raise ValueError()
            completed.append(samples)
            pending.append(samples)
            count += len(samples)
            # One second of PCM amortizes Opus headers without waiting for the
            # whole utterance. The complete recording is emitted only at EOS.
            if count >= rate:
                emit({"chunk": encode(np.concatenate(pending), rate)})
                pending, count = [], 0
        if pending:
            emit({"chunk": encode(np.concatenate(pending), rate)})
        emit({"audio": encode(np.concatenate(completed), rate)})
    except Exception:
        emit({"error": "OD_SPEECH_ENGINE_FAILED"})
