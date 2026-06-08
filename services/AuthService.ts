import * as WebBrowser from 'expo-web-browser';
import type { User } from 'firebase/auth';
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut } from 'firebase/auth';

import { CloudSyncService } from './CloudSyncService';
import { TelemetryService } from './TelemetryService';
import { firebaseAuth } from './firebase';

WebBrowser.maybeCompleteAuthSession();

type AuthListener = (user: User | null) => void;

export class AuthService {
  private static initialized = false;
  private static currentUser: User | null = firebaseAuth.currentUser;
  private static listeners = new Set<AuthListener>();

  static initialize(): void {
    if (this.initialized) {
      return;
    }

    onAuthStateChanged(firebaseAuth, (user) => {
      this.currentUser = user;
      this.emit(user);
      void this.handleAuthState(user);
    });

    this.initialized = true;
  }

  static subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.currentUser);

    return () => {
      this.listeners.delete(listener);
    };
  }

  static getCurrentUser(): User | null {
    return this.currentUser;
  }

  static async signInWithGoogleIdToken(idToken: string): Promise<User> {
    const credential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(firebaseAuth, credential);
    return result.user;
  }

  static async signOut(): Promise<void> {
    await signOut(firebaseAuth);
  }

  private static emit(user: User | null): void {
    this.listeners.forEach((listener) => listener(user));
  }

  private static async handleAuthState(user: User | null): Promise<void> {
    if (!user) {
      try {
        await TelemetryService.resetToAnonymous();
      } catch (error) {
        console.warn('Failed to reset telemetry identity:', error);
      }
      return;
    }

    try {
      TelemetryService.identifyAuthenticatedUser(user.uid, {
        auth_provider: user.providerData[0]?.providerId || 'google.com',
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { display_name: user.displayName } : {}),
      });
    } catch (error) {
      console.warn('Failed to identify authenticated user for telemetry:', error);
    }

    try {
      await CloudSyncService.syncAuthenticatedUser(user);
    } catch (error) {
      console.warn('Cloud sync skipped after auth state change:', error);
    }
  }
}
