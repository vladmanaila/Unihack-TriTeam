import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, getAdditionalUserInfo } from "firebase/auth";
import { auth, googleProvider, microsoftProvider } from "../firebaseConfig";
import { doc, setDoc, serverTimestamp, collection, addDoc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("login");
  
  // Form states
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: ""
  });
  
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: ""
  });

  // Function to create/update user in Firestore
  // Function to create/update user in Firestore
const createOrUpdateUser = async (user: any, userName?: string) => {
  const userRef = doc(db, "users", user.uid);
  
  // Use the provided username or get from social provider
  let finalName = "User";
  if (userName) {
    finalName = userName;
  } else if (user.displayName) {
    finalName = user.displayName;
  } else if (user.email) {
    // Use email username as fallback
    finalName = user.email.split('@')[0];
  }

  const userData = {
    name: finalName,
    email: user.email,
    date: serverTimestamp(),
    subPlan: "free",
    lastActiveDate: serverTimestamp(),
    generalStats: {
      avgSentimentScore: "0",
      totalEnPer: "0", // Total Engagement Percentage
      totalRecordings: "0",
      totalStrengths: "0",
      totalOpportunities: "0"
    }
  };

  await setDoc(userRef, userData, { merge: true });
};

  // Function to check if user document already exists
  const checkIfUserExists = async (userId: string) => {
    const userDoc = await getDoc(doc(db, "users", userId));
    return userDoc.exists();
  };

  // Function to create a sample recording for new users
  // Function to create a sample recording for new users
const createSampleRecording = async (userId: string, userName: string = "User") => {
  const recordingsRef = collection(db, "recordings");
  
  const sampleRecording = {
    audioFileUrl: "",
    coachingCard: [
      "STRENGTH: Excellent introduction and rapport building",
      "STRENGTH: Clear value proposition presentation", 
      "OPPORTUNITY: Could ask more discovery questions",
      "OPPORTUNITY: Follow up on pricing discussion needed"
    ],
    date: serverTimestamp(),
    sentimentGraph: JSON.stringify([
      { time: "0:00", sentiment: 65 },
      { time: "5:00", sentiment: 72 },
      { time: "10:00", sentiment: 78 },
      { time: "15:00", sentiment: 75 },
      { time: "20:00", sentiment: 82 },
      { time: "25:00", sentiment: 85 },
      { time: "30:00", sentiment: 80 }
    ]),
    title: `${userName}'s First Sales Call`,
    transcript: [
      "Hello, thank you for taking the time to speak with me today.",
      "Hi, I'm interested in learning more about your product.",
      "Great! We help businesses like yours increase efficiency by automating routine tasks.",
      "That sounds interesting. Can you tell me more about the key features?",
      "Certainly! Our platform offers real-time analytics, automated reporting, and custom dashboard creation.",
      "How does the pricing work for your solution?",
      "We offer flexible pricing based on your team size and specific needs. Let me walk you through the options."
    ],
    recordingStats: {
      engagementPercentage: "78",
      missedOpportunitiesCount: "2", 
      sentimentScoreAvg: "75",
      strengthsCount: "2"
    },
    userId: userId,
    duration: "35:00" // Add duration field
  };

  await addDoc(recordingsRef, sampleRecording);
};

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
      const user = userCredential.user;
      
      // Update user's last active date
      await createOrUpdateUser(user);
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      alert("Login failed - check your credentials");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, signupForm.email, signupForm.password);
    const user = userCredential.user;
    
    // Create user document with name from signup form
    await createOrUpdateUser(user, signupForm.name);
    
    // Create a sample recording for the new user with their actual name
    await createSampleRecording(user.uid, signupForm.name);
    
    // After successful signup, switch to login tab and show success message
    setActiveTab("login");
    setLoginForm(prev => ({ ...prev, email: signupForm.email }));
    setSignupForm({ name: "", email: "", password: "" });
    alert("Account created successfully! Please login.");
  } catch (error: any) {
    console.error(error);
    if (error.code === 'auth/email-already-in-use') {
      alert("This email is already registered. Please login instead.");
      setActiveTab("login");
      setLoginForm(prev => ({ ...prev, email: signupForm.email }));
    } else {
      alert("Signup failed: " + error.message);
    }
  } finally {
    setIsLoading(false);
  }
};

  const handleGoogleLogin = async () => {
  try {
    setIsLoading(true);
    const userCredential = await signInWithPopup(auth, googleProvider);
    const user = userCredential.user;
    
    // Check if this is a new user by looking at the user's metadata
    const isNewUser = user.metadata.creationTime === user.metadata.lastSignInTime;
    
    // Create/update user document
    await createOrUpdateUser(user);
    
    // If it's a new user, create sample recording
    if (isNewUser) {
      await createSampleRecording(user.uid, user.displayName || "User");
    }
    
    navigate("/dashboard");
  } catch (error) {
    console.error(error);
    alert("Google login failed");
  } finally {
    setIsLoading(false);
  }
};

