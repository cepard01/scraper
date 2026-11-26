// Porto de entrega: o domínio monta a mensagem, o worker escolhe o transporte.
// Hoje o único transporte real é ntfy; a implementação permanece trocável.
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

// Um no-op que reporta sucesso faria o banco acreditar numa entrega que nunca
// saiu da máquina. Sem tópico o porto continua chamável, mas falha honestamente.
export function nullNotifier(): NotifyPort {
  return {
    async send() {
      return { ok: false, error: NULL_NOTIFY_REASON };
    },
  };
}
