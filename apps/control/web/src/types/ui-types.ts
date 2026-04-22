export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}
