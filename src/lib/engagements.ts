// Engagement statuses in plain words (front office batch, section 9; mockup 5-Engagements). Pure.
export function engagementStatus(status: string): { label: string; cls: string } {
  switch (status) {
    case "EL drafted": return { label: "Draft", cls: "bg-sand-100 text-ink-3" };
    case "EL sent": return { label: "Waiting for signature", cls: "bg-navy-50 text-navy-700" };
    case "EL signed": return { label: "Active", cls: "bg-success-soft text-success" };
    case "Draft package sent": return { label: "Active: draft package sent", cls: "bg-success-soft text-success" };
    case "MAL signed": return { label: "Active: MAL signed", cls: "bg-success-soft text-success" };
    case "Issued": return { label: "Issued", cls: "bg-success-soft text-success" };
    case "On hold": return { label: "On hold", cls: "bg-warning-soft text-warning" };
    case "Client left": case "Cancelled": return { label: status === "Cancelled" ? "Cancelled" : "Client left", cls: "bg-danger/10 text-danger" };
    case "Ended": return { label: "Ended", cls: "bg-sand-100 text-ink-3" };
    default: return { label: status, cls: "bg-sand-100 text-ink-3" };
  }
}

// Came from: set on signing; older engagements were recorded before Studio or from a letter PDF.
export function cameFrom(e: { came_from?: string | null; el_version?: string | null }): string {
  if (e.came_from) return e.came_from;
  return /pre-studio/i.test(e.el_version ?? "") || !e.el_version ? "Before Studio" : "Letter (signed outside Studio)";
}
