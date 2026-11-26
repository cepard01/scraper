import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 é nativo: o bundler do Next não pode reescrevê-lo.
  serverExternalPackages: ['better-sqlite3'],
  // O harness já tem AGENTS.md na raiz; um bloco gerado por `next dev` dentro de
  // apps/web só criaria uma segunda fonte de instruções e dirty tree.
  agentRules: false,
};

export default config;
