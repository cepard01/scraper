export interface AlertMessage {
  title: string;
  body: string;
  tags: string[];
  priority: number;
  clickUrl: string;
}

export interface NotifyPort {
  send(m: AlertMessage): Promise<{ ok: boolean; error?: string }>;
}

export const NULL_NOTIFY_REASON = 'alertas desligados (sem NTFY_TOPIC)';

// A no-op that reports success would mark alerts as delivered when nothing left
// the machine. The port stays callable on a clean machine, but the failure is
// recorded honestly so the panel can show why no push arrived.
export function nullNotifier(): NotifyPort {
  return {
    async send() {
      return { ok: false, error: NULL_NOTIFY_REASON };
    },
  };
}
