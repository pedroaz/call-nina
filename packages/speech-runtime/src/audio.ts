// Validate every Ogg page (including CRC, sequence and final EOS) before receipt
// acknowledgement. A prefix or truncated provider response is never cacheable.
export function validateSpeechAudio(data: Buffer): void {
  let offset = 0,
    serial: number | undefined,
    sequence = 0,
    ended = false,
    opus = false;
  while (offset < data.length) {
    if (
      ended ||
      offset + 27 > data.length ||
      data.toString("ascii", offset, offset + 4) !== "OggS" ||
      data[offset + 4] !== 0
    )
      throw new Error("OD_SPEECH_AUDIO_INVALID");
    const segments = data.readUInt8(offset + 26);
    if (offset + 27 + segments > data.length) throw new Error("OD_SPEECH_AUDIO_INVALID");
    let length = 27 + segments;
    for (let i = 0; i < segments; i++) length += data.readUInt8(offset + 27 + i);
    if (offset + length > data.length) throw new Error("OD_SPEECH_INCOMPLETE");
    const current = data.readUInt32LE(offset + 14);
    if (serial === undefined) {
      serial = current;
      if (!(data.readUInt8(offset + 5) & 2)) throw new Error("OD_SPEECH_AUDIO_INVALID");
    }
    if (current !== serial || data.readUInt32LE(offset + 18) !== sequence++)
      throw new Error("OD_SPEECH_AUDIO_INVALID");
    const expected = data.readUInt32LE(offset + 22);
    let crc = 0;
    for (let i = 0; i < length; i++) {
      const value = i >= 22 && i < 26 ? 0 : data.readUInt8(offset + i);
      crc ^= value << 24;
      for (let j = 0; j < 8; j++) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
    }
    if (crc !== expected) throw new Error("OD_SPEECH_INTEGRITY");
    if (offset === 0)
      opus =
        data.toString("ascii", offset + 27 + segments, offset + 27 + segments + 8) === "OpusHead";
    ended = Boolean(data.readUInt8(offset + 5) & 4);
    offset += length;
  }
  if (!ended || !opus) throw new Error("OD_SPEECH_INCOMPLETE");
}
