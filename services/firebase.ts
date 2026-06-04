import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const requiredFirebaseKeys = Object.entries(firebaseConfig).filter(([, value]) => !value);
if (requiredFirebaseKeys.length > 0) {
  console.warn(
    'Firebase config is incomplete. Missing keys:',
    requiredFirebaseKeys.map(([key]) => key).join(', ')
  );
}

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);

export const firebaseGoogleClientIds = {
  webClientId: process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID || '',
  androidClientId:
    process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID ||
    '',
  iosClientId:
    process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID ||
    '',
};
