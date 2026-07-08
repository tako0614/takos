import type { MobileProductAdapter } from "@takosjp/takosumi-mobile-kit";

export const productAdapter: MobileProductAdapter = {
  product: "takos",
  appName: "Takos",
  hostNoun: "Takos host",
  hostCenterLabel: "Host a new Takos workspace",
  hostCenterSource: {
    git: "https://github.com/tako0614/takos.git",
    ref: "a105afda57786cea79db8c50102a26a394a45229",
    path: "deploy/opentofu",
    name: "Takos",
  },
  urlPlaceholder: "https://workspace.example.com",
  primaryActionLabel: "Connect to Takos",
  accentColor: "#166534",
  mobileScheme: "takos",
  oidcClientId: "takos-mobile",
};
