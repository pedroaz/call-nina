export type HostingEnvironment = "dev" | "prd";
export const hostingEnvironments: HostingEnvironment[];
export function hostingEnvironment(value?: string): HostingEnvironment;
export function vercelEnvironment(environment?: HostingEnvironment): "preview" | "production";
export function desktopEnvironmentPlugin(): {
  name: string;
  generateBundle(this: {
    emitFile(file: { type: "asset"; fileName: string; source: string }): unknown;
  }): void;
};
export function requireDesktopBuildEnvironment(environment: HostingEnvironment): void;
export function clientConfigurationPath(environment?: HostingEnvironment): string;
export function clientConfigurationAlias(): { find: RegExp; replacement: string };
export function requireClientConfiguration(environment?: HostingEnvironment): {
  environment: HostingEnvironment;
  publishableKey: string;
  serviceOrigin: string;
  modelId: string | null;
};
