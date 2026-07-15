import type { MobileProductAdapter } from "@takosjp/takosumi-mobile-kit";

export const productAdapter: MobileProductAdapter = {
  product: "takos",
  appName: "Takos",
  hostNoun: "Takos host",
  urlPlaceholder: "https://workspace.example.com",
  primaryActionLabel: "Connect to Takos",
  accentColor: "#166534",
  mobileScheme: "takos",
  oidcScopes: [
    "openid",
    "profile",
    "offline_access",
    "spaces:read",
    "spaces:write",
    "threads:read",
    "threads:write",
    "runs:read",
    "runs:write",
    "agents:execute",
    "memories:read",
    "memories:write",
  ],
};
