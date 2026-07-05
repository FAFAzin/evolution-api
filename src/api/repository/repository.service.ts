import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaClient } from '@prisma/client';

export class Query<T> {
  where?: T;
  sort?: 'asc' | 'desc';
  page?: number;
  offset?: number;
}

/**
 * [vendora fork] Impõe um teto de conexões no pool do Prisma. max_connections
 * do Postgres é do servidor inteiro; sem teto, o pool default (num_cpus*2+1)
 * soma com outros consumidores do mesmo banco e estoura ("too many clients").
 * Default 5; override via EVOLUTION_DB_CONNECTION_LIMIT. No-op se a URI já tem
 * connection_limit ou se DATABASE_CONNECTION_URI não está setada.
 */
function cappedDbUrl(): string | undefined {
  const base = process.env.DATABASE_CONNECTION_URI;
  if (!base || /[?&]connection_limit=/.test(base)) return undefined;
  const limit = process.env.EVOLUTION_DB_CONNECTION_LIMIT || '5';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}connection_limit=${limit}`;
}

export class PrismaRepository extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    const url = cappedDbUrl();
    super(url ? { datasources: { db: { url } } } : {});
  }

  private readonly logger = new Logger('PrismaRepository');

  public async onModuleInit() {
    await this.$connect();
    this.logger.info('Repository:Prisma - ON');
  }

  public async onModuleDestroy() {
    await this.$disconnect();
    this.logger.warn('Repository:Prisma - OFF');
  }
}
