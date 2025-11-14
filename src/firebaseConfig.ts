import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore';
// Config din Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyAbPs4aDxxB4uePDRKRgEbT_BiZJofpU7s",
  authDomain: "unihack---coach.firebaseapp.com",
  projectId: "unihack---coach",
  storageBucket: "unihack---coach.appspot.com", // atenție: corect e .appspot.com
  messagingSenderId: "125770597498",
  appId: "1:125770597498:web:2feb4e3f1f6797c6b867c3",
  measurementId: "G-ZQGWBSRKPK"
};

// Initialize Firebase


// Export servicii
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
export const microsoftProvider = new OAuthProvider('microsoft.com');
