import {
  correlationIdSchema,
  desktopIpcEventSchema,
  desktopIpcRequestSchema,
  desktopIpcResponseSchema,
  errorDefinitions,
  callNinaErrorSchema,
  type DesktopIpcChannel,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";

let sequence = 0;

function requestId() {
  sequence += 1;
  return correlationIdSchema.parse(
    `correlation_renderer${Date.now().toString(36)}${sequence.toString(36)}`,
  );
}

export function createDesktopSubmissionId() {
  return requestId();
}

type RequestMap = {
  [Channel in DesktopIpcChannel]: Extract<DesktopIpcRequest, { channel: Channel }>;
};
type ResponseMap = {
  [Channel in DesktopIpcChannel]: Extract<DesktopIpcResponse, { status: "ok"; channel: Channel }>;
};

export async function invokeDesktop<Channel extends DesktopIpcChannel>(
  channel: Channel,
  payload: RequestMap[Channel]["payload"],
): Promise<ResponseMap[Channel]["result"]> {
  const correlationId = requestId();
  let request: DesktopIpcRequest;
  try {
    request = desktopIpcRequestSchema.parse({ channel, requestId: correlationId, payload });
  } catch {
    throw transportError(correlationId);
  }
  let rawResponse: unknown;
  try {
    rawResponse = await window.callNina.invoke(request);
  } catch {
    throw transportError(request.requestId);
  }
  const parsedResponse = desktopIpcResponseSchema.safeParse(rawResponse);
  if (!parsedResponse.success) throw transportError(request.requestId);
  const response = parsedResponse.data;
  if (response.requestId !== request.requestId || response.channel !== request.channel) {
    throw transportError(request.requestId);
  }
  if (response.status === "error") throw new DesktopOperationError(response.error);
  const validatedResult: unknown = response.result;
  return validatedResult as ResponseMap[Channel]["result"];
}

function transportError(correlationId: string) {
  const definition = errorDefinitions.validation;
  return new DesktopOperationError(
    callNinaErrorSchema.parse({
      schemaVersion: 1,
      kind: "validation",
      code: definition.code,
      messageKey: definition.messageKey,
      reference: {
        code: definition.code,
        correlationId,
        occurredAt: new Date().toISOString(),
      },
    }),
  );
}

export function normalizeDesktopError(cause: unknown): DesktopOperationError {
  return cause instanceof DesktopOperationError ? cause : transportError(requestId());
}

export function subscribeDesktop(
  listener: (event: ReturnType<typeof desktopIpcEventSchema.parse>) => void,
) {
  return window.callNina.subscribe((value) => {
    listener(desktopIpcEventSchema.parse(value));
  });
}

export class DesktopOperationError extends Error {
  readonly detail: Extract<DesktopIpcResponse, { status: "error" }>["error"];

  constructor(detail: DesktopOperationError["detail"]) {
    super(detail.code);
    this.name = "DesktopOperationError";
    this.detail = detail;
  }
}
