import { socksDispatcher } from 'fetch-socks';
import * as http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';

type Proxy = {
  // Optional to match `wa.LocalProxy` (this fork's own instance-proxy config shape), so callers
  // can pass it straight through to `proxyAgentConfigForUrl` without reshaping it.
  host?: string;
  password?: string;
  port?: string;
  protocol?: string;
  username?: string;
};

// vendora patch: HttpsProxyAgent/SocksProxyAgent default to `keepAlive: false` and no socket
// timeout when built with no options, so every single request through the proxy (including
// every media upload attempt) pays a fresh CONNECT tunnel handshake, and a proxy that accepts
// the tunnel but then goes silent can hang the request forever. These defaults are applied to
// every agent this factory builds; per-call code doesn't need to opt in.
const DEFAULT_AGENT_OPTIONS: http.AgentOptions = {
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 64,
  timeout: 120_000,
};

function selectProxyAgent(
  proxyUrl: string,
  agentOptions: http.AgentOptions,
): HttpsProxyAgent<string> | SocksProxyAgent {
  const url = new URL(proxyUrl);

  // NOTE: The following constants are not used in the function but are defined for clarity.
  // When a proxy URL is used to build the URL object, the protocol returned by procotol's property contains a `:` at
  // the end so, we add the protocol constants without the `:` to avoid confusion.
  const PROXY_HTTP_PROTOCOL = 'http:';
  const PROXY_SOCKS_PROTOCOL = 'socks:';
  const PROXY_SOCKS5_PROTOCOL = 'socks5:';

  switch (url.protocol) {
    case PROXY_HTTP_PROTOCOL:
      return new HttpsProxyAgent(url, agentOptions);
    case PROXY_SOCKS_PROTOCOL:
    case PROXY_SOCKS5_PROTOCOL: {
      let urlSocks = '';

      if (url.username && url.password) {
        urlSocks = `socks://${url.username}:${url.password}@${url.hostname}:${url.port}`;
      } else {
        urlSocks = `socks://${url.hostname}:${url.port}`;
      }

      return new SocksProxyAgent(urlSocks, agentOptions);
    }
    default:
      throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
  }
}

export function makeProxyAgent(
  proxy: Proxy | string,
  agentOptions: http.AgentOptions = {},
): HttpsProxyAgent<string> | SocksProxyAgent {
  const mergedOptions = { ...DEFAULT_AGENT_OPTIONS, ...agentOptions };

  if (typeof proxy === 'string') {
    return selectProxyAgent(proxy, mergedOptions);
  }

  const { host, password, port, protocol, username } = proxy;
  let proxyUrl = `${protocol}://${host}:${port}`;

  if (username && password) {
    proxyUrl = `${protocol}://${username}:${password}@${host}:${port}`;
  }

  return selectProxyAgent(proxyUrl, mergedOptions);
}

/**
 * True when `url`'s host is one of WhatsApp's own domains. The paid proxy pool exists to make
 * *WhatsApp* traffic look like it comes from a Brazilian residential IP — routing a customer's
 * own media host (or an arbitrary profile-picture URL) through it burns proxy bytes for no
 * benefit and, per-instance, has been observed to add up (110 MB/week to our own media host
 * alone across ~38 instances).
 */
export function isWhatsAppHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return host.endsWith('whatsapp.net') || host.endsWith('whatsapp.com');
  } catch {
    return false;
  }
}

/**
 * Builds the axios `httpsAgent` config for fetching `url`: the proxy agent only when `url`
 * actually targets a WhatsApp host and a proxy is configured, direct otherwise.
 */
export function proxyAgentConfigForUrl(
  url: string,
  proxy: Proxy | undefined,
): { httpsAgent?: HttpsProxyAgent<string> | SocksProxyAgent } {
  if (!proxy || !isWhatsAppHost(url)) return {};
  return { httpsAgent: makeProxyAgent(proxy) };
}

export function makeProxyAgentUndici(proxy: Proxy | string): ProxyAgent {
  let proxyUrl: string;
  let protocol: string;

  if (typeof proxy === 'string') {
    const url = new URL(proxy);
    protocol = url.protocol.replace(':', '');
    proxyUrl = proxy;
  } else {
    const { host, password, port, protocol: proto, username } = proxy;
    protocol = (proto || 'http').replace(':', '');

    if (protocol === 'socks') {
      protocol = 'socks5';
    }

    const auth = username && password ? `${username}:${password}@` : '';
    proxyUrl = `${protocol}://${auth}${host}:${port}`;
  }

  protocol = protocol.toLowerCase();

  const PROXY_HTTP_PROTOCOL = 'http';
  const PROXY_HTTPS_PROTOCOL = 'https';
  const PROXY_SOCKS4_PROTOCOL = 'socks4';
  const PROXY_SOCKS5_PROTOCOL = 'socks5';

  switch (protocol) {
    case PROXY_HTTP_PROTOCOL:
    case PROXY_HTTPS_PROTOCOL:
      return new ProxyAgent(proxyUrl);

    case PROXY_SOCKS4_PROTOCOL:
    case PROXY_SOCKS5_PROTOCOL: {
      let type: 4 | 5 = 5;

      if (PROXY_SOCKS4_PROTOCOL === protocol) type = 4;

      const url = new URL(proxyUrl);

      return socksDispatcher({
        type: type,
        host: url.hostname,
        port: Number(url.port),
        userId: url.username || undefined,
        password: url.password || undefined,
      });
    }

    default:
      throw new Error(`Unsupported proxy protocol: ${protocol}`);
  }
}
