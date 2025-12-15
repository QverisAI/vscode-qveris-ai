import * as vscode from "vscode";
import { getStoredEmail, secretKeyName } from "./utils";

// Shared state manager for all views
export class ViewStateManager {
  private context: vscode.ExtensionContext;
  private loginStateListeners: Set<
    (email: string | null, hasKey: boolean) => void
  > = new Set();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async getLoginState(): Promise<{ email: string | null; hasKey: boolean }> {
    const key = await this.context.secrets.get(secretKeyName("qverisApiKey"));
    const email = await getStoredEmail(this.context);
    return { email: email || null, hasKey: !!key };
  }

  subscribe(listener: (email: string | null, hasKey: boolean) => void) {
    this.loginStateListeners.add(listener);
    return () => {
      this.loginStateListeners.delete(listener);
    };
  }

  async notifyLoginStateChanged() {
    const state = await this.getLoginState();
    this.loginStateListeners.forEach((listener) =>
      listener(state.email, state.hasKey),
    );
  }

  async broadcastMessage(message: any) {
    // Broadcast to all webviews
    const views = [
      "qverisAi.home",
      "qverisAi.toolSearch",
      "qverisAi.featuredTools",
      "qverisAi.toolSpecification",
    ];
    // Note: We'll need to track view instances to broadcast
    // For now, each view will check state on visibility change
  }
}
