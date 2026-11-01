import { z } from "../schema-system.js";
import {
  speechActionSchema,
  speechAvailabilitySchema,
  speechPlaybackRequestSchema,
  speechResultSchema,
  speechSnapshotSchema,
} from "../speech.js";
import { emptyPayload, request, response } from "./envelope.js";

export const speechRequests = [
  request("speech/availability", speechPlaybackRequestSchema.extend({ online: z.boolean() })),
  request("speech/read", emptyPayload),
  request("speech/manage", speechActionSchema),
  request("speech/synthesize", speechPlaybackRequestSchema),
] as const;

export const speechResponses = [
  response("speech/availability", speechAvailabilitySchema),
  response("speech/read", speechSnapshotSchema),
  response("speech/manage", speechSnapshotSchema),
  response("speech/synthesize", speechResultSchema),
] as const;
