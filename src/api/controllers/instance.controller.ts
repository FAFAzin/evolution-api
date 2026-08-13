import { ImportSessionDto } from '@api/dto/import-session.dto';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository } from '@api/repository/repository.service';
import { channelController, eventManager } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { SettingsService } from '@api/services/settings.service';
import { Events, Integration, wa } from '@api/types/wa.types';
import { Auth, CacheConf, Chatwoot, ConfigService, HttpServer, ProviderSession, WaBusiness } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, UnauthorizedException } from '@exceptions';
import { delay } from 'baileys';
import { isArray, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';

import { ProxyController } from './proxy.controller';

export class InstanceController {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatwootService: ChatwootService,
    private readonly settingsService: SettingsService,
    private readonly proxyService: ProxyController,
    private readonly cache: CacheService,
    private readonly chatwootCache: CacheService,
    private readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles,
  ) {}

  private readonly logger = new Logger('InstanceController');

  public async createInstance(instanceData: InstanceDto) {
    try {
      instanceData.instanceName = instanceData.instanceName?.trim();

      const instance = channelController.init(instanceData, {
        configService: this.configService,
        eventEmitter: this.eventEmitter,
        prismaRepository: this.prismaRepository,
        cache: this.cache,
        chatwootCache: this.chatwootCache,
        baileysCache: this.baileysCache,
        providerFiles: this.providerFiles,
      });

      if (!instance) {
        throw new BadRequestException('Invalid integration');
      }

      const instanceId = v4();

      instanceData.instanceId = instanceId;

      let hash: string;

      if (!instanceData.token) hash = v4().toUpperCase();
      else hash = instanceData.token;

      await this.waMonitor.saveInstance({
        instanceId,
        integration: instanceData.integration,
        instanceName: instanceData.instanceName,
        ownerJid: instanceData.ownerJid,
        profileName: instanceData.profileName,
        profilePicUrl: instanceData.profilePicUrl,
        hash,
        number: instanceData.number,
        businessId: instanceData.businessId,
        status: instanceData.status,
      });

      instance.setInstance({
        instanceName: instanceData.instanceName,
        instanceId,
        integration: instanceData.integration,
        token: hash,
        number: instanceData.number,
        businessId: instanceData.businessId,
      });

      this.waMonitor.waInstances[instance.instanceName] = instance;
      this.waMonitor.delInstanceTime(instance.instanceName);

      // set events
      await eventManager.setInstance(instance.instanceName, instanceData);

      instance.sendDataWebhook(Events.INSTANCE_CREATE, {
        instanceName: instanceData.instanceName,
        instanceId: instanceId,
      });

      const instanceDto: InstanceDto = {
        instanceName: instance.instanceName,
        instanceId: instance.instanceId,
        connectionStatus:
          typeof instance.connectionStatus === 'string'
            ? instance.connectionStatus
            : instance.connectionStatus?.state || 'unknown',
      };

      if (instanceData.proxyHost && instanceData.proxyPort && instanceData.proxyProtocol) {
        const testProxy = await this.proxyService.testProxy({
          host: instanceData.proxyHost,
          port: instanceData.proxyPort,
          protocol: instanceData.proxyProtocol,
          username: instanceData.proxyUsername,
          password: instanceData.proxyPassword,
        });
        if (!testProxy) {
          throw new BadRequestException('Invalid proxy');
        }
        await this.proxyService.createProxy(instanceDto, {
          enabled: true,
          host: instanceData.proxyHost,
          port: instanceData.proxyPort,
          protocol: instanceData.proxyProtocol,
          username: instanceData.proxyUsername,
          password: instanceData.proxyPassword,
        });
      }

      const settings: wa.LocalSettings = {
        rejectCall: instanceData.rejectCall === true,
        msgCall: instanceData.msgCall || '',
        groupsIgnore: instanceData.groupsIgnore === true,
        alwaysOnline: instanceData.alwaysOnline === true,
        readMessages: instanceData.readMessages === true,
        readStatus: instanceData.readStatus === true,
        syncFullHistory: instanceData.syncFullHistory === true,
        wavoipToken: instanceData.wavoipToken || '',
      };

      await this.settingsService.create(instanceDto, settings);

      let webhookWaBusiness = null,
        accessTokenWaBusiness = '';

      if (instanceData.integration === Integration.WHATSAPP_BUSINESS) {
        if (!instanceData.number) {
          throw new BadRequestException('number is required');
        }
        const urlServer = this.configService.get<HttpServer>('SERVER').URL;
        webhookWaBusiness = `${urlServer}/webhook/meta`;
        accessTokenWaBusiness = this.configService.get<WaBusiness>('WA_BUSINESS').TOKEN_WEBHOOK;
      }

      if (!instanceData.chatwootAccountId || !instanceData.chatwootToken || !instanceData.chatwootUrl) {
        let getQrcode: wa.QrCode;

        if (instanceData.qrcode && instanceData.integration === Integration.WHATSAPP_BAILEYS) {
          await instance.connectToWhatsapp(instanceData.number);
          await delay(5000);
          getQrcode = instance.qrCode;
        }

        if (instanceData.integration === Integration.EVOLUTION) {
          await instance.connectToWhatsapp();
        }

        const result = {
          instance: {
            instanceName: instance.instanceName,
            instanceId: instanceId,
            integration: instanceData.integration,
            webhookWaBusiness,
            accessTokenWaBusiness,
            status:
              typeof instance.connectionStatus === 'string'
                ? instance.connectionStatus
                : instance.connectionStatus?.state || 'unknown',
          },
          hash,
          webhook: {
            webhookUrl: instanceData?.webhook?.url,
            webhookHeaders: instanceData?.webhook?.headers,
            webhookByEvents: instanceData?.webhook?.byEvents,
            webhookBase64: instanceData?.webhook?.base64,
          },
          websocket: {
            enabled: instanceData?.websocket?.enabled,
          },
          rabbitmq: {
            enabled: instanceData?.rabbitmq?.enabled,
          },
          nats: {
            enabled: instanceData?.nats?.enabled,
          },
          sqs: {
            enabled: instanceData?.sqs?.enabled,
          },
          settings,
          qrcode: getQrcode,
        };

        return result;
      }

      if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED)
        throw new BadRequestException('Chatwoot is not enabled');

      if (!instanceData.chatwootAccountId) {
        throw new BadRequestException('accountId is required');
      }

      if (!instanceData.chatwootToken) {
        throw new BadRequestException('token is required');
      }

      if (!instanceData.chatwootUrl) {
        throw new BadRequestException('url is required');
      }

      if (!isURL(instanceData.chatwootUrl, { require_tld: false })) {
        throw new BadRequestException('Invalid "url" property in chatwoot');
      }

      if (instanceData.chatwootSignMsg !== true && instanceData.chatwootSignMsg !== false) {
        throw new BadRequestException('signMsg is required');
      }

      if (instanceData.chatwootReopenConversation !== true && instanceData.chatwootReopenConversation !== false) {
        throw new BadRequestException('reopenConversation is required');
      }

      if (instanceData.chatwootConversationPending !== true && instanceData.chatwootConversationPending !== false) {
        throw new BadRequestException('conversationPending is required');
      }

      const urlServer = this.configService.get<HttpServer>('SERVER').URL;

      try {
        this.chatwootService.create(instanceDto, {
          enabled: true,
          accountId: instanceData.chatwootAccountId,
          token: instanceData.chatwootToken,
          url: instanceData.chatwootUrl,
          signMsg: instanceData.chatwootSignMsg || false,
          nameInbox: instanceData.chatwootNameInbox ?? instance.instanceName.split('-cwId-')[0],
          number: instanceData.number,
          reopenConversation: instanceData.chatwootReopenConversation || false,
          conversationPending: instanceData.chatwootConversationPending || false,
          importContacts: instanceData.chatwootImportContacts ?? true,
          mergeBrazilContacts: instanceData.chatwootMergeBrazilContacts ?? false,
          importMessages: instanceData.chatwootImportMessages ?? true,
          daysLimitImportMessages: instanceData.chatwootDaysLimitImportMessages ?? 60,
          organization: instanceData.chatwootOrganization,
          logo: instanceData.chatwootLogo,
          autoCreate: instanceData.chatwootAutoCreate !== false,
        });
      } catch (error) {
        this.logger.log(error);
      }

      return {
        instance: {
          instanceName: instance.instanceName,
          instanceId: instanceId,
          integration: instanceData.integration,
          webhookWaBusiness,
          accessTokenWaBusiness,
          status:
            typeof instance.connectionStatus === 'string'
              ? instance.connectionStatus
              : instance.connectionStatus?.state || 'unknown',
        },
        hash,
        webhook: {
          webhookUrl: instanceData?.webhook?.url,
          webhookHeaders: instanceData?.webhook?.headers,
          webhookByEvents: instanceData?.webhook?.byEvents,
          webhookBase64: instanceData?.webhook?.base64,
        },
        websocket: {
          enabled: instanceData?.websocket?.enabled,
        },
        rabbitmq: {
          enabled: instanceData?.rabbitmq?.enabled,
        },
        nats: {
          enabled: instanceData?.nats?.enabled,
        },
        sqs: {
          enabled: instanceData?.sqs?.enabled,
        },
        settings,
        chatwoot: {
          enabled: true,
          accountId: instanceData.chatwootAccountId,
          token: instanceData.chatwootToken,
          url: instanceData.chatwootUrl,
          signMsg: instanceData.chatwootSignMsg || false,
          reopenConversation: instanceData.chatwootReopenConversation || false,
          conversationPending: instanceData.chatwootConversationPending || false,
          mergeBrazilContacts: instanceData.chatwootMergeBrazilContacts ?? false,
          importContacts: instanceData.chatwootImportContacts ?? true,
          importMessages: instanceData.chatwootImportMessages ?? true,
          daysLimitImportMessages: instanceData.chatwootDaysLimitImportMessages || 60,
          number: instanceData.number,
          nameInbox: instanceData.chatwootNameInbox ?? instance.instanceName,
          webhookUrl: `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`,
        },
      };
    } catch (error) {
      this.waMonitor.deleteInstance(instanceData.instanceName);
      this.logger.error(isArray(error.message) ? error.message[0] : error.message);
      throw new BadRequestException(isArray(error.message) ? error.message[0] : error.message);
    }
  }

  public async connectToWhatsapp({ instanceName, number = null }: InstanceDto) {
    try {
      const instance = this.waMonitor.waInstances[instanceName];
      const state = instance?.connectionStatus?.state;

      if (!state) {
        throw new BadRequestException('The "' + instanceName + '" instance does not exist');
      }

      if (state == 'open') {
        return await this.connectionState({ instanceName });
      }

      if (state == 'connecting') {
        // vendora patch: a number on /instance/connect while the QR cycle is
        // already running means "give me a pairing code" — generate it on the
        // live socket instead of returning the memoized qrCode without one.
        if (number && typeof instance.requestPairingCode === 'function') {
          await instance.requestPairingCode(number);
        }
        return instance.qrCode;
      }

      if (state == 'close') {
        await instance.connectToWhatsapp(number);

        await delay(2000);
        return instance.qrCode;
      }

      return {
        instance: {
          instanceName: instanceName,
          status: state,
        },
        qrcode: instance?.qrCode,
      };
    } catch (error) {
      this.logger.error(error);
      return { error: true, message: error.toString() };
    }
  }

  // ── vendora patch: browser-session bridge (Shortcake passkey workaround) ────
  // For accounts flagged by Meta's passkey linking, headless pairing cannot
  // complete. The escape hatch (mirrors Z-API's ConnectorZ) is to log the
  // account into real web.whatsapp.com, extract the session, and inject it here.
  // exportSession is the reference format + the round-trip test hook;
  // importSession writes creds in the exact double-encoded shape the Prisma
  // auth-state loader expects, then reloads the socket. Both require the GLOBAL
  // API key — exfiltrating creds is a stronger capability than an instance
  // token (a cloned session survives token rotation). Details: VENDORA-PATCHES.md
  // and docs/brain/runbooks/whatsapp-passkey-pairing.md in the vendora repo.

  private assertGlobalKey(key: string) {
    const globalKey = this.configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
    if (!key || key !== globalKey) {
      throw new UnauthorizedException('Session bridge requires the global API key');
    }
  }

  // The bridge reads/writes ONLY the Prisma Session table. defineAuthState()
  // picks the store by config, so if creds actually live in Redis or an external
  // provider the import would be a silent no-op. Fail loudly instead.
  private assertPrismaAuthStore() {
    const provider = this.configService.get<ProviderSession>('PROVIDER');
    const cache = this.configService.get<CacheConf>('CACHE');
    if (provider?.ENABLED || (cache?.REDIS?.ENABLED && cache?.REDIS?.SAVE_INSTANCES)) {
      throw new BadRequestException(
        'Session bridge requires the Prisma auth store: disable PROVIDER and CACHE_REDIS_SAVE_INSTANCES (keep DATABASE_SAVE_DATA_INSTANCE=true).',
      );
    }
  }

  private async resolveInstanceId(instanceName: string): Promise<string> {
    const row = await this.prismaRepository.instance.findUnique({
      where: { name: instanceName },
      select: { id: true },
    });
    if (!row) {
      throw new BadRequestException(`The "${instanceName}" instance does not exist`);
    }
    return row.id;
  }

  public async exportSession({ instanceName }: InstanceDto, key: string) {
    this.assertGlobalKey(key);
    this.assertPrismaAuthStore();
    const instanceId = await this.resolveInstanceId(instanceName);
    const session = await this.prismaRepository.session.findUnique({ where: { sessionId: instanceId } });
    if (!session?.creds) {
      throw new BadRequestException(`No stored session for "${instanceName}"`);
    }
    // Session.creds is double-encoded (JSON.stringify of the BufferJSON creds
    // string). Undo the outer layer so the caller gets the canonical string.
    return { instanceName, instanceId, creds: JSON.parse(session.creds) as string };
  }

  public async importSession({ instanceName }: InstanceDto, data: ImportSessionDto, key: string) {
    this.assertGlobalKey(key);
    this.assertPrismaAuthStore();

    const credsString = data?.creds;
    if (typeof credsString !== 'string' || credsString.length === 0) {
      throw new BadRequestException('Missing "creds" (BufferJSON string) in body');
    }
    // Paired creds are a few KB; anything huge is a mistake or abuse.
    if (credsString.length > 262_144) {
      throw new BadRequestException('"creds" too large (> 256 KB) — not a Baileys session');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(credsString);
    } catch {
      throw new BadRequestException('"creds" is not valid JSON');
    }
    if (!parsed?.noiseKey || !parsed?.me?.id) {
      throw new BadRequestException('"creds" is not a paired Baileys session (missing noiseKey/me.id)');
    }

    const instanceId = await this.resolveInstanceId(instanceName);

    // Write in the EXACT shape useMultiFileAuthStatePrisma.saveKey produces:
    // Session.creds = JSON.stringify(<BufferJSON creds string>). The double
    // encode is intentional — the loader does JSON.parse then BufferJSON.reviver.
    await this.prismaRepository.session.upsert({
      where: { sessionId: instanceId },
      create: { sessionId: instanceId, creds: JSON.stringify(credsString) },
      update: { creds: JSON.stringify(credsString) },
    });

    // Creds are now durably stored. The reload below is best-effort: on any
    // failure we still report imported:true (the auto-reconnect / a manual
    // /instance/connect will pick up the imported creds).
    const instance = this.waMonitor.waInstances[instanceName];
    if (!instance) {
      return {
        instance: { instanceName, instanceId, status: 'close' },
        imported: true,
        note: 'Session stored. Call GET /instance/connect/{instanceName} to establish the socket.',
      };
    }

    // Inject the Signal key-store (one-time prekeys) BEFORE the reload, so the
    // reconnect's fresh key cache reads them — required for inbound messages.
    let keysWritten = 0;
    if (data?.keys && typeof instance.importSignalKeys === 'function') {
      try {
        keysWritten = await instance.importSignalKeys(data.keys);
      } catch (error) {
        this.logger.warn(`importSession: key injection failed (${(error as Error)?.message})`);
      }
    }

    let reloadError: string | undefined;
    try {
      const state = instance.connectionStatus?.state;
      if (state === 'open' || state === 'connecting') {
        // Tearing down a live socket triggers Baileys' own auto-reconnect,
        // which re-reads the freshly imported creds. Don't ALSO connect here —
        // that would race into a duplicate socket.
        instance.client?.ws?.close();
        instance.client?.end(new Error('import-session reload'));
      } else {
        // Not connected (the passkey case) — nothing auto-reconnects, so we
        // establish the socket ourselves with the imported creds.
        await instance.connectToWhatsapp();
      }
      await delay(2000);
    } catch (error) {
      reloadError = error instanceof Error ? error.message : String(error);
      this.logger.warn(`importSession: creds stored but reload failed (${reloadError})`);
    }

    return {
      instance: { instanceName, instanceId, status: instance.connectionStatus?.state ?? 'connecting' },
      imported: true,
      keysWritten,
      ...(reloadError ? { reloadError } : {}),
    };
  }

  public async restartInstance({ instanceName }: InstanceDto) {
    try {
      const instance = this.waMonitor.waInstances[instanceName];
      const state = instance?.connectionStatus?.state;

      if (!state) {
        throw new BadRequestException('The "' + instanceName + '" instance does not exist');
      }

      if (state === 'close') {
        throw new BadRequestException('The "' + instanceName + '" instance is not connected');
      }
      this.logger.info(`Restarting instance: ${instanceName}`);

      if (typeof instance.restart === 'function') {
        await instance.restart();
        // Wait a bit for the reconnection to be established
        await new Promise((r) => setTimeout(r, 2000));
        return {
          instance: {
            instanceName: instanceName,
            status: instance.connectionStatus?.state || 'connecting',
          },
        };
      }

      // Fallback for Baileys (uses different mechanism)
      if (state === 'open' || state === 'connecting') {
        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) instance.clearCacheChatwoot();

        instance.client?.ws?.close();
        instance.client?.end(new Error('restart'));
        return await this.connectToWhatsapp({ instanceName });
      }

      return {
        instance: {
          instanceName: instanceName,
          status: state,
        },
      };
    } catch (error) {
      this.logger.error(error);
      return { error: true, message: error.toString() };
    }
  }

  public async connectionState({ instanceName }: InstanceDto) {
    return {
      instance: {
        instanceName: instanceName,
        state: this.waMonitor.waInstances[instanceName]?.connectionStatus?.state,
        // vendora patch: surfaced when the account is gated by WhatsApp's
        // passkey ("Shortcake") linking verification — pairing cannot complete
        // headless; dashboards should stop the QR loop and guide the user.
        passkeyRequired: this.waMonitor.waInstances[instanceName]?.passkeyRequired ?? false,
      },
    };
  }

  public async fetchInstances({ instanceName, instanceId, number }: InstanceDto, key: string) {
    const env = this.configService.get<Auth>('AUTHENTICATION').API_KEY;

    if (env.KEY !== key) {
      const instancesByKey = await this.prismaRepository.instance.findMany({
        where: {
          token: key,
          name: instanceName || undefined,
          id: instanceId || undefined,
        },
      });

      if (instancesByKey.length > 0) {
        const names = instancesByKey.map((instance) => instance.name);

        return this.waMonitor.instanceInfo(names);
      } else {
        throw new UnauthorizedException();
      }
    }

    if (instanceId || number) {
      return this.waMonitor.instanceInfoById(instanceId, number);
    }

    const instanceNames = instanceName ? [instanceName] : null;

    return this.waMonitor.instanceInfo(instanceNames);
  }

  public async setPresence({ instanceName }: InstanceDto, data: SetPresenceDto) {
    return await this.waMonitor.waInstances[instanceName].setPresence(data);
  }

  public async logout({ instanceName }: InstanceDto) {
    const { instance } = await this.connectionState({ instanceName });

    // Idempotente: se já está desconectada, retorna sucesso silenciosamente.
    // Evita falhar o fluxo de delete do painel, que sempre chama logout antes do delete.
    if (instance.state === 'close') {
      return { status: 'SUCCESS', error: false, response: { message: 'Instance was already disconnected' } };
    }

    try {
      await this.waMonitor.waInstances[instanceName]?.logoutInstance();

      return { status: 'SUCCESS', error: false, response: { message: 'Instance logged out' } };
    } catch (error) {
      throw new InternalServerErrorException(error.toString());
    }
  }

  public async deleteInstance({ instanceName }: InstanceDto) {
    const { instance } = await this.connectionState({ instanceName });
    try {
      const waInstances = this.waMonitor.waInstances[instanceName];
      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) waInstances?.clearCacheChatwoot();

      if (instance.state === 'connecting' || instance.state === 'open') {
        try {
          await this.logout({ instanceName });
        } catch (error) {
          // logout can throw "Connection Closed" when the underlying Baileys
          // socket is already dead but waInstances[name] still exists. We
          // must continue to the remove.instance emit below — that is the
          // only path that purges the in-memory entry and runs cleaningUp().
          // Without this catch, the stale entry persists until the entire
          // process restarts.
          this.logger.warn({
            message: 'logout failed during deleteInstance — proceeding with cleanup',
            instanceName,
            error,
          });
        }
      }

      try {
        waInstances?.sendDataWebhook(Events.INSTANCE_DELETE, {
          instanceName,
          instanceId: waInstances.instanceId,
        });
      } catch (error) {
        this.logger.error(error);
      }

      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
    } catch (error) {
      throw new BadRequestException(error.toString());
    }
  }
}
