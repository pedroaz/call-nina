import type { DatabaseSync } from "node:sqlite";
import { originatingDeviceIdSchema } from "@call-nina/contracts";

const devices = new WeakMap<DatabaseSync, string>();
export function bindOriginatingDevice(connection: DatabaseSync, deviceId: string) {
  devices.set(connection, originatingDeviceIdSchema.parse(deviceId));
}
export function originatingDevice(connection: DatabaseSync): string {
  const device = devices.get(connection);
  if (!device) throw new Error("OD_ATTEMPT_DEVICE_MISSING");
  return device;
}
