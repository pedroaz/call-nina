export type HostingEnvironment = "preview" | "production";
export const hostingEnvironments: HostingEnvironment[];
export function hostingEnvironment(value?: string): HostingEnvironment;
export function clientConfigurationPath(environment?: HostingEnvironment): string;
export function clientConfigurationAlias(): { find: RegExp; replacement: string };
export function requireClientConfiguration(environment?: HostingEnvironment): {
  environment: HostingEnvironment;
  publishableKey: string;
  serviceOrigin: string;
  modelId: string | null;
};