const handleMicrosoftLogin = async () => {
  try {
    setIsLoading(true);
    const userCredential = await signInWithPopup(auth, microsoftProvider);
    const user = userCredential.user;
    
    // Check if this is a new user by looking at the user's metadata
    const isNewUser = user.metadata.creationTime === user.metadata.lastSignInTime;
    
    // Create/update user document
    await createOrUpdateUser(user);
    
    // If it's a new user, create sample recording
    if (isNewUser) {
      await createSampleRecording(user.uid, user.displayName || "User");
    }
    
    navigate("/dashboard");
  } catch (error) {
    console.error(error);
    alert("Microsoft login failed");
  } finally {
    setIsLoading(false);
  }
};

  const updateLoginForm = (field: string, value: string) => {
    setLoginForm(prev => ({ ...prev, [field]: value }));
  };

  const updateSignupForm = (field: string, value: string) => {
    setSignupForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="absolute inset-0 bg-grid-pattern opacity-5" />
      
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-hero-gradient shadow-card-lg mb-4">
            <Mic className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">CoachIQ</h1>
          <p className="text-muted-foreground mt-2">Sales Coaching Intelligence Platform</p>
        </div>

        <Card className="shadow-card-lg border-border/50">
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Sign in to your account or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="you@company.com" 
                      required
                      value={loginForm.email}
                      onChange={(e) => updateLoginForm("email", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input 
                      id="password" 
                      type="password" 
                      placeholder="••••••••" 
                      required
                      value={loginForm.password}
                      onChange={(e) => updateLoginForm("password", e.target.value)}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                  >
                    {isLoading ? "Signing in..." : "Login"}
                  </Button>
                  
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline" 
                      type="button" 
                      onClick={handleGoogleLogin} 
                      disabled={isLoading}
                    >
                      Google
                    </Button>
                    <Button 
                      variant="outline" 
                      type="button" 
                      onClick={handleMicrosoftLogin} 
                      disabled={isLoading}
                    >
                      Microsoft
                    </Button>
                  </div>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSignup} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input 
                      id="name" 
                      type="text" 
                      placeholder="John Doe" 
                      required
                      value={signupForm.name}
                      onChange={(e) => updateSignupForm("name", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input 
                      id="signup-email" 
                      type="email" 
                      placeholder="you@company.com" 
                      required
                      value={signupForm.email}
                      onChange={(e) => updateSignupForm("email", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input 
                      id="signup-password" 
                      type="password" 
                      placeholder="••••••••" 
                      required
                      value={signupForm.password}
                      onChange={(e) => updateSignupForm("password", e.target.value)}
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={isLoading}
                  >
                    {isLoading ? "Creating account..." : "Create Account"}
                  </Button>
                  
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline" 
                      type="button" 
                      onClick={handleGoogleLogin} 
                      disabled={isLoading}
                    >
                      Google
                    </Button>
                    <Button 
                      variant="outline" 
                      type="button" 
                      onClick={handleMicrosoftLogin} 
                      disabled={isLoading}
                    >
                      Microsoft
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;