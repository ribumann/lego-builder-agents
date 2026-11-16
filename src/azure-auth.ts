import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
  type PopupRequest,
  type SilentRequest,
} from '@azure/msal-browser';

interface AzureAuthConfig {
  tenantId: string;
  apiClientId: string;
  clientId: string;
  scope: string;
}

type TokenResult = Pick<AuthenticationResult, 'accessToken' | 'account'>;

interface AzureAuthClient {
  initialize(): Promise<void>;
  getActiveAccount(): AccountInfo | null;
  getAllAccounts(): AccountInfo[];
  setActiveAccount(account: AccountInfo | null): void;
  loginPopup(request: PopupRequest): Promise<TokenResult>;
  acquireTokenSilent(request: SilentRequest): Promise<TokenResult>;
  acquireTokenPopup(request: PopupRequest): Promise<TokenResult>;
}

const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SCOPE_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

function parseConfig(value: unknown): AzureAuthConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Azure sign-in is not configured. No planning request was sent.');
  const config = value as Record<string, unknown>;
  if (typeof config.tenantId !== 'string' || !GUID.test(config.tenantId)
      || typeof config.apiClientId !== 'string' || !GUID.test(config.apiClientId)
      || typeof config.clientId !== 'string' || !GUID.test(config.clientId)
      || typeof config.requiredScope !== 'string' || !SCOPE_NAME.test(config.requiredScope)
      || typeof config.scope !== 'string'
      || config.scope !== `api://${config.apiClientId}/${config.requiredScope}`)
    throw new Error('Azure sign-in is not configured. No planning request was sent.');
  return {
    tenantId: config.tenantId.toLowerCase(),
    apiClientId: config.apiClientId.toLowerCase(),
    clientId: config.clientId.toLowerCase(),
    scope: config.scope,
  };
}

export function createAzureAccessTokenProvider({
  fetchImpl = fetch,
  clientFactory = configuration => new PublicClientApplication(configuration),
}: {
  fetchImpl?: typeof fetch;
  clientFactory?: (configuration: Configuration) => AzureAuthClient;
} = {}): () => Promise<string> {
  let applicationKey = '';
  let applicationPromise: Promise<AzureAuthClient> | undefined;

  async function getApplication(config: AzureAuthConfig): Promise<AzureAuthClient> {
    const key = `${config.tenantId}:${config.clientId}`;
    if (applicationKey !== key || !applicationPromise) {
      applicationKey = key;
      applicationPromise = (async () => {
        const application = clientFactory({
          auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${config.tenantId}`,
            ...(typeof location === 'undefined' ? {} : { redirectUri: location.origin }),
          },
          cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
        });
        await application.initialize();
        return application;
      })();
    }
    try { return await applicationPromise; }
    catch (error) {
      applicationKey = '';
      applicationPromise = undefined;
      throw error;
    }
  }

  return async function acquireAzurePlanningToken() {
    try {
      const response = await fetchImpl('/api/azure-auth-config', {
        cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Azure sign-in is not configured. No planning request was sent.');
      const config = parseConfig(await response.json());
      const application = await getApplication(config);
      let account = application.getActiveAccount() ?? application.getAllAccounts()[0] ?? null;
      if (!account) {
        const login = await application.loginPopup({ scopes: [config.scope] });
        account = login.account;
        if (!account) throw new Error('Azure sign-in failed or permission was not granted. No planning request was sent.');
        application.setActiveAccount(account);
        if (login.accessToken) return login.accessToken;
      }

      const request: SilentRequest = { scopes: [config.scope], account };
      try {
        const result = await application.acquireTokenSilent(request);
        if (result.accessToken) return result.accessToken;
      } catch (error) {
        if (!(error instanceof InteractionRequiredAuthError)
            && (typeof error !== 'object' || error === null
              || !('errorCode' in error) || error.errorCode !== 'interaction_required'))
          throw error;
      }
      const result = await application.acquireTokenPopup({ scopes: [config.scope], account });
      if (!result.accessToken) throw new Error('Azure sign-in failed or permission was not granted. No planning request was sent.');
      return result.accessToken;
    } catch (error) {
      if (error instanceof Error && /No planning request was sent\.$/.test(error.message)) throw error;
      throw new Error('Azure sign-in failed or permission was not granted. No planning request was sent.');
    }
  };
}

export const acquireAzurePlanningToken = createAzureAccessTokenProvider();
