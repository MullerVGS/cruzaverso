export type GateVerdict = "ok" | "ip-limited" | "global-limited";

export interface GenerationGateOptions {
  perIpPerMinute: number;
  globalPerHour: number;
  now?: () => number;
}

/**
 * Gerar um mundo custa alguns segundos de CPU síncrona e bloqueia o event loop
 * inteiro. O portão limita quantas gerações novas entram e garante que só uma
 * roda por vez, para uma seed nova não derrubar o dia de quem já está jogando.
 */
export class GenerationGate {
  private readonly perIpPerMinute: number;
  private readonly globalPerHour: number;
  private readonly now: () => number;
  private readonly perIp = new Map<string, number[]>();
  private global: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: GenerationGateOptions) {
    this.perIpPerMinute = options.perIpPerMinute;
    this.globalPerHour = options.globalPerHour;
    this.now = options.now ?? (() => Date.now());
  }

  tryAcquire(ip: string): GateVerdict {
    const instant = this.now();
    this.global = this.global.filter((stamp) => instant - stamp < 3_600_000);
    if (this.global.length >= this.globalPerHour) return "global-limited";
    const recent = (this.perIp.get(ip) ?? []).filter((stamp) => instant - stamp < 60_000);
    if (recent.length >= this.perIpPerMinute) {
      this.perIp.set(ip, recent);
      return "ip-limited";
    }
    recent.push(instant);
    this.perIp.set(ip, recent);
    this.global.push(instant);
    return "ok";
  }

  serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
