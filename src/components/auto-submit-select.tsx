"use client";
import type { ComponentProps } from "react";

// A filter dropdown that applies as soon as an option is chosen (submits its form).
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
