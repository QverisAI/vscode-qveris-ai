import * as vscode from 'vscode';
import axios from 'axios';
import { LoginResult } from './types';
import { ViewStateManager } from './stateManager';
import { secretKeyName, globalStateKey, ensureMcpConfigWithApiKey } from './utils';

// Base class for shared login functionality
export class BaseViewProvider {
  protected async performLogin(context: vscode.ExtensionContext, email: string, password: string): Promise<LoginResult> {
    const config = vscode.workspace.getConfiguration('qverisAi');
    const baseUrl = (config.get<string>('backendUrl') || 'https://qveris.ai').replace(/\/+$/, '');

    const loginResponse = await axios.post(`${baseUrl}/rpc/v1/auth/login`, {
      email,
      username: email,
      password
    }, {
      timeout: 15000
    });

    if (loginResponse.data?.status !== 'success') {
      throw new Error(loginResponse.data?.message || 'Login failed');
    }

    const token = loginResponse.data.token || loginResponse.data.data?.access_token;
    if (!token) {
      throw new Error('Login succeeded but no token returned.');
    }

    const userInfo = await axios.get(`${baseUrl}/rpc/v1/auth/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });

    const userEmail = userInfo.data?.data?.email || email;
    const apiKey = await this.obtainApiKey(baseUrl, token);

    return { token, email: userEmail, apiKey };
  }

  private async obtainApiKey(baseUrl: string, token: string): Promise<string> {
    const headers = { Authorization: `Bearer ${token}` };

    // Try existing keys first
    try {
      const listResp = await axios.get(`${baseUrl}/rpc/v1/auth/api-keys/list`, { headers, timeout: 15000 });
      if (listResp.data?.status === 'success' && Array.isArray(listResp.data?.data?.api_keys)) {
        const keys = listResp.data.data.api_keys;
        if (keys.length > 0) {
          const firstKey = keys[0];
          try {
            const fullKeyResp = await axios.get(
              `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.name)}`,
              { headers, timeout: 15000 }
            );
            if (fullKeyResp.data?.status === 'success' && fullKeyResp.data?.data?.api_key) {
              return fullKeyResp.data.data.api_key;
            }
          } catch {
            // ignore and fallback to create
          }
        }
      }
    } catch {
      // ignore and create
    }

    // Create a fresh key
    const config = vscode.workspace.getConfiguration('qverisAi');
    const requestedName = config.get<string>('apiKeyName') || 'vscode';
    const name = `${requestedName}-${Date.now()}`;

    const createResp = await axios.post(`${baseUrl}/rpc/v1/auth/api-keys/create`, { name }, { headers, timeout: 15000 });
    if (createResp.data?.status === 'success' && createResp.data?.data?.api_key) {
      return createResp.data.data.api_key;
    }

    throw new Error(createResp.data?.message || 'Unable to create API key');
  }

  protected async handleLogin(context: vscode.ExtensionContext, stateManager: ViewStateManager, email: string, password: string) {
    if (!email || !password) {
      vscode.window.showErrorMessage('Email and password are required.');
      return;
    }

    try {
      const loginResult = await this.performLogin(context, email, password);

      await context.secrets.store(secretKeyName('qverisApiKey'), loginResult.apiKey);
      await context.secrets.store(secretKeyName('qverisAccessToken'), loginResult.token);
      await context.secrets.store(secretKeyName('qverisEmail'), loginResult.email);
      await context.globalState.update(globalStateKey('qverisEmail'), loginResult.email);
      await ensureMcpConfigWithApiKey(loginResult.apiKey);

      await stateManager.notifyLoginStateChanged();
      vscode.window.showInformationMessage('Qveris login succeeded and API key stored securely.');
    } catch (err: any) {
      const message = err?.message || 'Login failed';
      vscode.window.showErrorMessage(message);
    }
  }

  protected async handleLogout(context: vscode.ExtensionContext, stateManager: ViewStateManager) {
    await context.secrets.delete(secretKeyName('qverisApiKey'));
    await context.secrets.delete(secretKeyName('qverisAccessToken'));
    await context.secrets.delete(secretKeyName('qverisEmail'));
    await context.globalState.update(globalStateKey('qverisEmail'), undefined);

    await stateManager.notifyLoginStateChanged();
    vscode.window.showInformationMessage('Logged out of Qveris.');
  }
}

