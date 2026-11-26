import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 é nativo: o bundler do Next não pode reescrevê-lo.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
