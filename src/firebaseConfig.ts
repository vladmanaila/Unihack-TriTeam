import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage'; // ADAUGĂ ASTA


 const firebaseConfig = {
  apiKey: "AIzaSyAbPs4aDxxB4uePDRKRgEbT_BiZJofpU7s",
  authDomain: "unihack---coach.firebaseapp.com",
  databaseURL: "https://unihack---coach-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "unihack---coach",
  storageBucket: "unihack---coach.firebasestorage.app",
  messagingSenderId: "125770597498",
  appId: "1:125770597498:web:2feb4e3f1f6797c6b867c3",
  measurementId: "G-ZQGWBSRKPK"


};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); // ADAUGĂ ASTA

export const googleProvider = new GoogleAuthProvider();
export const microsoftProvider = new OAuthProvider('microsoft.com');