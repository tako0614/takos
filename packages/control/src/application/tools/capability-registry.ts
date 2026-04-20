import type {
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityNamespace,
} from "./capability-types.ts";

export class CapabilityRegistry {
  private descriptors: Map<string, CapabilityDescriptor> = new Map();

  register(descriptor: CapabilityDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
  }

  registerAll(descriptors: CapabilityDescriptor[]): void {
    descriptors.forEach((d) => this.register(d));
  }

  all(): CapabilityDescriptor[] {
    return [...this.descriptors.values()];
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.descriptors.get(id);
  }

  byKind(kind: CapabilityKind): CapabilityDescriptor[] {
    return this.all().filter((d) => d.kind === kind);
  }

  byNamespace(ns: CapabilityNamespace): CapabilityDescriptor[] {
    return this.all().filter((d) => d.namespace === ns);
  }

  byFamily(family: string): CapabilityDescriptor[] {
    return this.all().filter((d) => d.family === family);
  }

  families(): { family: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const d of this.descriptors.values()) {
      if (d.family) counts.set(d.family, (counts.get(d.family) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }

  search(query: string, opts?: { limit?: number }): CapabilityDescriptor[] {
    const limit = opts?.limit ?? 20;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.all().slice(0, limit);

    const weights: [(_: CapabilityDescriptor) => string, number][] = [
      [(d) => d.name, 30],
      [(d) => d.tags.join(" "), 30],
      [(d) => (d.triggers ?? []).join(" "), 40],
      [(d) => d.summary, 20],
    ];

    return [...this.descriptors.values()]
      .map((d) => {
        let score = 0;
        for (const term of terms) {
          for (const [getText, weight] of weights) {
            if (getText(d).toLowerCase().includes(term)) score += weight;
          }
        }
        return { d, score };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((e) => e.d);
  }

  get size(): number {
    return this.descriptors.size;
  }
}
